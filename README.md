# oss-router-worker

[简体中文](./README.zh-CN.md)

A lightweight Cloudflare Worker proxy for private Aliyun OSS buckets, with edge caching powered by the Cloudflare Worker Cache API.

This project implements Aliyun OSS request signing directly with Web APIs, so it does not depend on the official Aliyun Node.js SDK. It is useful when you want to keep your OSS bucket private while exposing selected files through a Cloudflare Worker endpoint.

## Features

- Proxy private Aliyun OSS objects through Cloudflare Worker
- Keep OSS bucket private; no public read access required
- Cache successful `200` responses in `caches.default`
- 7-day Worker Cache TTL by default
- Sliding cache renewal on cache hits
- Optional metadata/debug endpoint via `?is_cache`
- Optional cache refresh via request header
- Optional CORS support
- No Aliyun Node.js SDK dependency

## Configuration

Edit `wrangler.toml`:

```toml
[vars]
OSS_BASE_URL = "https://your_aliyun_oss.aliyuncs.com/"
OSS_BUCKET = "your_bucket_name"
OSS_REGION = "cn-hongkong"
# Leave empty or remove to disable CORS.
# Set to "*" or a specific origin to enable CORS.
CORS_ALLOW_ORIGIN = ""
```

Aliyun AccessKey values are sensitive. Store them as Cloudflare Worker Secrets. Do not put them in `wrangler.toml` or source code.

For local development, create a `.dev.vars` file in the project root:

```env
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
# Optional. If empty or unset, the cache refresh feature is disabled.
CACHE_REFRESH_KEY=your-refresh-key
```

For production, set secrets with Wrangler:

```bash
npx wrangler secret put OSS_ACCESS_KEY_ID
npx wrangler secret put OSS_ACCESS_KEY_SECRET
npx wrangler secret put CACHE_REFRESH_KEY
```

`CACHE_REFRESH_KEY` is optional. If it is empty or not configured, refresh requests are ignored.

## Usage

Install dependencies and start local development:

```bash
npm install
npm run dev
```

Access an OSS object through the Worker:

```text
http://localhost:8787/path/to/file.jpg
```

The Worker signs the OSS request, fetches the private object, stores successful `200` responses in `caches.default`, and returns the file.

The response header `x-worker-cache` indicates cache status:

- `MISS`: fetched from OSS and stored in Worker Cache
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
  "cacheControl": "public, max-age=604800"
}
```

## Query Parameter Handling for Images

Image requests ignore query parameters. Only `is_cache` is treated as a debug flag.

These URLs share the same cache entry and request the same OSS object:

```text
/path/to/file.jpg
/path/to/file.jpg?v=1
/path/to/file.jpg?foo=bar
/path/to/file.jpg?is_cache
```

## Force Refresh Cache

Set `CACHE_REFRESH_KEY` first. If it is empty or not configured, this feature is disabled.

Send the refresh key through the request header:

```bash
curl -H "x-cache-refresh-key: your-refresh-key" https://your-domain.com/path/to/file.jpg
```

Behavior:

- Correct key: delete the Worker Cache entry, fetch from OSS again, write the new response to cache, and return it
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
- Caches only `200` responses by default
- Worker Cache TTL is fixed to 7 days: `public, max-age=604800`
- Cache hits are written back to cache to extend lifetime for hot objects
- `Range` requests are proxied directly to OSS and are not cached
- Image query parameters are ignored for cache key normalization
- Optional CORS support through `CORS_ALLOW_ORIGIN`
- Optional cache refresh through `x-cache-refresh-key`
- OSS signing is implemented in `src/cache/sdk.js` without the Aliyun Node.js SDK

## Why Use This?

Aliyun OSS private buckets usually require signed requests. Instead of exposing public OSS URLs or running a backend server, this Worker acts as a small edge proxy:

```text
Client -> Cloudflare Worker -> Private Aliyun OSS
```

This helps reduce direct OSS exposure, enables Cloudflare edge caching, and gives you a place to add custom access control, cache refresh, metadata debugging, CORS, and anti-abuse rules.

## Notes

Cloudflare Worker Cache is an edge cache, not permanent storage. Objects may be evicted before the configured TTL under cache pressure. For production use, consider combining this Worker with Cloudflare WAF, rate limiting, and signed URLs if you need stronger anti-abuse protection.
