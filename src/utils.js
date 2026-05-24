import { ConfigError, UpstreamFetchError } from "./errors.js";

/**
 * Returns true unless the value explicitly disables a feature.
 */
export function isEnabledByDefault(value) {
  return !/^(0|false|no|off)$/i.test(String(value ?? "").trim());
}

/**
 * Returns whether the thrown value represents invalid local configuration.
 */
export function isConfigError(error) {
  return error instanceof ConfigError;
}

/**
 * Returns whether the thrown value represents an upstream fetch failure.
 */
export function isUpstreamFetchError(error) {
  return error instanceof UpstreamFetchError;
}

/**
 * Creates a standard invalid configuration error.
 */
export function invalidConfig(message, options) {
  return new ConfigError(message, options);
}

/**
 * Builds a JSON response with a UTF-8 content type.
 */
export function json(data, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("content-type")) {
    responseHeaders.set("content-type", "application/json; charset=utf-8");
  }

  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

/**
 * Rebuilds a response while preserving status metadata by default.
 */
export function rebuildResponse(response, { body = response.body, headers = response.headers } = {}) {
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Copies selected headers from a source Headers object.
 */
export function pickHeaders(headers, names) {
  const result = new Headers();

  for (const name of names) {
    const value = headers.get(name);
    if (value) result.set(name, value);
  }

  return result;
}

/**
 * Returns only headers whose lowercase names exist in the allowed set.
 */
export function filterHeaders(headers, allowedNames) {
  const result = new Headers();

  for (const [name, value] of headers.entries()) {
    if (allowedNames.has(String(name || "").toLowerCase())) {
      result.set(name, value);
    }
  }

  return result;
}

/**
 * Throws a standard missing OSS config error when required values are empty.
 */
export function requireConfig(entries) {
  const missing = entries
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new ConfigError(`Missing OSS config: ${missing.join(", ")}`);
  }
}
