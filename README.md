# Prompt Notebook

![Prompt Notebook：从灵感采集到可复用创作资产的原创概念插图](docs/readme/hero.svg)

<div align="center">

**不只收藏 Prompt。把灵感、图像、角色与创作过程，留在你自己的笔记本。**

A self-hosted, visual-first prompt library with your own AI workflow.

[![Release](https://img.shields.io/github/v/release/shynloc/prompt-notebook?style=for-the-badge&color=FF6338&label=RELEASE)](https://github.com/shynloc/prompt-notebook/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/shynloc/prompt-notebook/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI)](https://github.com/shynloc/prompt-notebook/actions/workflows/ci.yml) [![MIT](https://img.shields.io/github/license/shynloc/prompt-notebook?style=for-the-badge&color=233C49)](LICENSE) [![Self hosted](https://img.shields.io/badge/SELF--HOSTED-YOUR_SERVER-233C49?style=for-the-badge&logo=docker&logoColor=white)](#quick-start)

[![Next.js](https://img.shields.io/badge/Next.js-16-111827?style=flat-square&logo=nextdotjs)](package.json) [![React](https://img.shields.io/badge/React-19-233C49?style=flat-square&logo=react&logoColor=61DAFB)](package.json) [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](tsconfig.json) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](deploy/compose.production.yml) [![Redis](https://img.shields.io/badge/Redis-7.4-DC382D?style=flat-square&logo=redis&logoColor=white)](deploy/compose.production.yml) [![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](deploy/compose.production.yml) [![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](apps/extension/public/manifest.json) [![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](public/sw.js) [![Credentials](https://img.shields.io/badge/Credentials-AES--256--GCM-233C49?style=flat-square)](docs/configuration.md)

[![Stars](https://img.shields.io/github/stars/shynloc/prompt-notebook?style=flat-square&color=FF6338)](https://github.com/shynloc/prompt-notebook/stargazers) [![Forks](https://img.shields.io/github/forks/shynloc/prompt-notebook?style=flat-square&color=233C49)](https://github.com/shynloc/prompt-notebook/forks) [![Issues](https://img.shields.io/github/issues/shynloc/prompt-notebook?style=flat-square&color=FF6338)](https://github.com/shynloc/prompt-notebook/issues) [![Last commit](https://img.shields.io/github/last-commit/shynloc/prompt-notebook?style=flat-square&color=233C49)](https://github.com/shynloc/prompt-notebook/commits/main)

[快速部署](#quick-start) · [功能全览](#features) · [使用指南](#usage) · [Chrome 扩展](#chrome-extension) · [隐私与边界](#privacy) · [常见问题](#faq)

</div>

> 本页插图均为原创静态矢量示意，使用虚构内容，**不是实际页面截图，不包含用户笔记、照片或账户数据**。

## 你的灵感，你的工作流

Prompt Notebook 是一个独立、自托管、适配桌面与手机的提示词作品笔记本。它把散落在网页、聊天和创作工具里的提示词，整理成可以检索、复用、分享与继续创作的个人资产。

- **先记录，再创作**：文本、图片、标签、项目、来源和版本放在一起，不再只剩一段失去上下文的 Prompt。
- **把 AI 接进来**：优化提示词、从图片反推描述、分析可复用词组、测试生图，都使用你自己配置的模型连接。
- **真正独立**：账户与笔记存入自己的 PostgreSQL；不依赖 WordPress、作者账户、作者域名或作者的图床。
- **桌面到手机**：响应式 Web、可安装 PWA 与 Chrome 采集扩展连接同一套服务端数据；本地草稿不是正式笔记的唯一副本。

<a id="features"></a>

## 功能全览

| 工作区 | 已实现的能力 |
| --- | --- |
| 📚 提示词库 | 图片卡片瀑布流、多图预览、完整提示词、负面提示词、来源、复制、编辑和搜索 |
| 🗂️ 整理与复用 | 标签、项目、收藏、归档、回收站、版本历史、变量模板和批量操作 |
| 📊 Dashboard | 笔记、有效分享、标签、百科词汇、收藏、项目、回收站、提示词总字数八项统计，以及可点击的标签计数 |
| ✨ AI 优化 | 自动识别任务类型，按有限语义模块组织内容；支持结果对比、确认应用、取消与撤销 |
| 🔎 图片反推 | 上传、粘贴或导入图片直链，分模块还原画面；支持额外要求、模块编辑、原图观察与 JSON |
| 🎨 AI ImageHub | 文生图、参考图生图、单次模型选择、比例与尺寸、质量档位、格式、透明背景及压缩选项 |
| 🖌️ 继续编辑 | 生成图转为参考图；支持模型下的局部涂抹蒙版、撤销画笔、清除与透明 PNG 蒙版导出 |
| 🧑‍🎨 AI Model | 角色卡、设定与用途、封面、主图、多视角备用图；选择角色垫图，并关联提示词作品 |
| 🧩 提示词百科 | 分类词库、自定义词汇、点击插入；AI 提取原文词组，人工审核、去重后收录 |
| 🔗 只读分享 | 日期短链接、七天有效期、分享日期与到期时间、续期、立即关闭和有效分享管理 |
| 🖼️ 图片管理 | 上传、图片直链、网页预览图解析和历史图床图片选择；使用各用户独立配置的图床 |
| 🧷 Chrome 采集 | 选中文字后右键、点击图标或快捷键，编辑标题、内容、标签和配图，再保存到自己的实例 |
| 🔐 账户与迁移 | 注册、邮箱验证、登录、密码重置、跨设备访问、账户导入导出、设备授权与撤销 |
| ⚙️ 自托管运维 | Docker Compose、数据库迁移、独立生图 worker、健康检查、备份脚本与可选自动更新 |

### 不止是一个生图表单

AI ImageHub 使用 PostgreSQL 保存任务、Redis / BullMQ 调度、独立 worker 执行。离开页面后任务仍可继续；历史保留请求参数、实际图片尺寸和供应商提供的用量数据，支持直接下载、保存为笔记、设为封面和删除记录。

选项随模型能力变化，不会静默把不支持的画布替换成更小尺寸。当前适配 GPT Image 2 / 2.5 Sunburst、Flare 及其他已声明兼容系列；2.5 提供六档质量，常用比例覆盖 1:1、4:3、3:4、3:2、2:3、16:9、9:16。4K / 大于 2560×1440 的输出仍受供应商实验能力、费用与限额约束。

网络结果不明确、超时或生成完成后保存失败时，不会盲目自动重新生图。第三方代理的 Model ID、参数与实际能力仍需以其接口为准，**“兼容系列”不是平台能力认证**。

## 独立部署，不绑定作者的基础设施

![浏览器与扩展连接自托管服务，再连接用户模型和图床的原创架构示意](docs/readme/workflow.svg)

| 组件 | 作用 | 由谁提供 |
| --- | --- | --- |
| Web + 账户服务 | 界面、API、认证与用户隔离 | 本项目 Docker 镜像 |
| PostgreSQL 16 | 正式笔记、标签、角色、任务与加密凭据 | Compose 自带，数据卷持久化 |
| Redis 7.4 + worker | 持久化生图队列与后台执行 | Compose 自带 |
| HTTPS + 域名 | 安全访问、登录回调与扩展连接 | 部署者的反向代理与域名 |
| SMTP | 注册验证和密码重置邮件 | 部署者自己的邮件服务 |
| 模型 API | 优化、反推、词库分析与生图 | 登录后由用户在设置页填写 |
| 图床 API | 参考图、角色照片和生成作品的图片文件 | 登录后由用户在设置页填写 |

**纯文字笔记不要求模型 API 或图床。** 完整图片与 AI 工作流需要相应服务。调用与存储费用由所选供应商决定，项目不提供共享额度，也不要求本机 GPU。

<a id="quick-start"></a>

## 快速部署

> [!WARNING]
> 本轮审查发现当前依赖存在新安全公告，尚需修补和回归，不能把旧版本的绿色检查当作今天的安全结论。新生产部署前请先查看[最新审查与待办](docs/verification/2026-10-28-public-readiness.md)。以下说明是可独立部署的配置流程，不是无漏洞保证。

### 1. 准备环境

推荐在 Linux 服务器部署，准备 Git、Docker Engine、Docker Compose v2、`curl`、OpenSSL，以及自己的域名、HTTPS 证书与 Nginx / Caddy 等反向代理。

**必须准备可正常发信的 SMTP 服务。** 当前生产环境默认强制邮箱验证，需在注册前配置完成。Docker 部署不需要宿主机安装 Node.js；只有本地开发、手动构建扩展或运行 Node 验收脚本时才需要 Node.js 22。

### 2. 获取代码并配置环境

```bash
git clone https://github.com/shynloc/prompt-notebook.git
cd prompt-notebook
cp deploy/.env.production.example .env
chmod 600 .env

# 分别生成三份独立值，不要复用或提交到 Git
openssl rand -hex 24  # PostgreSQL 密码
openssl rand -hex 32  # Better Auth Secret
openssl rand -hex 32  # 32 字节凭据加密密钥
```

用编辑器打开 `.env`，至少填好以下项目。**占位符必须替换，不能原样启动**：

```dotenv
APP_URL=https://prompts.example.com
APP_PORT=5488
COMPOSE_PROJECT_NAME=prompt-notebook

POSTGRES_PASSWORD=<第一条命令生成的十六进制密码>
BETTER_AUTH_SECRET=<第二条命令生成的值>
BETTER_AUTH_IP_ADDRESS_HEADERS=x-real-ip
CREDENTIAL_ENCRYPTION_KEYS=primary:<第三条命令生成的64位十六进制值>
CREDENTIAL_ACTIVE_KEY_ID=primary

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=<你的SMTP用户名>
SMTP_PASSWORD=<你的SMTP密码>
SMTP_FROM=Prompt Notebook <no-reply@example.com>
```

数据库密码推荐十六进制，避免特殊字符破坏连接 URI。`SMTP_FROM` 应使用邮件服务允许的发件地址；465 端口启用隐式 TLS，其他配置按服务要求填写。

> [!IMPORTANT]
> **保管好凭据加密密钥。** 丢失密钥，即使数据库仍在，也无法解密已保存的模型 Key 和图床 Token。模型与图床凭据无需写入 `.env`，由用户登录后在设置页加密保存。

### 3. 构建并启动

```bash
./scripts/deploy-production.sh
```

脚本会构建镜像、启动 PostgreSQL 和 Redis、执行迁移、启动 Web 与 worker，并检查内部 `/health/ready`。首次构建需下载依赖；数据卷在容器重建后保留。**不要用 `docker compose down -v` 更新应用。**

生产建议使用仓库外的配置文件：

```bash
ENV_FILE=/opt/prompt-notebook/.env ./scripts/deploy-production.sh
```

目录、权限及 systemd 安装方式见[独立安装指南](docs/installation.md)。

### 4. 配置 HTTPS 反向代理

参考 [Nginx 模板](deploy/nginx/prompt-notebook.conf.example)，替换域名、证书路径和必要的端口：

- `APP_URL` 必须与最终访问的 HTTPS origin 一致。
- 应用默认只绑定 `127.0.0.1:5488`；不要把数据库、Redis 或应用内部端口直接暴露到公网。
- 反向代理应覆盖 `X-Real-IP`，不能直接相信浏览器传入的同名请求头。
- Nginx 请求体上限为 `45m`，其他反代也应提供等效限制。
- Cloudflare **不是必需项**。使用 CDN 时另行配置可信代理与真实客户端 IP。

### 5. 验收与首次登录

```bash
curl --fail https://prompts.example.com/health/live
curl --fail https://prompts.example.com/health/ready
```

换成自己的域名，确认接口成功后：**打开网站 → 注册 → 收到验证邮件 → 完成验证 → 登录**。健康检查只代表核心服务就绪，不代表 SMTP、图床或模型连接已经过功能验证。

<a id="usage"></a>

## 第一次使用：从采集到作品

### 01 / 建立提示词库

新建 Prompt，填写标题、提示词和可选的负面提示词、来源、标签、项目或 AI Model 关联。保存后，其他设备登录同一实例与账户即可访问。图片卡片可打开大图与完整内容；搜索、标签、项目、收藏帮助定位，版本历史与变量模板便于复用，误删后先去回收站。

### 02 / 配置图床

进入 **设置 → 图床**，填写上传端点、公开图片地址等配置与 Token，保存并测试连接。

当前内置 **Picbed-compatible** 协议，不是任意存储服务的一键直连：

```text
POST <你的公网 HTTPS 上传端点>
X-Auth-Token: <你的 Token>
Content-Type: multipart/form-data

file = 图片文件
path = 对象路径
```

JSON 响应可包含 `url`、`publicUrl`、`href`、`location`、`key` 或 `path` 等受支持字段。图片须提供稳定、公开的 HTTPS URL；临时签名链接、查询参数鉴权、localhost 和私网目标不适用于当前安全策略。S3 / R2 等需要兼容适配层，不能直接填入任意控制台 API。

普通上传和参考图每张最多 10 MiB，生成结果每张最多 32 MiB，图床自身也需允许对应大小。[图片协议与归属说明](docs/storage-providers.md)。

### 03 / 配置多套 AI 模型

进入 **设置 → AI 模型**，填写 Base URL、API Key、Model ID，选择能力并保存。不同用途可以指定不同模型：

| 用途 | 需要的模型能力 |
| --- | --- |
| 提示词优化 | 文本生成与指令遵循 |
| 百科词组分析 | 按约定结构输出文本，也可继承优化模型 |
| 图片反推 | 视觉理解 / 图片输入 |
| 图片生成 | 与配置兼容的 Images 生成及编辑接口 |

模型采用 OpenAI-compatible API，**不是所有厂商原生 API 都可直接接入**。端点必须为受支持的公网 HTTPS / 443 地址，当前不支持直接连接 localhost Ollama 或私网网关。连接测试只检查连接和模型列表，不执行付费生图，也不保证代理实现了全部参数。

供应商别名需按其文档设置兼容系列。参数、轮换与超时见[配置说明](docs/configuration.md)。

### 04 / 优化、反推，再测试生成

- **优化**：在编辑器点击 AI 优化，检查结果对比与结构提示，确认后才覆盖原文；取消会保留输入。
- **反推**：在 AI ImageHub 或提示词百科打开图片反推，上传、粘贴或导入图片，补充“衬衫改蓝色”等要求，检查模块、原图观察和修改摘要，再复制、保存或转交生图。
- **生图**：选择本次模型、画布、质量、格式和参考图，提交后在任务墙查看进度；完成后下载、保存为笔记、设为封面或继续编辑。
- **局部编辑**：支持蒙版的模型下，点击第一张本地参考图的“涂抹修改区域”，绘制、确认，再描述修改要求；暂不与 AI Model 角色垫图混用。

参考图与角色垫图合计最多四张，每次最多四张输出；参考图与蒙版单文件最多 10 MiB，整个 multipart 请求最多 44 MiB。图片反推是画面重建建议，不能还原原作者真正的 Prompt，也不保证完全复现。

### 05 / 沉淀为长期资产

- **AI Model**：创建角色，记录用途、设定、主图及备用图；选择角色生成，并将笔记绑定到角色 Profile。
- **提示词百科 → 提示词分析**：AI 分类提取优秀 Prompt 中的可复用描述，人工选择、编辑、去重后收录；编辑笔记时点击插入。
- **七天只读分享**：在预览中创建链接，在分享管理查看开始与到期时间、续期或立即关闭。
- **Dashboard**：查看笔记与词库规模，点击标签计数进入对应作品集合。

<a id="chrome-extension"></a>

## Chrome 扩展：看到好 Prompt，就地收藏

**[下载最新版扩展 ZIP](https://github.com/shynloc/prompt-notebook/releases/latest/download/prompt-notebook-chrome.zip)** · [全部版本](https://github.com/shynloc/prompt-notebook/releases) · [扩展源码](apps/extension)

1. 下载 ZIP，解压到固定文件夹。
2. 在 Chrome 打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择包含 `manifest.json` 的解压目录，不要选择 ZIP。
4. 打开扩展，输入**自己的 Prompt Notebook HTTPS 地址**，点击验证服务器。
5. 点击连接，在自己的站点登录并批准设备授权。
6. 网页选中文字后，点击图标、右键“保存到提示词笔记本中”，或使用 `Alt + Shift + P`。
7. 核对标题、内容、标签与配图后保存，网站中即可看到笔记。

扩展使用 Manifest V3、用户主动触发的 `activeTab` 和按实例申请的可撤销权限，不内置作者服务器地址，不要求作者账户或商店安装。网页配图识别取决于站点结构，不能保证抓取所有社交网站的私有或防盗链图片。升级时替换本地目录，在扩展管理页重新加载。

开发者可自行构建：

```bash
npm ci
npm run extension:test
npm run extension:zip
```

<a id="privacy"></a>

## 隐私、安全与能力边界

| 数据 | 存放位置与边界 |
| --- | --- |
| 笔记、账户、标签、角色、任务 | 你的 PostgreSQL，登录后的数据操作按账户隔离 |
| 模型 Key、图床 Token | 服务端 AES-256-GCM 加密保存，接口不返回完整凭据 |
| 图片文件 | 用户配置的图床；数据库保存 URL 与元数据，不含图片原文件 |
| AI 请求内容 | 按用户操作发往所选供应商，受其数据处理与计费规则约束 |
| 只读分享 | 持有有效链接的人可访问指定内容，私密内容不应创建公开分享 |
| 本页插图 | 仓库内原创 SVG、虚构示意，无实际页面截图或用户数据 |

“自托管”**不是端到端加密，也不是所有功能离线运行**。实例管理员、运行环境、所选模型与图床均属于信任边界，公开图片 URL 也不等于私密对象存储。

出站请求采用公网地址校验、DNS 固定、私网地址拒绝、响应大小与重定向限制。不要为了接入内网网关或临时签名 URL 而关闭这些保护。真实配置、秘密和数据不应进入公开 Git 或 Docker 构建上下文。

本轮覆盖范围、残留 Git 隐私元数据与运维待办见[公开发布与独立部署审查](docs/verification/2026-10-28-public-readiness.md)。安全问题见 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中粘贴密钥或私人笔记。

## 更新、备份与迁移

- **更新**：拉取经过审阅的提交或版本，再运行部署脚本；不要删除数据卷。
- **自动更新可选**：systemd 默认每五分钟检查公开 `main`；先备份再构建、迁移，未就绪则尝试回退应用版本，**不自动回滚数据库结构**。Fork 后检查更新远端与分支。
- **完整备份**：数据库转储 + 凭据加密密钥 + 图床原文件，三者缺一不可；配置与备份建议放在仓库之外，并保留异机副本。
- **恢复演练**：gzip / SHA-256 只验证文件完整性，不等于成功导出 SQL 或完成恢复。当前备份管道失败检测仍需增强，重要数据请采用经过演练的独立备份策略；见[备份与恢复](docs/backup-and-restore.md)。
- **图片删除**：通用图床协议无统一删除接口，永久删除角色、笔记或生成历史不会自动清除图床原文件。
- **账户迁移**：导出不携带可直接复用的模型 / 图床秘密，迁移后需重新配置；图片地址也应持续可用。

## 本地开发与验证

需要 Node.js 22、npm 与 Docker Compose。开发邮件链接输出到服务端控制台，不等同于生产 SMTP。

```bash
npm ci
docker compose -f docker-compose.dev.yml up -d postgres redis
cp .env.example .env.local

# db:migrate 是 CLI，需显式提供 DATABASE_URL
DATABASE_URL=postgres://prompt_notebook:prompt_notebook@127.0.0.1:55432/prompt_notebook_test npm run db:migrate
npm run dev
```

测试 PostgreSQL / Redis 端口分别为 55432 / 56379。本地生图 worker 在另一终端运行：

```bash
npm run build:worker
node --env-file=.env.local dist/generation-worker.mjs
```

常用检查：

```bash
npm run docs:check
npm run lint
npm run typecheck
npm test -- --run
npm run extension:test
npm run build
npm run extension:build
npm run release:check
npm run test:e2e
npm audit --omit=dev
```

数据库集成测试需提供测试 `DATABASE_URL`；构建与浏览器测试也要加载必要环境。更多约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。[Vitest](vitest.config.ts)、[Playwright](playwright.config.ts) 和 [CI 工作流](.github/workflows/ci.yml) 是可执行依据，徽章不代表没有任何缺陷。

<a id="faq"></a>

## 常见问题

<details>
<summary><strong>没有 WordPress、Cloudflare 或作者账号，能用吗？</strong></summary>

可以。账户、数据库和队列随项目部署，两者都不是依赖。你需要自己的域名 / HTTPS、生产 SMTP，以及按需配置的模型与图床；扩展连接你的站点，不连接作者站点。

</details>

<details>
<summary><strong>为什么 ready 正常，注册却收不到邮件？</strong></summary>

ready 不验证邮件投递。检查 SMTP 主机、端口、发件人、用户名、密码、垃圾箱和发送限制。当前生产环境强制邮箱验证，不能靠留空 SMTP 获得完整登录流程。

</details>

<details>
<summary><strong>不配置 AI 和图床，可以只用文本笔记吗？</strong></summary>

可以。文本笔记、搜索、标签、项目、收藏和分享不要求模型或图床；图片与 AI 功能需要对应服务。网站登录仍需满足生产认证条件。

</details>

<details>
<summary><strong>支持任意模型、S3 / R2、Ollama 或内网 API 吗？</strong></summary>

不能这样承诺。当前使用 OpenAI-compatible 与 Picbed-compatible 协议，并拒绝私网 / localhost 出站目标。其他原生协议、签名 URL 或私网网关需要适配方案，不应直接关闭 SSRF 保护。

</details>

<details>
<summary><strong>清理缓存或换设备，笔记会丢吗？</strong></summary>

成功保存的笔记在服务端 PostgreSQL，不依赖单台设备缓存。未保存草稿与扩展本地连接状态不在此保证内；服务器、图床仍需备份，删除数据卷也会丢失服务端数据。

</details>

<details>
<summary><strong>为什么 package.json 有 private: true，还能 MIT 开源吗？</strong></summary>

它用于防止误发布到 npm，不会把 GitHub 仓库变为私有，也不限制依照 MIT 许可证自行部署、修改和分发。

</details>

## 文档与参与

| 想了解什么 | 从这里开始 |
| --- | --- |
| 安装、目录与 systemd | [Installation](docs/installation.md) |
| SMTP、IP、密钥、模型与限制 | [Configuration](docs/configuration.md) |
| 图片协议与归属 | [Storage providers](docs/storage-providers.md) |
| 备份与恢复演练 | [Backup and restore](docs/backup-and-restore.md) |
| 性能与容量准备 | [Performance](docs/performance.md) |
| 技术架构与决策 | [Architecture](docs/architecture.md) · [ADR](docs/adr/README.md) |
| 公开发布与独立部署审查 | [Public readiness audit](docs/verification/2026-10-28-public-readiness.md) |
| 版本变更 | [Changelog](CHANGELOG.md) · [Releases](https://github.com/shynloc/prompt-notebook/releases) |
| 贡献与安全报告 | [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) |

欢迎提交可复现的 Issue 和有测试覆盖的改进。报告问题前，请删除截图和日志中的账户、笔记、模型 Key 与图床 Token。

**[MIT License](LICENSE)** · Built for ideas worth keeping.
