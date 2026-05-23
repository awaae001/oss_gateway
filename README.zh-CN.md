# oss-router-worker

一个轻量级 Cloudflare Worker，用于代理 Aliyun OSS 私有 Bucket，并通过 Cloudflare Worker Cache API 在边缘节点缓存资源。

本项目直接基于 Web API 实现 Aliyun OSS 请求签名，不依赖官方 Aliyun Node.js SDK。适合希望保持 OSS Bucket 私有，同时通过 Cloudflare Worker 对外分发图片或静态资源的场景。

## 功能特性

- 通过 Cloudflare Worker 代理 Aliyun OSS 私有对象
- OSS Bucket 可以保持私有，无需开启公共读
- `200` 响应会写入 `caches.default`
- `400` 和 `404` 响应会缓存 30 分钟
- 成功响应默认 Worker Cache TTL 为 7 天
- 缓存命中时自动续期，热门资源更容易留在边缘缓存中
- 支持通过 `?is_cache` 查看缓存和资源元数据
- 可选支持通过请求头强制刷新缓存
- 可选支持 CORS 跨域响应头
- 不依赖 Aliyun Node.js SDK

## 注意事项

Cloudflare Worker Cache 是边缘缓存，不是永久存储。即使设置了 7 天 TTL，资源也可能因为边缘节点缓存压力被提前淘汰。

> [!NOTE]
> Worker Cache 只存在于处理该请求的 Cloudflare 边缘节点 / 数据中心内，不会自动跨节点或跨地区同步。同一个资源在不同 CF 节点上可能分别出现 `MISS`，需要各自回源后才会在对应节点命中缓存。

如果用于生产环境，建议结合 Cloudflare WAF、Rate Limiting、签名 URL 等方式进一步降低滥用和盗刷风险。


## 配置

Worker 会从 Cloudflare Worker 环境变量绑定（`env.*`）读取全部配置。生产环境建议直接在 Cloudflare 网站后台的 Worker **Settings → Variables** 中配置，不需要把真实配置写进 `wrangler.toml`。

必需变量：

| 名称 | 推荐类型 | 说明 |
| --- | --- | --- |
| `OSS_BASE_URL` | Secret 或 Variable | OSS Bucket Endpoint，例如 `https://your-bucket.oss-cn-hangzhou.aliyuncs.com/` |
| `OSS_BUCKET` | Secret 或 Variable | OSS Bucket 名称 |
| `OSS_REGION` | Secret 或 Variable | OSS 区域，例如 `oss-cn-hangzhou` 或 `cn-hongkong` |
| `OSS_ACCESS_KEY_ID` | Secret | Aliyun AccessKey ID |
| `OSS_ACCESS_KEY_SECRET` | Secret | Aliyun AccessKey Secret |

可选变量：

| 名称 | 推荐类型 | 说明 |
| --- | --- | --- |
| `CACHE_REFRESH_KEY` | Secret | 配置后启用强制刷新缓存 |
| `CORS_ALLOW_ORIGIN` | Variable | 为空或不设置时禁用 CORS；可设置为 `*` 或指定来源域名 |

其中 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`CACHE_REFRESH_KEY` 建议在 Cloudflare 后台设置为 **Secret**。如果更希望隐藏 Bucket 信息，也可以把 `OSS_BASE_URL`、`OSS_BUCKET`、`OSS_REGION` 一并设置为 Secret。代码读取方式相同。

也可以使用 Wrangler 设置 Secrets：

```bash
npx wrangler secret put OSS_ACCESS_KEY_ID
npx wrangler secret put OSS_ACCESS_KEY_SECRET
npx wrangler secret put CACHE_REFRESH_KEY
```

本地开发时，可以在项目根目录创建 `.dev.vars`。该文件已被 Git 忽略：

```env
OSS_BASE_URL=https://your-bucket.oss-cn-hangzhou.aliyuncs.com/
OSS_BUCKET=your-bucket
OSS_REGION=oss-cn-hangzhou
OSS_ACCESS_KEY_ID=xxx
OSS_ACCESS_KEY_SECRET=xxx
# 可选。为空或不设置时，不启用强制刷新缓存功能。
CACHE_REFRESH_KEY=your-refresh-key
CORS_ALLOW_ORIGIN=
```

