import { withErrorPage } from "../error-page.js";
import { createStorageClient } from "../providers/index.js";
import { json, pickHeaders, rebuildResponse } from "../utils.js";

const CACHE_TTL = 604800;
const CLIENT_ERROR_CACHE_TTL = 1800;
const CACHEABLE_STATUSES = new Set([200, 400, 404]);
const REFRESH_HEADER = "x-cache-refresh-key";

export async function fetchWithCache(request, upstreamUrl, ctx, env = {}, storageClient = createStorageClient(env)) {
  const method = request.method.toUpperCase();

  if (request.headers.has("range")) {
    return fetch(await createStorageRequest(upstreamUrl, method, request.headers, storageClient));
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
      ctx.waitUntil(cache.put(cacheKey, withCacheTtl(cached.clone())));
      return withCacheHeader(cached, "HIT", method);
    }
  }

  const upstreamResponse = await fetch(await createStorageRequest(upstreamUrl, method, request.headers, storageClient));
  const headers = new Headers(upstreamResponse.headers);

  headers.set("cache-control", `public, max-age=${getCacheTtl(upstreamResponse.status)}`);

  const response = withErrorPage(rebuildResponse(upstreamResponse, { headers }), request, env);

  if (CACHEABLE_STATUSES.has(response.status)) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return withCacheHeader(response, shouldRefresh ? "REFRESH" : "MISS", method);
}

export async function getImageMetadata(request, upstreamUrl, env = {}, originalRequest = request, storageClient = createStorageClient(env)) {
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await caches.default.match(cacheKey);

  if (cached) {
    return jsonMetadata("HIT", request.url, cached.status, cached.headers, originalRequest);
  }

  const upstreamResponse = await fetch(await createStorageRequest(upstreamUrl, "HEAD", request.headers, storageClient));
  return jsonMetadata("MISS", request.url, upstreamResponse.status, upstreamResponse.headers, originalRequest);
}

async function createStorageRequest(upstreamUrl, method, requestHeaders, storageClient) {
  const headers = pickHeaders(requestHeaders, ["range", "if-none-match", "if-modified-since"]);

  return storageClient.signedObjectRequest("", { url: upstreamUrl, method, headers });
}

function withCacheTtl(response) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", `public, max-age=${getCacheTtl(response.status)}`);

  return rebuildResponse(response, { headers });
}

function getCacheTtl(status) {
  return status === 400 || status === 404 ? CLIENT_ERROR_CACHE_TTL : CACHE_TTL;
}

function jsonMetadata(cacheStatus, url, status, headers, request) {
  return json({
    cache: cacheStatus,
    url,
    status,
    contentType: headers.get("content-type"),
    contentLength: headers.get("content-length"),
    etag: headers.get("etag"),
    lastModified: headers.get("last-modified"),
    cacheControl: headers.get("cache-control"),
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

  return rebuildResponse(response, {
    body: method === "HEAD" ? null : response.body,
    headers,
  });
}
