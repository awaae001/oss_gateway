# oss-router-worker

Cloudflare Worker 代理 Aliyun OSS 私有 Bucket，并写入 Cloudflare Worker Cache。

## 配置

编辑 `wrangler.toml`：

```toml
[vars]
OSS_BASE_URL = "https://your_aliyun_oss.aliyuncs.com/"
OSS_BUCKET = "your_bucket_name"
OSS_REGION = "cn-hongkong"
# 为空或删除时不启用 CORS；需要跨域时可设为 "*" 或指定域名
CORS_ALLOW_ORIGIN = ""
```

AccessKey 是必需的，用 Worker Secret 保存，不要写进代码。缺少密钥时 Worker 会直接抛错：

本地开发可创建 `.dev.vars`：

```env
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
# 可选：为空或不设置时，不启用强制刷新模块
CACHE_REFRESH_KEY=your-refresh-key
```

## 使用

```bash
npm install
npm run dev
```

并把 200 响应存入 `caches.default`。响应头 `x-worker-cache` 会显示：

- `MISS`：本次从 OSS 拉取，并写入缓存
- `HIT`：本次命中 Worker Cache
- `REFRESH`：通过请求头强制刷新缓存后返回

查看图片缓存/元数据：

```text
http://localhost:8787/path/to/file.jpg?is_cache
```

返回 JSON，包含 `cache`、`status`、`contentType`、`contentLength`、`etag`、`lastModified`、`cacheControl`。

图片请求会忽略查询参数，只有 `is_cache` 作为调试开关使用。例如下面几个 URL 会共用同一份缓存，并请求同一个 OSS 对象：

```text
/path/to/file.jpg
/path/to/file.jpg?v=1
/path/to/file.jpg?foo=bar
/path/to/file.jpg?is_cache
```

强制刷新缓存需要先设置 Secret：

```bash
npx wrangler secret put CACHE_REFRESH_KEY
```

如果 `CACHE_REFRESH_KEY` 为空或没有设置，刷新模块不会启用，请求头会被忽略。

刷新时带请求头：

```bash
curl -H "x-cache-refresh-key: your-refresh-key" https://pic.awaae001.top/path/to/file.jpg
```

如果设置了 `CORS_ALLOW_ORIGIN`，会开启跨域响应头：

```text
access-control-allow-origin: <CORS_ALLOW_ORIGIN>
access-control-allow-methods: GET, HEAD, OPTIONS
access-control-allow-headers: range, if-none-match, if-modified-since, x-cache-refresh-key
```

部署：

```bash
npm run deploy
```

## 当前策略

- 支持 `GET` / `HEAD`
- 默认只缓存 `200` 响应
- Worker Cache TTL 固定为 7 天：`public, max-age=604800`
- 命中缓存时会重新写入缓存，用滑动过期方式延长热门资源存活时间
- `Range` 请求暂时直连 OSS，不写入缓存
- 可选支持 CORS，`CORS_ALLOW_ORIGIN` 为空或未设置时不启用
- 可选支持请求头 `x-cache-refresh-key` 强制刷新缓存
- OSS 签名代码在 `src/cache/sdk.js`，不依赖 Aliyun Node SDK
