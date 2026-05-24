import { withErrorPage } from "./error-page.js";
import { handleRequest } from "./router/index.js";
import { filterHeaders, isEnabledByDefault, json, rebuildResponse } from "./utils.js";

const ALLOWED_RESPONSE_HEADERS = new Set([
  "accept-ranges",
  "allow",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-range",
  "content-type",
  "date",
  "etag",
  "expires",
  "last-modified",
  "vary",
  "x-worker-cache",
]);

export default {
  async fetch(request, env, ctx) {
    if (request.method.toUpperCase() === "OPTIONS" && String(env.CORS_ALLOW_ORIGIN || "").trim()) {
      return withCors(new Response(null, { status: 204 }), env);
    }

    try {
      const response = await handleRequest(request, env, ctx);
      const sanitizedResponse = isEnabledByDefault(env.SANITIZE_RESPONSE_HEADERS)
        ? withSanitizedResponseHeaders(response)
        : response;

      return withCors(withErrorPage(sanitizedResponse, request, env), env);
    } catch (error) {
      console.error("Unhandled worker error", error);

      return withCors(
        withErrorPage(json({ error: "Internal Server Error" }, 500), request, env),
        env,
      );
    }
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
  headers.set("vary", appendVaryValue(headers.get("vary"), "Origin"));

  return rebuildResponse(response, { headers });
}

function withSanitizedResponseHeaders(response) {
  return rebuildResponse(response, {
    headers: filterHeaders(response.headers, ALLOWED_RESPONSE_HEADERS),
  });
}

function appendVaryValue(currentValue, nextValue) {
  const values = String(currentValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!values.includes(nextValue)) {
    values.push(nextValue);
  }

  return values.join(", ");
}
