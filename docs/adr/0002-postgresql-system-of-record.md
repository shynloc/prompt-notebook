# ADR-0002：采用独立 PostgreSQL 作为系统事实来源

## Status

Accepted — 2026-07-19

## Context

笔记、图片、标签、用户和词库之间存在清晰关系，需要事务、约束、搜索、备份和跨设备一致性。项目不能依赖 WordPress 数据库，也不能与服务器上其他应用共享数据库生命周期。

## Decision

使用独立 PostgreSQL 16 数据库和专用持久卷作为登录用户数据的系统事实来源，使用 Drizzle 管理模式和迁移。IndexedDB 只负责游客数据、草稿和离线队列，不替代服务端数据库。

## Consequences

### Positive

- 事务、外键和唯一约束保护数据完整性。
- 支持 JSONB 参数、全文/模糊搜索和成熟备份工具。
- 可在本机、托管 PostgreSQL 或任意云平台部署。
- 与 WordPress 和其他应用实现故障与升级隔离。

### Negative

- 需要备份、升级、监控和恢复演练。
- 单机数据库仍是可用性瓶颈。
- 模式变更必须遵循迁移纪律。

### Neutral

- MVP 不增加 Redis或专用搜索引擎；由数据证明再扩展。

## Alternatives Considered

- **SQLite**：开源单机体验很好，但多用户写入、备份和横向迁移路径较弱。
- **MongoDB**：数据并非无关系文档，事务与约束收益更重要。
- **Supabase 专有集成**：可以作为托管 PostgreSQL 使用，但不能成为运行硬依赖。
- **复用 WordPress MariaDB**：耦合部署和用户体系，不利于独立开源。

## References

- <https://www.postgresql.org/docs/current/>
- <https://www.postgresql.org/docs/current/datatype-json.html>