`CACHE_REFRESH_KEY` 是可选项。如果为空或未配置，强制刷新模块不会启用。

## 使用

安装依赖并启动本地开发服务：

```bash
npm install
npm run dev
```

通过 Worker 访问 OSS 对象：

```text
http://localhost:8787/path/to/file.jpg
```

Worker 会对 OSS 请求进行签名，读取私有对象，将 `200` 响应缓存 7 天、`400`/`404` 响应缓存 30 分钟，然后把结果返回给客户端。

响应头 `x-worker-cache` 表示缓存状态：

- `MISS`：本次从 OSS 拉取，并写入 Worker Cache
- `HIT`：本次命中 Worker Cache
- `REFRESH`：通过请求头强制刷新缓存后返回

## 查看元数据 / 缓存调试

在 URL 后追加 `?is_cache`，可以查看缓存和资源元数据：

```text
http://localhost:8787/path/to/file.jpg?is_cache
```

示例响应：

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

## 图片查询参数处理

图片请求会忽略查询参数。只有 `is_cache` 会被当作调试开关处理。

下面这些 URL 会共用同一份缓存，并请求同一个 OSS 对象：

```text
/path/to/file.jpg
/path/to/file.jpg?v=1
/path/to/file.jpg?foo=bar
/path/to/file.jpg?is_cache
```

这样可以避免同一张图片因为不同查询参数产生多份缓存。

## 强制刷新缓存

需要先设置 `CACHE_REFRESH_KEY`。如果该值为空或未配置，此功能不会启用。

刷新时通过请求头传入密钥：

```bash
curl -H "x-cache-refresh-key: your-refresh-key" https://your-domain.com/path/to/file.jpg
```

行为如下：

- 密钥正确：删除对应 Worker Cache，重新从 OSS 拉取，写入新缓存，并返回资源
- 密钥错误：返回 `403 Forbidden`
- `CACHE_REFRESH_KEY` 为空或未设置：刷新模块不启用，请求头会被忽略

## CORS 跨域

当 `CORS_ALLOW_ORIGIN` 为空或未设置时，CORS 不启用。

如果配置了 `CORS_ALLOW_ORIGIN`，Worker 会添加跨域响应头：

```text
access-control-allow-origin: <CORS_ALLOW_ORIGIN>
access-control-allow-methods: GET, HEAD, OPTIONS
access-control-allow-headers: range, if-none-match, if-modified-since, x-cache-refresh-key
```

例如允许任意来源：

```toml
CORS_ALLOW_ORIGIN = "*"
```

或者只允许指定站点：

```toml
CORS_ALLOW_ORIGIN = "https://example.com"
```

## 部署

```bash
npm run deploy
```

## 当前缓存策略

- 支持 `GET` 和 `HEAD`
- `200` 响应缓存 7 天：`public, max-age=604800`
- `400` 和 `404` 响应缓存 30 分钟：`public, max-age=1800`
- 命中缓存时会重新写入缓存，用滑动过期方式延长热门资源存活时间
- `Range` 请求会直连 OSS，不写入缓存
- 图片请求会忽略查询参数，用于规范化缓存 key
- 可选通过 `CORS_ALLOW_ORIGIN` 启用 CORS
- 可选通过 `x-cache-refresh-key` 强制刷新缓存

## 为什么需要这个项目？

Aliyun OSS 私有 Bucket 通常需要签名请求才能访问。如果直接开放公共读，资源可能被盗链或刷流量；如果自己搭建后端代理，又需要维护服务器。

这个 Worker 充当一个轻量级边缘代理：

```text
Client -> Cloudflare Worker -> Private Aliyun OSS
```

这样可以在保持 OSS 私有的同时，利用 Cloudflare 边缘节点缓存资源，并在 Worker 中扩展自定义访问控制、缓存刷新、元数据调试、CORS、防盗刷等逻辑。

