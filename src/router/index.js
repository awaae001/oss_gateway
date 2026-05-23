import { fetchWithCache, getImageMetadata } from "../cache/index.js";

const IMAGE_EXTENSION_RE = /\.(avif|bmp|gif|heic|ico|jpe?g|png|svg|webp)$/i;
const ROUTER_MIDDLEWARES = [
  methodMiddleware,
  configMiddleware,
  objectKeyMiddleware,
  normalizeRequestMiddleware,
  upstreamMiddleware,
  responseMiddleware,
];

export async function handleRequest(request, env, ctx) {
  const routerContext = {
    request,
    env,
    ctx,
    url: new URL(request.url),
    response: null,
  };

  await runMiddlewares(routerContext);
  return routerContext.response || json({ error: "Not Found" }, 404);
}

async function runMiddlewares(routerContext) {
  for (const middleware of ROUTER_MIDDLEWARES) {
    await middleware(routerContext);
    if (routerContext.response) break;
  }
}

function methodMiddleware(routerContext) {
  const method = routerContext.request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    routerContext.response = new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
}

function configMiddleware(routerContext) {
  if (!routerContext.env.OSS_BASE_URL) {
    routerContext.response = json({ error: "Missing OSS_BASE_URL" }, 500);
  }
}

function objectKeyMiddleware(routerContext) {
  const objectKey = routerContext.url.pathname.replace(/^\/+/, "");
  if (!objectKey) {
    routerContext.response = json({ error: "Missing object key" }, 400);
    return;
  }

  routerContext.objectKey = objectKey;
}

function normalizeRequestMiddleware(routerContext) {
  const { url, request } = routerContext;
  const isMetadataRequest = url.searchParams.has("is_cache");
  const isImageRequest = IMAGE_EXTENSION_RE.test(url.pathname);

  if (isMetadataRequest) {
    url.searchParams.delete("is_cache");
  }
  if (isImageRequest) {
    url.search = "";
  }

  routerContext.isMetadataRequest = isMetadataRequest;
  routerContext.normalizedRequest = new Request(url.toString(), request);
}

function upstreamMiddleware(routerContext) {
  routerContext.upstreamUrl = buildOssUrl(
    routerContext.env.OSS_BASE_URL,
    routerContext.objectKey,
    routerContext.url.search,
  );
}

async function responseMiddleware(routerContext) {
  const { normalizedRequest, upstreamUrl, env, ctx } = routerContext;

  routerContext.response = routerContext.isMetadataRequest
    ? await getImageMetadata(normalizedRequest, upstreamUrl, env, routerContext.request)
    : await fetchWithCache(normalizedRequest, upstreamUrl, ctx, env);
}

function buildOssUrl(baseUrl, objectKey, search) {
  const upstream = new URL(baseUrl);
  const basePath = upstream.pathname.endsWith("/") ? upstream.pathname : `${upstream.pathname}/`;

  upstream.pathname = `${basePath}${encodeObjectKey(objectKey)}`;
  upstream.search = search;
  return upstream.toString();
}

function encodeObjectKey(objectKey) {
  return objectKey.split("/").map((part) => {
    try {
      return encodeURIComponent(decodeURIComponent(part));
    } catch {
      return encodeURIComponent(part);
    }
  }).join("/");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
