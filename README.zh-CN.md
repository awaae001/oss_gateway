# oss-router-worker

一个轻量级 Cloudflare Worker，用于代理私有对象存储 Bucket，并通过 Cloudflare Worker Cache API 在边缘节点缓存资源。

本项目支持 Aliyun OSS 原生签名，以及基于 AWS Signature Version 4 的只读 S3 兼容 Provider。签名逻辑直接基于 Web API 实现，不依赖官方 Aliyun Node.js SDK 或 AWS SDK。

## 功能特性

- 通过 Cloudflare Worker 代理 Aliyun OSS 或 S3 兼容私有对象
- 对象存储 Bucket 可以保持私有，无需开启公共读
- 支持通过 `OSS_PROVIDER=aliyun` 或 `OSS_PROVIDER=s3` 切换 Provider
- `200` 响应会写入 `caches.default`
- `400` 和 `404` 响应会缓存 30 分钟
- 上游错误不透传 OSS / S3 XML，统一为 Apache 风格错误页（含随机 OS 标记和随机 IP 地址）
- 成功响应默认 Worker Cache TTL 为 7 天
- 缓存命中时自动续期，热门资源更容易留在边缘缓存中
- 支持通过 `?is_cache` 查看缓存和资源元数据
- 支持通过 `?inline` 强制覆写为 inline 展示
- 可选支持通过请求头强制刷新缓存
- 可选支持 CORS 跨域响应头

## 注意事项

Cloudflare Worker Cache 是边缘缓存，不是永久存储。即使设置了 7 天 TTL，资源也可能因为边缘节点缓存压力被提前淘汰。

> [!NOTE]
> Worker Cache 只存在于处理该请求的 Cloudflare 边缘节点 / 数据中心内，不会自动跨节点或跨地区同步。同一个资源在不同 CF 节点上可能分别出现 `MISS`，需要各自回源后才会在对应节点命中缓存。

如果用于生产环境，建议结合 Cloudflare WAF、Rate Limiting、签名 URL 等方式进一步降低滥用和盗刷风险。


## 配置

Worker 会从 Cloudflare Worker 环境变量绑定（`env.*`）读取全部配置。生产环境建议直接在 Cloudflare 网站后台的 Worker **Settings → Variables** 中配置，不需要把真实配置写进 `wrangler.toml`。

通用 OSS 变量：

| 名称 | 推荐类型 | 说明 |
| --- | --- | --- |
| `OSS_PROVIDER` | Variable | 默认是 `aliyun`。设置为 `s3` 时使用 S3 兼容存储。也支持 `oss`、`aliyun-oss`、`aws-s3`、`s3-compatible` 等别名。 |
| `OSS_BASE_URL` | Secret 或 Variable | 上游对象基础 URL。Aliyun OSS 可填写 Bucket Endpoint 或自定义域名；S3 兼容存储填写服务 Endpoint。 |
| `OSS_BUCKET` | Secret 或 Variable | Bucket 名称。 所有存储都必填。 |
| `OSS_ACCESS_KEY_ID` | Secret | Access Key ID |
| `OSS_ACCESS_KEY_SECRET` | Secret | Access Key Secret |

Provider 特定可选变量：

| 名称 | 推荐类型 | 说明 |
| --- | --- | --- |
| `OSS_REGION` | Variable | S3 SigV4 签名 Region。默认 `us-east-1`；Cloudflare R2 可按需使用 `auto`。Aliyun 原生签名不需要。 |
| `OSS_FORCE_PATH_STYLE` | Variable | 仅 S3 使用。MinIO/R2 等 path-style 场景可设置为 `true`。 |
| `OSS_SESSION_TOKEN` | Secret | 仅 S3 使用。临时凭证 Session Token。 |

其他可选变量：

| 名称 | 推荐类型 | 说明 |
| --- | --- | --- |
| `CACHE_REFRESH_KEY` | Secret | 配置后启用强制刷新缓存 |
| `CORS_ALLOW_ORIGIN` | Variable | 为空或不设置时禁用 CORS；可设置为 `*` 或指定来源域名 |
| `FORCE_QUERY_NORMALIZATION` | Variable | 默认开启。设为 `false` 后，会保留非内部查询参数进入缓存键和上游请求。 |
| `FORCE_INLINE` | Variable | 默认开启。设为 `false` 可关闭，之后仅当 URL 携带 `?inline` 参数时才覆写为 inline。 |
| `APACHE_ERROR_PAGE` | Variable | 默认开启。设为 `false` 后，关闭 Apache 风格错误页，直接返回原始错误响应，便于调试上游 XML / 文本错误体。 |
| `SANITIZE_RESPONSE_HEADERS` | Variable | 默认开启。设为 `false` 后，不再对白名单之外的上游响应头做过滤。 |

