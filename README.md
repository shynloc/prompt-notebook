# Prompt Notebook

一个独立、自托管、适配桌面与移动端的提示词作品笔记本。它把 Prompt、标签、来源、生成图片和 AI 工作流放在同一套真实账户与 PostgreSQL 数据中，不依赖 WordPress，也不把正式笔记留在浏览器缓存里。

## 能做什么

- Dashboard 用八张统计卡片和可点击标签列表汇总笔记、分享、词库、收藏、项目、回收站与提示词字数。
- 注册、登录和跨设备同步，支持邮箱验证、密码重置、账户导入导出与删除。
- 提示词卡片、图片封面、全文搜索、标签、项目、收藏、归档、回收站、版本历史和变量模板。
- 日期短链接只读分享、明确的创建反馈，以及可续期和关闭的有效分享管理页。
- 上传图片、导入图片直链、解析网页 Open Graph/Twitter Card 图片，并复用历史图床图片。
- 按用户加密保存图床令牌和多套 OpenAI-compatible 模型配置。
- 设置集中管理 AI 模型与图床连接，桌面侧栏保持简洁，分类页仍可独立深链访问。
- 一键优化 Prompt：自动识别通用或生图任务，以有限语义模块适配人像、产品、风景、海报、封面、信息图、漫画及混合需求，并在应用前展示结构和事实保留警告。
- 图片反推 Prompt：上传、粘贴或导入图片直链，自动按画面类型分模块描述；支持额外要求改写、原图观察对照、模块编辑、JSON、保存笔记及转交生图／百科分析。
- 带持久化队列、直接文件下载、保存防重和可删除生成历史的专业 AI ImageHub。
- 提示词百科支持 AI 分析完整 Prompt，按类别提炼原文词组，经人工选择、编辑和去重后批量收录。
- AI Model / AI 模特资产库：保存角色设定、用途、封面、主图和多视角备用图；可与提示词绑定，在角色 Profile 中查看关联作品。
- AI ImageHub 可从角色卡中选择一位模特及最多四张垫图，生成历史保留角色快照；角色资产接口已为未来 LoRA、FaceID 等身份引擎预留适配层。
- AI 请求超时可通过部署环境配置；图片超时不会盲目重试，供应商错误与请求 ID 会在脱敏后展示。
- 按模型能力切换尺寸、质量和输出选项，原生支持 GPT Image 2 / 2.5 Sunburst、Flare；2.5 提供六档质量、最高 4K、透明 PNG/WebP、继续编辑及涂抹蒙版。
- 生成历史记录请求参数、实际图片尺寸和供应商返回的 token 用量；大图可下载并保存为笔记，避免网络状态不明时自动重复计费。
- Manifest V3 Chrome 扩展：选中文字、右键或点击图标即可编辑并保存到自己的服务器。
- PWA、响应式布局、本地草稿、幂等重试、软删除、备份和自动更新。

## 一键式自托管流程

需要一台安装了 Git、Docker、Docker Compose 和 Nginx/Caddy 的 Linux 服务器。

```bash
git clone https://github.com/shynloc/prompt-notebook.git
cd prompt-notebook
cp deploy/.env.production.example .env
```

编辑 `.env`：设置自己的 `APP_URL`，并生成数据库密码、Better Auth Secret 和 32 字节凭据加密密钥。图床 Token 和模型 API Key 不写进 `.env`，而是由每位用户登录后在设置页中配置。

```bash
./scripts/deploy-production.sh
```

将 [Nginx 示例](deploy/nginx/prompt-notebook.conf.example)复制到宿主机并替换域名、证书路径。示例将请求体上限设为 45 MB；ImageHub 的参考图与蒙版请求合计限制为 44 MiB，单文件不超过 10 MiB。确认：

```bash
node scripts/smoke-production.mjs https://prompts.example.com
```

详细变量、密钥轮换和生产检查见[配置说明](docs/configuration.md)。

## 首次使用

1. 打开部署后的站点，注册并登录。
2. 进入“设置 → 图床”，填写兼容图床上传端点和 Token，保存并测试。
3. 进入“设置 → AI 模型”，添加模型 API Base URL、API Key、Model ID，并分别指定提示词优化、词库分析、生图和反推模型；词库分析也可以继承提示词优化模型。
4. 按需进入“AI Model”创建角色卡、上传主图与备用图，并在提示词或 AI ImageHub 中复用。
5. 新建提示词、进入 AI ImageHub 测试生成，或在提示词百科中分析并收录优秀 Prompt 片段。
6. 安装 Chrome 扩展并连接自己的服务器。

图床兼容接口接收 `multipart/form-data` 的 `file`、`path` 字段及 `X-Auth-Token` 请求头；JSON 响应可返回 `url`、`publicUrl`、`href`、`location`、`key` 或 `path`。

Prompt Notebook 只保存图床 URL 和元数据。当前通用图床协议没有统一的删除接口，因此永久删除 AI Model 或生成历史不会自动删除图床原文件；请在自己的图床中管理这些文件，数据库备份也应与图床备份配套。

## GPT Image 2.5 和图片编辑

