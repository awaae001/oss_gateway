const OSS_AUTH_PREFIX = "OSS";
const encoder = new TextEncoder();

const OSS_SUBRESOURCES = new Set([
  "acl",
  "uploads",
  "location",
  "cors",
  "logging",
  "website",
  "referer",
  "lifecycle",
  "delete",
  "append",
  "tagging",
  "objectMeta",
  "uploadId",
  "partNumber",
  "security-token",
  "position",
  "response-content-type",
  "response-content-language",
  "response-expires",
  "response-cache-control",
  "response-content-disposition",
  "response-content-encoding",
  "x-oss-process",
]);

/**
 * Minimal read-only Aliyun OSS client for Worker/edge runtimes.
 */
export function createAliyunClient(config = {}) {
  return {
    objectUrl(key, search = "") {
      return buildAliyunObjectUrl(config, key, search);
    },

    signedObjectRequest(key, options = {}) {
      const url = options.url || buildAliyunObjectUrl(config, key, options.search || "");
      return signOssRequest(url, config, options);
    },
  };
}

/**
 * Creates a signed request for accessing a private Aliyun OSS object.
 *
 * This implementation uses the OSS-compatible Authorization header signing
 * scheme and relies only on Web APIs, making it suitable for Cloudflare
 * Workers and other non-Node.js edge runtimes.
 */
export async function signOssRequest(url, env, options = {}) {
  const accessKeyId = String(env.accessKeyId || env.OSS_ACCESS_KEY_ID || "").trim();
  const accessKeySecret = String(env.accessKeySecret || env.secretAccessKey || env.OSS_ACCESS_KEY_SECRET || "").trim();
  const missing = [
    ["OSS_ACCESS_KEY_ID", accessKeyId],
    ["OSS_ACCESS_KEY_SECRET", accessKeySecret],
  ].filter(([, value]) => !value).map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing OSS config: ${missing.join(", ")}`);
  }

  const requestUrl = typeof url === "string" ? new URL(url) : new URL(url.toString());
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  const date = new Date().toUTCString();

  headers.set("date", date);

  const bucket = env.bucket || env.OSS_BUCKET || requestUrl.hostname.split(".")[0];
  const canonicalizedResource = `/${bucket}${canonicalPath(requestUrl.pathname)}${canonicalSubresources(requestUrl.searchParams)}`;
  const stringToSign = `${method}\n${headers.get("content-md5") || ""}\n${headers.get("content-type") || ""}\n${date}\n${canonicalizedOssHeaders(headers)}${canonicalizedResource}`;

  const signature = await hmacSha1Base64(accessKeySecret, stringToSign);
  headers.set("authorization", `${OSS_AUTH_PREFIX} ${accessKeyId}:${signature}`);

  return new Request(requestUrl.toString(), {
    method,
    headers,
    body: options.body,
  });
}

export function buildAliyunObjectUrl(config = {}, key, search = "") {
  const baseUrl = String(config.endpoint || config.baseUrl || config.OSS_BASE_URL || "").trim();

  if (!baseUrl) {
    throw new Error("Missing OSS config: OSS_BASE_URL");
  }

  const url = new URL(baseUrl);
  const basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  url.pathname = `${basePath}${encodeOssObjectKey(String(key || "").replace(/^\/+/, ""))}`;
  url.search = search ? (String(search).startsWith("?") ? String(search) : `?${search}`) : "";
  return url.toString();
}

function encodeOssObjectKey(objectKey) {
  return objectKey.split("/").map((part) => {
    try {
      return encodeURIComponent(decodeURIComponent(part));
    } catch {
      return encodeURIComponent(part);
    }
  }).join("/");
}

function canonicalPath(pathname) {
  return pathname
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
}

function canonicalSubresources(searchParams) {
  const pairs = [];

  for (const [key, value] of searchParams.entries()) {
    if (OSS_SUBRESOURCES.has(key)) {
      pairs.push([key, value]);
    }
  }

  if (pairs.length === 0) return "";

  pairs.sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)));
  return `?${pairs.map(([key, value]) => (value === "" ? key : `${key}=${value}`)).join("&")}`;
}

function canonicalizedOssHeaders(headers) {
  const pairs = [];

  for (const [name, value] of headers.entries()) {
    const lowerName = name.toLowerCase().trim();
    if (lowerName.startsWith("x-oss-")) {
      pairs.push([lowerName, String(value).trim().replace(/\s+/g, " ")]);
    }
  }

  if (pairs.length === 0) return "";

  pairs.sort(([a], [b]) => a.localeCompare(b));
  return `${pairs.map(([name, value]) => `${name}:${value}`).join("\n")}\n`;
}

async function hmacSha1Base64(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
