import { fetchWithCache, getImageMetadata } from "../cache/index.js";

export async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === "/" || url.pathname === "/health") {
    return new Response("OSS Router is running", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (!env.OSS_BASE_URL) {
    return json({ error: "Missing OSS_BASE_URL" }, 500);
  }

  const objectKey = url.pathname.replace(/^\/+/, "");
  if (!objectKey) {
    return json({ error: "Missing object key" }, 400);
  }

  const isMetadataRequest = url.searchParams.has("is_cache");
  const isImageRequest = /\.(avif|bmp|gif|heic|ico|jpe?g|png|svg|webp)$/i.test(url.pathname);
  if (isMetadataRequest) {
    url.searchParams.delete("is_cache");
  }
  if (isImageRequest) {
    url.search = "";
  }

  const normalizedRequest = new Request(url.toString(), request);
  const upstreamUrl = buildOssUrl(env.OSS_BASE_URL, objectKey, url.search);

  if (isMetadataRequest) {
    return getImageMetadata(normalizedRequest, upstreamUrl, env);
  }

  return fetchWithCache(normalizedRequest, upstreamUrl, ctx, env);
}

function buildOssUrl(baseUrl, objectKey, search) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const upstream = new URL(objectKey, base);
  upstream.search = search;
  return upstream.toString();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
