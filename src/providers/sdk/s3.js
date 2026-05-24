import { requireConfig } from "../../utils.js";
import { buildObjectUrl, parseObjectBaseUrl } from "../url.js";

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const encoder = new TextEncoder();

/**
 * Minimal read-only S3-compatible client for Worker/edge runtimes.
 *
 * This is not a full SDK. It only builds and signs GET/HEAD object requests.
 */
export function createS3Client(config = {}) {
  return {
    objectUrl(key, search = "") {
      return buildS3ObjectUrl(config, key, search);
    },

    signedObjectRequest(key, options = {}) {
      const url = options.url || buildS3ObjectUrl(config, key, options.search || "");
      return signS3ObjectRequest(url, config, options);
    },
  };
}


export async function signS3ObjectRequest(url, config = {}, options = {}) {
  const endpoint = new URL(url);
  const method = String(options.method || "GET").toUpperCase();

  const accessKeyId = String(config.accessKeyId || config.OSS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(config.secretAccessKey || config.accessKeySecret || config.OSS_ACCESS_KEY_SECRET || "").trim();
  const region = String(config.region || config.OSS_REGION || "us-east-1").trim();
  const sessionToken = String(config.sessionToken || config.OSS_SESSION_TOKEN || "").trim();
  requireConfig([
    ["OSS_ACCESS_KEY_ID", accessKeyId],
    ["OSS_ACCESS_KEY_SECRET", secretAccessKey],
  ]);

  const headers = new Headers(options.headers || {});
  const now = options.date instanceof Date ? options.date : new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const credentialScope = `${date}/${region}/${SERVICE}/aws4_request`;

  headers.set("host", endpoint.host);
  headers.set("x-amz-date", amzDate);
  headers.set("x-amz-content-sha256", UNSIGNED_PAYLOAD);
  if (sessionToken) headers.set("x-amz-security-token", sessionToken);

  const signedHeaderPairs = [...headers.entries()]
    .map(([name, value]) => [name.toLowerCase().trim(), String(value).trim().replace(/\s+/g, " ")])
    .sort(([a], [b]) => a.localeCompare(b));
  const canonicalHeaders = `${signedHeaderPairs.map(([name, value]) => `${name}:${value}`).join("\n")}\n`;
  const signedHeaders = signedHeaderPairs.map(([name]) => name).join(";");
  const canonicalQuery = [...endpoint.searchParams.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(([ak, av], [bk, bv]) => (ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk)))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const canonicalRequest = [
    method,
    encodePath(endpoint.pathname),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  ].join("\n");

  const dateKey = await hmac(`AWS4${secretAccessKey}`, date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, SERVICE);
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = [...await hmac(signingKey, stringToSign)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

  headers.set(
    "authorization",
    `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  return new Request(endpoint.toString(), { method, headers });
}

export function buildS3ObjectUrl(config = {}, key, search = "") {
  const endpoint = String(config.endpoint || config.baseUrl || config.OSS_BASE_URL || "").trim();
  const bucket = String(config.bucket || config.OSS_BUCKET || "").trim();
  requireConfig([
    ["OSS_BASE_URL", endpoint],
    ["OSS_BUCKET", bucket],
  ]);

  const url = parseObjectBaseUrl(endpoint);

  const pathStyle = /^(1|true|yes|on)$/i.test(String(config.pathStyle ?? config.forcePathStyle ?? config.OSS_FORCE_PATH_STYLE ?? ""));
  const objectPath = encodePath(String(key || "").replace(/^\/+/, ""));

  if (pathStyle) {
    return buildObjectUrl(url, `${awsEncode(bucket)}/${objectPath}`, search);
  }

  url.hostname = `${bucket}.${url.hostname}`;
  return buildObjectUrl(url, objectPath, search);
}

function encodePath(pathname) {
  return pathname.split("/").map((part) => {
    try {
      return awsEncode(decodeURIComponent(part));
    } catch {
      return awsEncode(part);
    }
  }).join("/");
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? key : encoder.encode(String(key)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
