# ADR-0003：采用 Better Auth 管理身份与会话

## Status

Accepted — 2026-07-19

## Context

项目需要真实邮箱密码登录、邮箱验证、密码重置、会话撤销和未来可选 OAuth。认证必须可自托管，不能依赖 WordPress，也不应自行实现密码和会话协议。

## Decision

使用 Better Auth 与应用自己的 PostgreSQL。默认启用邮箱密码、验证和密码重置；会话使用同源安全 Cookie。SMTP 和 OAuth 提供商均为可选环境配置。

## Consequences

### Positive

- 避免自建密码、Token 和会话生命周期。
- 与 Next.js 和数据库适配器集成，支持自托管。
- 内置敏感认证端点限流能力并可扩展认证方式。
- 开源用户不需要 WordPress 或特定身份 SaaS。

### Negative

- 认证库升级可能包含模式或 API 迁移。
- 生产邮箱验证依赖可靠 SMTP。
- 团队仍需正确配置 Cookie、代理头、可信来源和密钥轮换。

### Neutral

- MVP 不提供企业 SSO、组织或复杂 RBAC。

## Alternatives Considered

- **Auth.js**：成熟，但本项目需要更直接的邮箱密码和账户管理能力。
- **Supabase Auth**：开发快，但会把认证与特定服务栈绑定得更紧。
- **Keycloak**：能力完整，但对个人项目和开源单机部署过重。
- **自行实现**：安全风险和长期维护成本不可接受。

## References

- <https://www.better-auth.com/docs>
- <https://better-auth.com/docs/concepts/session-management>
- <https://better-auth.com/docs/reference/security>
