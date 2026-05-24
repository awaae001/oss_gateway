//! Conditional request helpers for cached object responses.

/**
 * Builds a 304 response when the cached representation satisfies the request validators.
 */
export function createConditionalHitResponse(request, cached) {
  if (isIfNoneMatchSatisfied(request.headers.get("if-none-match"), cached.headers.get("etag"))) {
    return createNotModifiedResponse(cached);
  }

  if (request.headers.has("if-none-match")) {
    return null;
  }

  if (isIfModifiedSinceSatisfied(request.headers.get("if-modified-since"), cached.headers.get("last-modified"))) {
    return createNotModifiedResponse(cached);
  }

  return null;
}

function createNotModifiedResponse(cached) {
  const headers = new Headers();

  copyHeaderIfPresent(cached.headers, headers, "cache-control");
  copyHeaderIfPresent(cached.headers, headers, "content-location");
  copyHeaderIfPresent(cached.headers, headers, "date");
  copyHeaderIfPresent(cached.headers, headers, "etag");
  copyHeaderIfPresent(cached.headers, headers, "expires");
  copyHeaderIfPresent(cached.headers, headers, "last-modified");
  copyHeaderIfPresent(cached.headers, headers, "vary");

  return new Response(null, {
    status: 304,
    headers,
  });
}

function copyHeaderIfPresent(source, target, name) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

function isIfNoneMatchSatisfied(ifNoneMatch, etag) {
  if (!ifNoneMatch || !etag) {
    return false;
  }

  const normalizedEtag = normalizeEtag(etag);
  if (!normalizedEtag) {
    return false;
  }

  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((candidate) => candidate === "*" || normalizeEtag(candidate) === normalizedEtag);
}

function normalizeEtag(etag) {
  const value = String(etag || "").trim();
  if (!value) {
    return null;
  }

  return value.replace(/^W\//i, "");
}

function isIfModifiedSinceSatisfied(ifModifiedSince, lastModified) {
  if (!ifModifiedSince || !lastModified) {
    return false;
  }

  const ifModifiedSinceTime = Date.parse(ifModifiedSince);
  const lastModifiedTime = Date.parse(lastModified);

  if (Number.isNaN(ifModifiedSinceTime) || Number.isNaN(lastModifiedTime)) {
    return false;
  }

  return lastModifiedTime <= ifModifiedSinceTime;
}

