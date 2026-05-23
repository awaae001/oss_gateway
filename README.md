# oss-router-worker

[简体中文](./README.zh-CN.md)

A lightweight Cloudflare Worker proxy for private object storage buckets, with edge caching powered by the Cloudflare Worker Cache API.

It supports Aliyun OSS native signing and a read-only S3-compatible provider using AWS Signature Version 4. The signing code is implemented directly with Web APIs, so it does not depend on the official Aliyun Node.js SDK or AWS SDK.

## Features

- Proxy private Aliyun OSS or S3-compatible objects through Cloudflare Worker
- Keep object storage buckets private; no public read access required
- Select provider with `OSS_PROVIDER=aliyun` or `OSS_PROVIDER=s3`
- Cache `200` responses in `caches.default`
- Cache `400` and `404` responses for 30 minutes
- 7-day Worker Cache TTL for successful responses by default
- Sliding cache renewal on cache hits
- Optional metadata/debug endpoint via `?is_cache`
- Optional inline display override via `?inline`
- Optional cache refresh via request header
- Optional CORS support
- No Aliyun Node.js SDK or AWS SDK dependency

## Notes

Cloudflare Worker Cache is an edge cache, not permanent storage. Objects may be evicted before the configured TTL under cache pressure.

> [!NOTE]
> Worker Cache is local to the Cloudflare edge node / data center that handles the request. It is not automatically replicated across nodes or regions. The same object may be a `MISS` on different CF nodes until each node fetches it from origin and stores its own cache entry.

For production use, consider combining this Worker with Cloudflare WAF, rate limiting, and signed URLs if you need stronger anti-abuse protection.


## Configuration

The Worker reads all configuration from Cloudflare Worker environment bindings (`env.*`). For production, configure everything directly in the Cloudflare dashboard under Worker **Settings → Variables**. You do not need to put real values in `wrangler.toml`.

Common OSS variables:

| Name | Recommended type | Description |
| --- | --- | --- |
| `OSS_PROVIDER` | Variable | `aliyun` by default. Set to `s3` for S3-compatible storage. Aliases such as `oss`, `aliyun-oss`, `aws-s3`, and `s3-compatible` are also accepted. |
| `OSS_BASE_URL` | Secret or variable | Upstream bucket endpoint. For Aliyun OSS, use the bucket endpoint, for example `https://your-bucket.oss-cn-hangzhou.aliyuncs.com/`. For S3-compatible storage, use the service endpoint, for example `https://s3.us-east-1.amazonaws.com/`, an R2 endpoint, or a MinIO endpoint. |
| `OSS_BUCKET` | Secret or variable | Bucket name |
| `OSS_ACCESS_KEY_ID` | Secret | Access key ID |
| `OSS_ACCESS_KEY_SECRET` | Secret | Access key secret |

Provider-specific optional variables:

| Name | Recommended type | Description |
| --- | --- | --- |
| `OSS_REGION` | Variable | S3 SigV4 signing region. Defaults to `us-east-1`; use `auto` for Cloudflare R2 if needed. Aliyun native signing does not require it. |
| `OSS_FORCE_PATH_STYLE` | Variable | S3 only. Set to `true` for path-style endpoints such as many MinIO/R2 setups. |
| `OSS_SESSION_TOKEN` | Secret | S3 only. Temporary credential session token. |

Other optional variables:

| Name | Recommended type | Description |
| --- | --- | --- |
| `CACHE_REFRESH_KEY` | Secret | Enables force-refresh when provided |
| `CORS_ALLOW_ORIGIN` | Variable | Empty/unset disables CORS; use `*` or a specific origin to enable it |

Access keys such as `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_SESSION_TOKEN`, and `CACHE_REFRESH_KEY` should be set as **Secrets** in the Cloudflare dashboard. If you also want to hide bucket information, you can set endpoint and bucket variables as Secrets too. The code reads them the same way.

You can also set Secrets with Wrangler:

```bash
npx wrangler secret put OSS_ACCESS_KEY_ID
npx wrangler secret put OSS_ACCESS_KEY_SECRET
npx wrangler secret put OSS_SESSION_TOKEN
npx wrangler secret put CACHE_REFRESH_KEY
```

For local development, create a `.dev.vars` file in the project root.

Aliyun example:

```env
OSS_PROVIDER=aliyun
OSS_BASE_URL=https://your-bucket.oss-cn-hangzhou.aliyuncs.com/
OSS_BUCKET=your-bucket
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
# Optional. If empty or unset, the cache refresh feature is disabled.
CACHE_REFRESH_KEY=your-refresh-key
CORS_ALLOW_ORIGIN=
```

