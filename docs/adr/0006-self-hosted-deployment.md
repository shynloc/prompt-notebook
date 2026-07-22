# ADR-0006：采用 Docker Compose 自托管部署

## Status

Accepted — 2026-07-19

## Context

生产域名 `prompts.example.com` 已通过 Cloudflare 代理，目标服务器已有宿主机 Nginx 和多个独立 Compose 项目。应用未来需要开源，让其他用户可以在普通单机上运行，不依赖 WordPress 或特定云平台。

## Decision

生产使用独立 Docker Compose 项目，MVP 包含 `prompt-app` 和 `prompt-postgres`。宿主机 Nginx 反向代理到仅本机或内部网络可达的应用端口。GitHub Actions 构建固定 commit SHA 镜像并执行健康检查部署。

开源默认 Compose 可直接启动应用和数据库；Cloudflare、Nginx 和外部图床均为可选生产配置。

## Consequences

### Positive

- 与现有服务器运维方式一致。
- 数据库、网络、卷和升级与其他项目隔离。
- 本地、生产和开源用户使用相近运行环境。
- 镜像固定版本，回滚路径清楚。

### Negative

- 单服务器故障会导致完整服务不可用。
- 需要维护镜像、迁移、备份和磁盘告警。
- 零停机迁移需要遵守 expand/contract 纪律。

### Neutral

- MVP 不使用 Kubernetes；达到实际单机瓶颈后再评估多实例。

## Alternatives Considered

- **直接安装 Node.js 服务**：可行，但环境一致性和回滚弱于镜像。
- **Vercel/SaaS 托管**：简单但不符合自托管优先和现有服务器利用目标。
- **Kubernetes**：当前规模明显过度设计。
- **放入 WordPress Compose**：生命周期耦合且不利于开源。

## References

- <https://nextjs.org/docs/app/getting-started/deploying>
- <https://nextjs.org/docs/app/guides/self-hosting>
