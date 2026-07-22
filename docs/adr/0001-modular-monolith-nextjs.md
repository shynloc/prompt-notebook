# ADR-0001：采用 Next.js 模块化单体

## Status

Accepted — 2026-07-19

## Context

项目需要同时提供响应式 Web UI、同源 API、认证、数据库访问和图片上传。开发与运维规模较小，首期运行在单台服务器，但未来要方便开源用户自行部署。旧单 HTML 已接近维护上限；微服务会增加网络、部署、监控和故障处理成本。

## Decision

使用 TypeScript 与 Next.js App Router 构建模块化单体。UI、API 和认证在同一可部署应用中，但代码按 `auth`、`notes`、`terms`、`media` 和 `sync` 模块划分，并通过服务接口保持边界。

## Consequences

### Positive

- 单仓、同源、单镜像，认证 Cookie 和本地开发更简单。
- 支持服务端渲染、SPA 式导航、API 和 Docker 自托管。
- 模块边界为未来确有必要的拆分保留空间。
- 减少跨服务调用和分布式故障。

### Negative

- 所有模块随同一版本部署，不能独立扩缩容。
- Next.js 升级和缓存语义需要持续维护。
- 必须通过目录和依赖规则避免重新退化为大文件。

### Neutral

- MVP 使用单实例；多实例需要协调缓存、部署 ID 和后台任务。

## Alternatives Considered

- **继续单 HTML**：无法安全承载认证、同步、图片处理和可测试模块。
- **Vite SPA + 独立 API**：边界清楚，但需要两个构建与部署单元，同源认证和开源安装更繁琐。
- **微服务**：当前用户规模和团队规模不足以抵消运维成本。
- **完全 serverless**：部署方便但增加平台绑定，不符合自托管优先目标。

## References

- <https://nextjs.org/docs/app/guides/self-hosting>
- <https://nextjs.org/docs/app/guides/single-page-applications>