1. 在“设置 → AI 模型”添加供应商实际支持的 `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare` 或其日期快照，启用图片生成能力。自定义别名需按供应商文档显式选择兼容系列，不能仅凭名称猜测功能。
2. 在 AI ImageHub 选择本次使用的模型。2.5 支持 `auto/low/medium/high/xhigh/max`，质量与 1K/2K/4K 画布独立设置；透明背景须选 PNG 或 WebP。大于 2560×1440 的输出仍属于供应商实验能力，可能更慢且费用更高。
3. 点击已有生成图的“继续编辑”加入参考图；点击第一张本地参考图的“涂抹修改区域”，涂抹要重绘的区域、确认，再输入修改要求并生成。局部编辑需选择支持蒙版的模型，暂不与 AI Model 角色垫图混用。

生成结果每张最多 32 MiB（图床也需允许相应大小）；上传参考图和蒙版每张最多 10 MiB。较大的生成图继续编辑时会在浏览器尝试转为保留尺寸与透明度的 WebP，无法满足限制则明确提示。模型的“测试连接”只验证连接和模型列表，不会执行付费生图，也不保证第三方代理完整实现所声明的能力。

## 图片反推怎么用

1. 在 AI ImageHub 点击“图片反推”，或打开“提示词百科 → 图片反推”。已有参考图和生成结果也有“反推”入口。
2. 选择、拖入、粘贴图片，或填写 HTTPS 图片直链。填入额外要求，例如“衬衫改成蓝色，保留人物、姿势和构图”。
3. 点击“AI 一键反推”。使用“设置 → AI 模型”指定的图片理解模型，不自动调用生图模型。
4. 核对修改摘要与推测内容；在“分模块编辑”查看原图观察并编辑结果，或查看／复制 JSON。
5. 可填入 AI ImageHub（覆盖前确认，支持撤销）、保存为笔记，或送到百科分析再人工选择收录词汇。

反推是对可见画面的重建建议，不能还原原作者的真实 Prompt，也不能保证生图完全复现。原图只有勾选保存封面时才转存到用户配置的图床；跨页面交接的文本保存在当前标签页内，十分钟内一次性使用，不放进分享或导航 URL。

## Chrome 扩展

[下载最新版 Chrome 扩展 ZIP](https://github.com/shynloc/prompt-notebook/releases/latest/download/prompt-notebook-chrome.zip)

安装方法：

1. 下载 ZIP 并解压到固定文件夹。
2. 在 Chrome 打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择解压后的文件夹。
4. 打开扩展，输入自己的 Prompt Notebook HTTPS 地址，点击“验证服务器”。
5. 点击“连接 Prompt Notebook”，在网站完成授权。
6. 在任意网页选中文字，点击扩展图标、右键“保存到提示词笔记本中”，或按 `Alt + Shift + P`。

扩展没有写死服务器地址，不申请长期读取所有网站，只在用户主动操作时通过 `activeTab` 读取当前页，并为用户填写的服务器单独申请可撤销权限。

本地构建扩展：

```bash
npm run extension:test
npm run extension:zip
```

## 技术栈

| 层 | 实现 |
|---|---|
| Web | Next.js 16、React 19、TypeScript |
| 认证 | Better Auth、服务端 Cookie 会话、扩展 PKCE 设备授权 |
| 数据 | PostgreSQL 16、Drizzle ORM、GIN trigram 搜索索引 |
| 队列 | Redis、BullMQ、独立 generation worker |
| 图片 | 用户级加密 Picbed-compatible 配置；数据库保存 URL 与元数据 |
| 部署 | Docker Compose、Nginx/Caddy、systemd 可选自动更新 |
| 测试 | Vitest、Testing Library、Playwright、数据库集成测试 |

设计细节见[系统架构](docs/architecture.md)、[产品设计](docs/product-design.md)和 [ADR](docs/adr/README.md)。

## 本地开发

```bash
npm ci
docker compose -f docker-compose.dev.yml up -d postgres redis
cp .env.example .env.local
npm run db:migrate
npm run dev
```

开发环境的验证与密码重置链接会输出到服务端终端。完整验证：

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run extension:test
npm run build
npm run extension:build
npm run test:e2e
```

## 更新、备份与回滚

`scripts/auto-update.sh` 只跟踪公开仓库 `main`：发现新提交后先备份 PostgreSQL，再构建不可变提交镜像、执行迁移和健康检查；应用未就绪时自动恢复上一应用版本。安装 `deploy/systemd/prompt-notebook-update.*` 后每五分钟检查一次。数据库每日校验备份由 `prompt-notebook-backup.timer` 执行。

自动更新不会覆盖 tracked 本地改动；自定义配置应放在仓库外的 `/opt/prompt-notebook/.env`、反向代理和备份目录中。数据库迁移只向前执行，因此重大升级仍应保留异机备份并阅读 Release Notes。

## 安全

- 模型 Key 与图床 Token 使用 AES-256-GCM 按用户、用途绑定加密，API 只返回掩码。
- 自定义出站端点只允许标准端口的公网 HTTPS，并进行 DNS 固定、私网地址拒绝、响应限额和禁止跳转。
- 网页图片和角色参考图在每次请求及每次跳转时重新校验公网地址并固定已验证 IP，阻止 DNS 重绑定绕过内网限制。
- 账户、笔记、标签、图片引用、模型、图床和扩展设备均按所有者隔离。
- 不要提交 `.env`、数据库备份、服务器地址、SSH Key 或真实用户数据。

安全报告方式见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)。欢迎阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 后提交 Issue 或 Pull Request。