其中 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_SESSION_TOKEN`、`CACHE_REFRESH_KEY` 建议在 Cloudflare 后台设置为 **Secret**。如果更希望隐藏 Bucket 信息，也可以把 Endpoint 和 Bucket 相关变量一并设置为 Secret。代码读取方式相同。

本地开发时，可以在项目根目录创建 `.dev.vars`。

`CACHE_REFRESH_KEY` 是可选项。如果为空或未配置，强制刷新模块不会启用。


## 使用

安装依赖并启动本地开发服务：

```bash
npm install
npm run dev
```

通过 Worker 访问对象：

```text
http://localhost:8787/path/to/file.jpg
```

Worker 会对上游对象存储请求进行签名，读取私有对象，将 `200` 响应缓存 7 天、`400`/`404` 响应缓存 30 分钟，然后把结果返回给客户端。

当 `APACHE_ERROR_PAGE=true` 时，上游返回错误时，Worker 不会直接透传 OSS / S3 原始 XML 错误体，而是改为返回统一的 Apache 2.4 风格错误页（带随机 OS 标记如 Ubuntu/CentOS/Arch 之一，以及随机 IP 地址），避免暴露存储类型、错误码细节和部分后端指纹信息。

如果需要排查上游签名、权限或对象不存在等问题，可以临时设置 `APACHE_ERROR_PAGE=false`，直接查看原始错误响应。

响应头 `x-worker-cache` 表示缓存状态：

- `MISS`：本次从上游对象存储拉取，并写入 Worker Cache
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

## 查询参数处理

`is_cache` 会被当作调试开关处理，`inline` 会强制 Worker 返回 `Content-Disposition: inline`。这些内部参数本身不会进入缓存键。设置 `FORCE_INLINE=1` 可以全局启用 inline 覆写，无需在 URL 上添加参数。

默认会把其余查询参数全部移除，用于规范化缓存 key 和上游请求。可通过 `FORCE_QUERY_NORMALIZATION=false` 关闭此行为。

下面这些 URL 会共用同一份缓存，并请求同一个上游对象：

```text
/path/to/file.jpg
/path/to/file.jpg?v=1
/path/to/file.jpg?foo=bar
/path/to/file.jpg?is_cache
/path/to/file.jpg?inline
```

这样可以避免同一个对象因为不同查询参数产生多份缓存。

如果 `FORCE_QUERY_NORMALIZATION=false`，则在移除内部 `is_cache` / `inline` 标记后，会保留其余查询参数。比如 `/path/to/file.jpg`、`/path/to/file.jpg?v=1`、`/path/to/file.jpg?foo=bar` 会成为三个不同的缓存键。

## 强制刷新缓存

需要先设置 `CACHE_REFRESH_KEY`。如果该值为空或未配置，此功能不会启用。

刷新时通过请求头传入密钥：

```bash
curl -H "x-cache-refresh-key: your-refresh-key" https://your-domain.com/path/to/file.jpg
```

> [!WARNING]
> **特殊注意。** Cloudflare Workers Cache API 的 `delete()` 操作是系统内置行为，只能清除当前请求命中的 **单个边缘节点（PoP）** 上的缓存副本，并非本项目特有设计。Cloudflare 全球网络有 330+ 个边缘节点，每个节点维护自己独立的 Worker Cache。你发送刷新请求时，只有接收该请求的那个节点会真正删除缓存条目，其他所有节点上的同一条目仍然存活。对于全球用户访问的场景，刷新后大多数用户依然会命中旧缓存，直到各自所在节点的 TTL 自然到期。该机制无法做到全局同步清除，不能替代 Cloudflare 官方的 CDN Purge API。

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
- 默认启用 `APACHE_ERROR_PAGE=true`，上游错误不透传原始 XML 错误体，而是统一返回 Apache 风格错误页（含随机 OS 和随机 IP）
- 命中缓存时会重新写入缓存，用滑动过期方式延长热门资源存活时间
- `Range` 请求会直连上游对象存储，不写入缓存
- 默认启用查询参数强制归一化；设 `FORCE_QUERY_NORMALIZATION=false` 可关闭
- `?inline` 会把 `Content-Disposition` 改写为 `inline`，但不改变缓存条目
- 可选通过 `CORS_ALLOW_ORIGIN` 启用 CORS
- 默认启用出站响应头清洗；设 `SANITIZE_RESPONSE_HEADERS=false` 可关闭
- 可选通过 `x-cache-refresh-key` 强制刷新缓存
- 可选通过 `FORCE_INLINE` 全局强制覆写 `Content-Disposition` 为 `inline`

## 为什么需要这个项目？

私有对象存储 Bucket 通常需要签名请求才能访问。如果直接开放公共读，资源可能被盗链或刷流量；如果自己搭建后端代理，又需要维护服务器。

这个 Worker 充当一个轻量级边缘代理：

```text
Client -> Cloudflare Worker -> Private Object Storage
```

这样可以在保持 Bucket 私有的同时，利用 Cloudflare 边缘节点缓存资源，并在 Worker 中扩展自定义访问控制、缓存刷新、元数据调试、CORS、防盗刷等逻辑。
