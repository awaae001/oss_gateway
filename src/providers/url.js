import { invalidConfig } from "../utils.js";

/**
 * Parses and validates an upstream object base URL.
 */
export function parseObjectBaseUrl(baseUrl) {
  try {
    return new URL(baseUrl);
  } catch {
    throw invalidConfig("Invalid OSS_BASE_URL");
  }
}

/**
 * Appends an encoded object path and optional search string to a base URL.
 */
export function buildObjectUrl(url, objectPath, search = "") {
  const nextUrl = new URL(url.toString());
  const basePath = nextUrl.pathname.endsWith("/") ? nextUrl.pathname : `${nextUrl.pathname}/`;

  nextUrl.pathname = `${basePath}${String(objectPath || "").replace(/^\/+/, "")}`;
  nextUrl.search = search ? (String(search).startsWith("?") ? String(search) : `?${search}`) : "";
  return nextUrl.toString();
}

