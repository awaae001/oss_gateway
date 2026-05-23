import { fetchWithCache, getImageMetadata } from "../cache/index.js";
import { createStorageClient } from "../providers/index.js";

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
  try {
    routerContext.storageClient = createStorageClient(routerContext.env);
  } catch (error) {
    routerContext.response = json({ error: error.message }, 500);
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
  const forceInline = url.searchParams.has("inline");
  const isImageRequest = IMAGE_EXTENSION_RE.test(url.pathname);

  if (isMetadataRequest) {
    url.searchParams.delete("is_cache");
  }
  if (forceInline) {
    url.searchParams.delete("inline");
  }
  if (isImageRequest) {
    url.search = "";
  }

  routerContext.isMetadataRequest = isMetadataRequest;
  routerContext.forceInline = forceInline;
  routerContext.normalizedRequest = new Request(url.toString(), request);
}

function upstreamMiddleware(routerContext) {
  try {
    routerContext.upstreamUrl = routerContext.storageClient.objectUrl(
      routerContext.objectKey,
      routerContext.url.search,
    );
  } catch (error) {
    routerContext.response = json({ error: error.message }, 500);
  }
}

async function responseMiddleware(routerContext) {
  const { normalizedRequest, upstreamUrl, env, ctx, storageClient } = routerContext;

  const response = routerContext.isMetadataRequest
    ? await getImageMetadata(normalizedRequest, upstreamUrl, env, routerContext.request, storageClient)
    : await fetchWithCache(normalizedRequest, upstreamUrl, ctx, env, storageClient);

  routerContext.response = routerContext.forceInline && !routerContext.isMetadataRequest
    ? withInlineDisposition(response)
    : response;
}

function withInlineDisposition(response) {
  const headers = new Headers(response.headers);
  const disposition = headers.get("content-disposition");

  headers.set(
    "content-disposition",
    disposition ? disposition.replace(/^attachment/i, "inline") : "inline",
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
