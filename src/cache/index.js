import { signOssRequest } from "./sdk.js";

export async function fetchWithCache(request, upstreamUrl, ctx, env = {}) {
  const method = request.method.toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  // Range 请求通常用于大文件断点/拖动播放，先直连上游，避免缓存碎片复杂化。
  if (request.headers.has("range")) {
    return fetch(await createOssRequest(upstreamUrl, method, request.headers, env));
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);

  if (cached) {
    return withCacheHeader(cached, "HIT", method);
  }

  const upstreamResponse = await fetch(await createOssRequest(upstreamUrl, method, request.headers, env));

  const headers = new Headers(upstreamResponse.headers);

  // 如果 OSS 没有设置缓存时间，给 Worker Cache 一个默认 TTL。
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "public, max-age=86400");
  }

  const response = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });

  if (response.status === 200) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return withCacheHeader(response, "MISS", method);
}

export async function getImageMetadata(request, upstreamUrl, env = {}) {
  const method = request.method.toUpperCase();

  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await caches.default.match(cacheKey);

  if (cached) {
    return jsonMetadata("HIT", request.url, cached.status, cached.headers);
  }

  const upstreamResponse = await fetch(await createOssRequest(upstreamUrl, "HEAD", request.headers, env));
  return jsonMetadata("MISS", request.url, upstreamResponse.status, upstreamResponse.headers);
}

async function createOssRequest(upstreamUrl, method, requestHeaders, env) {
  const headers = pickRequestHeaders(requestHeaders);

  return signOssRequest(upstreamUrl, env, { method, headers });
}

function pickRequestHeaders(headers) {
  const result = new Headers();

  // 按需透传，避免把 Worker 的 Host/Cookie 等无关头传给 OSS。
  for (const name of ["range", "if-none-match", "if-modified-since"]) {
    const value = headers.get(name);
    if (value) result.set(name, value);
  }

  return result;
}

function jsonMetadata(cacheStatus, url, status, headers) {
  return new Response(JSON.stringify({
    cache: cacheStatus,
    url,
    status,
    contentType: headers.get("content-type"),
    contentLength: headers.get("content-length"),
    etag: headers.get("etag"),
    lastModified: headers.get("last-modified"),
    cacheControl: headers.get("cache-control"),
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function withCacheHeader(response, cacheStatus, method) {
  const headers = new Headers(response.headers);
  headers.set("x-worker-cache", cacheStatus);

  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
