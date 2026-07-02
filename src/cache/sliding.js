export const CACHE_FIRST_STORED_AT_HEADER = "x-worker-cache-first-stored-at";
export const CACHE_LAST_RENEWED_AT_HEADER = "x-worker-cache-last-renewed-at";

/**
 * Wraps a response with cache lifetime metadata and the configured TTL.
 */
export function createCacheEntry(response, cachePolicy, now = new Date()) {
  const headers = new Headers(response.headers);
  const timestamp = now.toISOString();

  if (cachePolicy.cacheable) {
    headers.set("cache-control", `public, max-age=${cachePolicy.ttl}`);
  }
  if (!headers.has(CACHE_FIRST_STORED_AT_HEADER)) {
    headers.set(CACHE_FIRST_STORED_AT_HEADER, timestamp);
  }
  headers.set(CACHE_LAST_RENEWED_AT_HEADER, timestamp);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Schedules renewal after half the TTL has elapsed when CACHE_SLIDING_RENEWAL
 * is explicitly enabled. Returns whether a renewal was scheduled.
 */
export function scheduleSlidingCacheRenewal(
  cache,
  cacheKey,
  cachedResponse,
  cachePolicy,
  ctx,
  env = {},
  now = new Date(),
) {
  if (!isExplicitlyEnabled(env.CACHE_SLIDING_RENEWAL)) {
    return false;
  }
  if (!shouldRenew(cachedResponse, cachePolicy, now.getTime())) {
    return false;
  }

  ctx.waitUntil(
    cache.put(
      cacheKey,
      createCacheEntry(cachedResponse.clone(), cachePolicy, now),
    ),
  );
  return true;
}

function shouldRenew(response, cachePolicy, nowMs) {
  if (!cachePolicy.cacheable || response.status === 206 || response.status === 304) {
    return false;
  }

  const lastRenewedAt = Date.parse(
    response.headers.get(CACHE_LAST_RENEWED_AT_HEADER) || "",
  );
  if (!Number.isFinite(lastRenewedAt)) {
    return true;
  }

  return nowMs - lastRenewedAt >= cachePolicy.ttl * 500;
}

function isExplicitlyEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}
