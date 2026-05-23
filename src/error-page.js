import { isEnabledByDefault, pickHeaders, rebuildResponse } from "./utils.js";

const SAFE_ERROR_RESPONSE_HEADERS = ["allow", "cache-control", "x-worker-cache"];

const ERROR_STATUS_TEXTS = new Map([
  [400, "Bad Request"],
  [403, "Forbidden"],
  [404, "Not Found"],
  [405, "Method Not Allowed"],
  [500, "Internal Server Error"],
  [502, "Bad Gateway"],
  [503, "Service Temporarily Unavailable"],
  [504, "Gateway Time-out"],
]);

const ERROR_STATUS_MESSAGES = new Map([
  [400, "Your browser sent a request that this server could not understand."],
  [403, "You don't have permission to access this resource."],
  [404, "The requested resource was not found on this server."],
  [405, "The requested method is not allowed for this resource."],
  [500, "The server encountered an internal error and was unable to complete your request."],
  [502, "The server received an invalid response from the upstream server."],
  [503, "The server is temporarily unable to service your request."],
  [504, "The upstream server failed to send a request in time."],
]);

export function withErrorPage(response, request, env = {}) {
  if (!shouldRenderErrorPage(response, request, env)) {
    return response;
  }

  const status = response.status || 500;
  const statusText = getStatusText(status, response.statusText);
  const headers = pickHeaders(response.headers, SAFE_ERROR_RESPONSE_HEADERS);

  headers.set("content-type", "text/html; charset=utf-8");

  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }

  return rebuildResponse(response, {
    body: request.method.toUpperCase() === "HEAD" ? null : renderErrorPage(status, statusText, request),
    headers,
  });
}

function shouldRenderErrorPage(response, request, env) {
  return Boolean(
    response
    && response.status >= 400
    && !isMetadataRequest(request)
    && isEnabledByDefault(getErrorPageToggle(env)),
  );
}

function getErrorPageToggle(env) {
  return env.APACHE_ERROR_PAGE;
}

function isMetadataRequest(request) {
  return new URL(request.url).searchParams.has("is_cache");
}

function getStatusText(status, fallback) {
  return String(ERROR_STATUS_TEXTS.get(status) || fallback || "Error").trim();
}

function renderErrorPage(status, statusText, request) {
  const title = `${status} ${statusText}`;
  const message = getStatusMessage(status);
  const address = getServerAddress(request);

  return `<!DOCTYPE html PUBLIC "-//IETF//DTD HTML 2.0//EN">
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
</head>
<body>
<h1>${escapeHtml(statusText)}</h1>
<p>${escapeHtml(message)}</p>
<hr>
<address>${escapeHtml(address)}</address>
</body>
</html>`;
}

function getServerAddress(request) {
  const url = new URL(request.url);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");

  return `Apache/2.4.41 (${randomOsLabel()}) Server at ${url.hostname} Port ${port}`;
}

function randomOsLabel() {
  const options = ["Ubuntu", "CentOS", "Arch"];
  const index = crypto.getRandomValues(new Uint8Array(1))[0] % options.length;
  return options[index];
}

function getStatusMessage(status) {
  return String(ERROR_STATUS_MESSAGES.get(status) || "The server was unable to complete your request.").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
