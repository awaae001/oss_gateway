import { withErrorPage } from "../error-page.js";
import { createConditionalHitResponse } from "./conditional.js";
import { createStorageClient } from "../providers/index.js";
import { fetchStorageResponse } from "./storage.js";
import { json, rebuildResponse } from "../utils.js";

const CACHE_TTL = 604800;
const CLIENT_ERROR_CACHE_TTL = 1800;
const CACHEABLE_STATUSES = new Set([200, 400, 404]);
const REFRESH_HEADER = "x-cache-refresh-key";
const CACHE_STORED_AT_HEADER = "x-worker-cache-stored-at";

/**
 * Fetches an object through the shared cache while preserving GET/HEAD semantics.
 */
export async function fetchWithCache(request, upstreamUrl, ctx, env = {}, storageClient = createStorageClient(env)) {
  const requestMethod = request.method.toUpperCase();

  if (request.headers.has("range")) {
    return fetchStorageResponse(upstreamUrl, requestMethod, request.headers, storageClient);
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const refreshKey = String(env.CACHE_REFRESH_KEY || "").trim();
  const providedRefreshKey = request.headers.get(REFRESH_HEADER);
  const shouldRefresh = Boolean(refreshKey && providedRefreshKey);

  if (shouldRefresh && providedRefreshKey !== refreshKey) {
    return new Response("Forbidden", { status: 403 });
  }

  if (shouldRefresh) {
    await cache.delete(cacheKey);
  } else {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const conditionalResponse = createConditionalHitResponse(request, cached);
      ctx.waitUntil(cache.put(cacheKey, withCacheTtl(cached.clone())));

      if (conditionalResponse) {
        return withCacheHeader(conditionalResponse, "HIT", requestMethod);
      }

      return withCacheHeader(cached, "HIT", requestMethod);
    }
  }

  const upstreamResponse = await fetchStorageResponse(upstreamUrl, requestMethod, request.headers, storageClient);
  const headers = new Headers(upstreamResponse.headers);

  headers.set("cache-control", `public, max-age=${getCacheTtl(upstreamResponse.status)}`);

  const response = withCacheTtl(withErrorPage(rebuildResponse(upstreamResponse, { headers }), request, env));
  if (requestMethod === "GET" && CACHEABLE_STATUSES.has(response.status)) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return withCacheHeader(response, shouldRefresh ? "REFRESH" : "MISS", requestMethod);
}

/**
 * Returns cache metadata for an object without exposing the cached response body.
 */
export async function getImageMetadata(request, upstreamUrl, env = {}, originalRequest = request, storageClient = createStorageClient(env)) {
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await caches.default.match(cacheKey);

  if (cached) {
    return jsonMetadata("HIT", request.url, cached.status, cached.headers, originalRequest);
  }
  const upstreamResponse = await fetchStorageResponse(upstreamUrl, "HEAD", request.headers, storageClient);
  return jsonMetadata("MISS", request.url, upstreamResponse.status, upstreamResponse.headers, originalRequest);
}

function withCacheTtl(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${getCacheTtl(response.status)}`);
  if (!headers.has(CACHE_STORED_AT_HEADER)) {
    headers.set(CACHE_STORED_AT_HEADER, new Date().toISOString());
  }

  return rebuildResponse(response, { headers });
}

function getCacheTtl(status) {
  return status === 400 || status === 404 ? CLIENT_ERROR_CACHE_TTL : CACHE_TTL;
}

function jsonMetadata(cacheStatus, url, status, headers, request) {
  const rawCachedAtUtc = headers.get(CACHE_STORED_AT_HEADER);
  const cachedAtMs = typeof rawCachedAtUtc === "string" ? Date.parse(rawCachedAtUtc) : Number.NaN;
  const cachedAtUtc = Number.isFinite(cachedAtMs) ? rawCachedAtUtc : null;
  let cachedForMs = null;
  let cachedForHuman = null;

  if (cachedAtUtc !== null) {
    cachedForMs = Math.max(0, Date.now() - cachedAtMs);

    const totalSeconds = Math.floor(cachedForMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    cachedForHuman = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }

  return json({
    cache: cacheStatus,
    url,
    status,
    contentType: headers.get("content-type"),
    contentLength: headers.get("content-length"),
    etag: headers.get("etag"),
    lastModified: headers.get("last-modified"),
    cacheControl: headers.get("cache-control"),
    cachedAtUtc,
    cachedForMs,
    cachedForHuman,
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
  headers.set("x-worker-cache", cacheStatus);
  if (!headers.has(CACHE_STORED_AT_HEADER)) {
    headers.set(CACHE_STORED_AT_HEADER, new Date().toISOString());
  }

  return rebuildResponse(response, {
    body: shouldStripBody(response.status, method) ? null : response.body,
    headers,
  });
}

function shouldStripBody(status, method) {
  return method === "HEAD" || status === 204 || status === 205 || status === 304;
}
