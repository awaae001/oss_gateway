import { handleRequest } from "./router/index.js";

export default {
  async fetch(request, env, ctx) {
    if (request.method.toUpperCase() === "OPTIONS" && String(env.CORS_ALLOW_ORIGIN || "").trim()) {
      return withCors(new Response(null, { status: 204 }), env);
    }

    return withCors(await handleRequest(request, env, ctx), env);
  },
};

function withCors(response, env) {
  const allowOrigin = String(env.CORS_ALLOW_ORIGIN || "").trim();
  if (!allowOrigin) return response;

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowOrigin);
  headers.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
  headers.set("access-control-allow-headers", "range, if-none-match, if-modified-since, x-cache-refresh-key");
  headers.set("access-control-expose-headers", "content-length, content-type, etag, last-modified, x-worker-cache");
  headers.set("vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
