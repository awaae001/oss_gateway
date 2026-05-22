# oss-router-worker

Cloudflare Worker 代理 Aliyun OSS 私有 Bucket，并写入 Cloudflare Worker Cache。

## 配置

编辑 `wrangler.toml`：

```toml
[vars]
OSS_BASE_URL = "https://tuchuang-awaae001.oss-cn-hongkong.aliyuncs.com/"
OSS_BUCKET = "tuchuang-awaae001"
OSS_REGION = "cn-hongkong"
```

AccessKey 是必需的，用 Worker Secret 保存，不要写进代码。缺少密钥时 Worker 会直接抛错：

```bash
npx wrangler secret put OSS_ACCESS_KEY_ID
npx wrangler secret put OSS_ACCESS_KEY_SECRET
```

本地开发可创建 `.dev.vars`：

```env
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
```

## 使用

```bash
npm install
npm run dev
```

访问：

```text
http://localhost:8787/path/to/file.jpg
```

Worker 会签名请求私有 OSS：

```text
https://tuchuang-awaae001.oss-cn-hongkong.aliyuncs.com/path/to/file.jpg
```

并把 200 响应存入 `caches.default`。响应头 `x-worker-cache` 会显示：

- `MISS`：本次从 OSS 拉取，并写入缓存
- `HIT`：本次命中 Worker Cache

查看图片缓存/元数据：

```text
http://localhost:8787/path/to/file.jpg?is_cache
```

返回 JSON，包含 `cache`、`status`、`contentType`、`contentLength`、`etag`、`lastModified`、`cacheControl`。

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
- OSS 签名代码在 `src/cache/sdk.js`，不依赖 Aliyun Node SDK