S3-compatible example:

```env
OSS_PROVIDER=s3
OSS_BASE_URL=https://s3.us-east-1.amazonaws.com/
OSS_BUCKET=your-bucket
OSS_REGION=us-east-1
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
OSS_FORCE_PATH_STYLE=false
# Optional. If empty or unset, the cache refresh feature is disabled.
CACHE_REFRESH_KEY=your-refresh-key
CORS_ALLOW_ORIGIN=
```

`CACHE_REFRESH_KEY` is optional. If it is empty or not configured, refresh requests are ignored.

## Usage

Install dependencies and start local development:

```bash
npm install
npm run dev
```

Access an object through the Worker:

```text
http://localhost:8787/path/to/file.jpg
```

The Worker signs the upstream storage request, fetches the private object, stores `200` responses for 7 days and `400`/`404` responses for 30 minutes in `caches.default`, and returns the result.

The response header `x-worker-cache` indicates cache status:

- `MISS`: fetched from upstream storage and stored in Worker Cache
- `HIT`: served from Worker Cache
- `REFRESH`: cache was force-refreshed via request header

## Metadata / Cache Debugging

Append `?is_cache` to inspect cache and object metadata:

```text
http://localhost:8787/path/to/file.jpg?is_cache
```

Example response:

```json
{
  "cache": "HIT",
  "url": "https://example.com/path/to/file.jpg",
  "status": 200,
  "contentType": "image/jpeg",
  "contentLength": "12345",
  "etag": "...",
  "lastModified": "...",
  "cacheControl": "public, max-age=604800",
  "node": {
    "type": "edge",
    "colo": "NRT",
    "country": "JP",
    "region": "Tokyo",
    "city": "Tokyo"
  }
}
```

## Query Parameter Handling for Images

Image requests ignore query parameters for cache key normalization. `is_cache` is treated as a debug flag, and `inline` forces `Content-Disposition: inline` on the Worker response.

These URLs share the same cache entry and request the same upstream object:

```text
/path/to/file.jpg
/path/to/file.jpg?v=1
/path/to/file.jpg?foo=bar
/path/to/file.jpg?is_cache
/path/to/file.jpg?inline
```

`?inline` only rewrites the response header returned by the Worker. It does not change the upstream object or create a separate cache entry.

## Force Refresh Cache

Set `CACHE_REFRESH_KEY` first. If it is empty or not configured, this feature is disabled.

Send the refresh key through the request header:

```bash
curl -H "x-cache-refresh-key: your-refresh-key" https://your-domain.com/path/to/file.jpg
```

Behavior:

- Correct key: delete the Worker Cache entry, fetch from upstream storage again, write the new response to cache, and return it
- Wrong key: return `403 Forbidden`
- Empty or missing `CACHE_REFRESH_KEY`: refresh module is disabled and the header is ignored

## CORS

CORS is disabled by default when `CORS_ALLOW_ORIGIN` is empty or unset.

If `CORS_ALLOW_ORIGIN` is configured, the Worker adds CORS headers:

```text
access-control-allow-origin: <CORS_ALLOW_ORIGIN>
access-control-allow-methods: GET, HEAD, OPTIONS
access-control-allow-headers: range, if-none-match, if-modified-since, x-cache-refresh-key
```

Examples:

```toml
CORS_ALLOW_ORIGIN = "*"
```

or:

```toml
CORS_ALLOW_ORIGIN = "https://example.com"
```

## Deploy

```bash
npm run deploy
```

## Current Cache Strategy

- Supports `GET` and `HEAD`
- Caches `200` responses for 7 days: `public, max-age=604800`
- Caches `400` and `404` responses for 30 minutes: `public, max-age=1800`
- Cache hits are written back to cache to extend lifetime for hot objects
- `Range` requests are proxied directly to upstream storage and are not cached
- Image query parameters are ignored for cache key normalization
- `?inline` rewrites `Content-Disposition` to `inline` without changing the cache entry
- Optional CORS support through `CORS_ALLOW_ORIGIN`
- Optional cache refresh through `x-cache-refresh-key`

## Why Use This?

Private object storage buckets usually require signed requests. Instead of exposing public bucket URLs or running a backend server, this Worker acts as a small edge proxy:

```text
Client -> Cloudflare Worker -> Private Object Storage
```

This helps reduce direct bucket exposure, enables Cloudflare edge caching, and gives you a place to add custom access control, cache refresh, metadata debugging, CORS, and anti-abuse rules.
