import { withErrorPage } from "../error-page.js";
import { createConditionalHitResponse } from "./conditional.js";
import { createStorageClient } from "../providers/index.js";
import { fetchStorageResponse } from "./storage.js";
import { json, rebuildResponse } from "../utils.js";

const DEFAULT_CACHE_TTL = 604800;
const DEFAULT_CACHE_POLICY = { cacheable: false, ttl: DEFAULT_CACHE_TTL };
const CACHE_POLICY_BY_STATUS = new Map([
  [200, { cacheable: true, ttl: DEFAULT_CACHE_TTL }],
  [400, { cacheable: true, ttl: 1800 }],
  [404, { cacheable: true, ttl: 1800 }],
]);
const REFRESH_HEADER = "x-cache-refresh-key";
const CACHE_STATUS_HEADER = "x-worker-cache";
const CACHE_FIRST_STORED_AT_HEADER = "x-worker-cache-first-stored-at";
const CACHE_LAST_RENEWED_AT_HEADER = "x-worker-cache-last-renewed-at";
const CACHE_TIME_FIELDS = [
  [CACHE_FIRST_STORED_AT_HEADER, "firstStoredAtUtc", "firstStoredAgeMs", "firstStoredAgeHuman"],
  [CACHE_LAST_RENEWED_AT_HEADER, "lastRenewedAtUtc", "lastRenewedAgeMs", "lastRenewedAgeHuman"],
];

// utills
function getCachePolicy(status) {
  const policy = CACHE_POLICY_BY_STATUS.get(status);

  return policy || DEFAULT_CACHE_POLICY;
}

/**
 * Fetches an object through the shared cache while preserving GET/HEAD semantics.
 */
export async function fetchWithCache(request, upstreamUrl, ctx, env = {}, storageClient = createStorageClient(env)) {
  const requestMethod = request.method.toUpperCase();
  const refreshKey = String(env.CACHE_REFRESH_KEY || "").trim();
  const providedRefreshKey = request.headers.get(REFRESH_HEADER);
  const shouldRefresh = Boolean(refreshKey && providedRefreshKey);

  if (shouldRefresh && providedRefreshKey !== refreshKey) {
    return new Response("Forbidden", { status: 403 });
  }

  if (request.headers.has("range")) {
    return fetchStorageResponse(upstreamUrl, requestMethod, request.headers, storageClient);
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });

  if (shouldRefresh) {
    await cache.delete(cacheKey);
  }

  if (!shouldRefresh) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const conditionalResponse = createConditionalHitResponse(request, cachedResponse);
      ctx.waitUntil(cache.put(cacheKey, toCacheEntry(cachedResponse.clone(), getCachePolicy(cachedResponse.status))));

      if (conditionalResponse) {
        return withCacheHeader(conditionalResponse, "HIT", requestMethod);
      }

      return withCacheHeader(cachedResponse, "HIT", requestMethod);
    }
  }

  const upstreamResponse = await fetchStorageResponse(upstreamUrl, requestMethod, request.headers, storageClient);
  const headers = new Headers(upstreamResponse.headers);
  const cachePolicy = getCachePolicy(upstreamResponse.status);

  headers.set("cache-control", `public, max-age=${cachePolicy.ttl}`);

  const response = withErrorPage(rebuildResponse(upstreamResponse, { headers }), request, env);
  if (requestMethod === "GET" && cachePolicy.cacheable) {
    ctx.waitUntil(cache.put(cacheKey, toCacheEntry(response.clone(), cachePolicy)));
  }

  return withCacheHeader(response, shouldRefresh ? "REFRESH" : "MISS", requestMethod);
}

/**
 * Returns cache metadata for an object without exposing the cached response body.
 */
export async function getCacheMetadata(request, upstreamUrl, env = {}, originalRequest = request, storageClient = createStorageClient(env)) {
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await caches.default.match(cacheKey);

  if (cached) {
    return jsonMetadata("HIT", request.url, cached.status, cached.headers, originalRequest);
  }
  const upstreamResponse = await fetchStorageResponse(upstreamUrl, "HEAD", request.headers, storageClient);
  return jsonMetadata("MISS", request.url, upstreamResponse.status, upstreamResponse.headers, originalRequest);
}

function toCacheEntry(response, cachePolicy) {
  const headers = new Headers(response.headers);
  const now = new Date().toISOString();

  if (cachePolicy.cacheable) {
    headers.set("cache-control", `public, max-age=${cachePolicy.ttl}`);
  }
  if (!headers.has(CACHE_FIRST_STORED_AT_HEADER)) {
    headers.set(CACHE_FIRST_STORED_AT_HEADER, now);
  }
  headers.set(CACHE_LAST_RENEWED_AT_HEADER, now);

  return rebuildResponse(response, { headers });
}

function jsonMetadata(cacheStatus, url, status, headers, request) {
  const now = Date.now();
  const cache = {
    status: cacheStatus,
    firstStoredAtUtc: null,
    firstStoredAgeMs: null,
    firstStoredAgeHuman: null,
    lastRenewedAtUtc: null,
    lastRenewedAgeMs: null,
    lastRenewedAgeHuman: null,
  };

  for (const [headerName, atKey, ageMsKey, ageHumanKey] of CACHE_TIME_FIELDS) {
    const rawValue = headers.get(headerName);
    const parsedAt = typeof rawValue === "string" ? Date.parse(rawValue) : Number.NaN;

    if (!Number.isFinite(parsedAt)) {
      continue;
    }

    const ageMs = Math.max(0, now - parsedAt);
    const totalSeconds = Math.floor(ageMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    cache[atKey] = rawValue;
    cache[ageMsKey] = ageMs;
    cache[ageHumanKey] = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }

  return json({
    url,
    cache,
    object: {
      status,
      contentType: headers.get("content-type"),
      contentLength: headers.get("content-length"),
      etag: headers.get("etag"),
      lastModified: headers.get("last-modified"),
      cacheControl: headers.get("cache-control"),
    },
    node: getCfNode(request),
    request: getCfRequest(request),
  }, 200, {
    "cache-control": "no-store",
  });
}

function getCfNode(request) {
  const cf = request.cf || {};

  return {
    type: request.cf ? "edge" : "local",
    colo: cf.colo || null,
    country: cf.country || null,
    region: cf.region || null,
    regionCode: cf.regionCode || null,
    city: cf.city || null,
    continent: cf.continent || null,
    timezone: cf.timezone || null,
  };
}

function getCfRequest(request) {
  const cf = request.cf || {};

  return {
    httpProtocol: cf.httpProtocol || null,
    tlsVersion: cf.tlsVersion || null,
    asn: cf.asn || null,
    asOrganization: cf.asOrganization || null,
  };
}

function withCacheHeader(response, cacheStatus, method) {
  const headers = new Headers(response.headers);
  headers.set(CACHE_STATUS_HEADER, cacheStatus);
  headers.delete(CACHE_FIRST_STORED_AT_HEADER);
  headers.delete(CACHE_LAST_RENEWED_AT_HEADER);

  return rebuildResponse(response, {
    body: shouldStripBody(response.status, method) ? null : response.body,
    headers,
  });
}

function shouldStripBody(status, method) {
  return method === "HEAD" || status === 204 || status === 205 || status === 304;
}
