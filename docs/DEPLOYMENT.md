# CEEPP 发布与自动部署

本项目使用 Cloudflare Workers 托管网站与 API、D1 存储试卷数据、Workers Builds 连接 GitHub `main` 自动部署。首期使用免费套餐和 `workers.dev` 地址。本文区分构建时配置、Worker 运行时配置和 GitHub Actions Secrets；三者不能互相替代。

## 本次上线记录（2026-10-04）

- 生产地址：[https://ceepp.chengjinxuetang.workers.dev](https://ceepp.chengjinxuetang.workers.dev)。已使用 Wrangler 发布 `ceepp` Worker（版本 `9006b366-caa5-48c9-8e54-3ae8aa02c972`），并绑定 `ceepp` D1。
- D1 已应用 `0001_init.sql`。实测首页正常打开，`GET /api/papers` 返回 HTTP 200 和空列表；首批试卷尚未审核发布，空列表是预期结果。
- 未配置 Cloudflare Access 前，`/admin` 实测返回 HTTP 403。此时公开站可用，但管理员尚不能登录后台；必须完成下文第 2 节才能启用审核发布。
- Cloudflare GitHub App 仅获准访问 `chengjinxt/CEEPP`，Worker 的 **Settings > Builds** 已连接该仓库的 `main`；Build command 为 `pnpm lint && pnpm test && pnpm build`，Deploy command 为 `pnpm deploy`，预览构建关闭。构建令牌 `ceepp-workers-builds-auto` 已缩减为当前账号的 D1 Edit 与 Workers Scripts Edit。首次自动构建仍须通过一次 `main` 推送验证，不能仅凭“已连接”认定自动部署成功。

## 发布前核对

- Cloudflare 账号已启用 `workers.dev` 子域；GitHub 仓库 `chengjinxt/CEEPP` 的 `main` 已有待发布代码。登录 Cloudflare 时使用 GitHub 账号，不等于已经授权 Cloudflare Workers & Pages GitHub App 读取仓库。
- 当前 Cloudflare 账号已创建名为 `ceepp` 的 D1 数据库，数据库 ID 为 `336ace7b-b8bf-49fe-9e1e-673822d49e7e`。不要重复创建；在 D1 控制台核对 ID 与 [`wrangler.jsonc`](../wrangler.jsonc) 中 `d1_databases[0].database_id` 完全一致。`binding` 保持 `DB`、`database_name` 保持 `ceepp`。D1 ID 不是密钥，但切勿把 API token 写进仓库。
- 本地先运行 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm test`、`pnpm build`。本地 D1 迁移可用 `pnpm exec wrangler d1 migrations apply ceepp --local` 验证；`--local` 不会改动生产库。
- 核实提交在 `main` 且相关测试通过。项目要求每次改动有对应测试和 Git commit；随后推送 `main` 才会触发自动部署。

## 1. 连接 GitHub 与 Workers Builds

在 Cloudflare 控制台打开 **Workers & Pages > Create application > Import a repository**，连接 GitHub，并仅授权本仓库（或按实际组织权限选择）。选 `chengjinxt/CEEPP`，Worker 名设为 `ceepp`，根目录设为仓库根目录 `/`。如果已存在同名 Worker，改走 **Workers & Pages > ceepp > Settings > Builds > Connect**。Worker 名必须与 [`wrangler.jsonc`](../wrangler.jsonc) 的 `name` 相同。Cloudflare 的[新建和连接已有 Worker 步骤](https://developers.cloudflare.com/workers/ci-cd/builds/)可对照控制台。

在 Build 设置中填写：

| 设置 | 值 |
| --- | --- |
| Production branch | `main` |
| Root directory | `/`（仓库根目录） |
| Build command | `pnpm lint && pnpm test && pnpm build` |
| Deploy command | `pnpm deploy` |
| Build variable `NODE_VERSION` | `24` |
| Build variable `PNPM_VERSION` | `11.19.0` |
| Preview branches/builds | 关闭；首期不部署其他分支 |

Workers Builds 会自动安装依赖，不需要在 Build command 中重复执行 `pnpm install`。Cloudflare 的构建镜像默认 pnpm 版本可能与仓库 `packageManager` 不同，因此显式指定 `PNPM_VERSION`；[构建镜像文档](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)列出了可覆盖的工具版本。`pnpm build` 通过 Cloudflare Vite 插件生成发布所需的 Wrangler 配置；随后的 `wrangler deploy` 会使用这份构建产物配置，而非把源码目录当成静态站点直接上传。[Vite 插件说明](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)

生产部署脚本 [`scripts/deploy.ts`](../scripts/deploy.ts) 检查 `WORKERS_CI_BRANCH === 'main'`，再依次执行 `wrangler d1 migrations apply ceepp --remote` 和 `wrangler deploy`；迁移失败即停止发布。不要把非生产分支的 Preview command 改成 `pnpm deploy`。由于预览绑定同一个 D1 ID 时可能共享生产数据，首期直接关闭 Preview；以后需要预览时先配独立 D1。[Workers Builds 分支控制](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)、[预览资源隔离](https://developers.cloudflare.com/workers/previews/resources/)

### 配置 Builds API token

Cloudflare 自动生成的 Builds token 默认包含多项产品权限，不能不经检查就保留，也可能缺少远程迁移所需的 D1 Edit。在 **My Profile > API Tokens** 创建用户级自定义 token，限定到部署账号，至少授予 **Account > Workers Scripts > Edit** 和 **Account > D1 > Edit**。如果 **Settings > Builds > API token** 下拉框能选到这个 token，直接选它；本次控制台只提供 **Create new token**，因此先连接仓库，再立即到 **My Profile > API Tokens > 自动生成的 token > Edit**，删去所有无关权限并补齐 D1 Edit，保存后复核摘要只含当前账号的这两项权限。不要在收紧前推送触发构建。Workers Builds 当前只支持用户级 token；不要选账号级 token，也不要把令牌值放进 Git、README 或 Build variables。[Build token 权限说明](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[D1 Edit 权限](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)

如果 GitHub 显示 App 已安装且只授权 CEEPP，但 Cloudflare 的连接按钮反复打开 GitHub App 设置页、没有列出仓库，先确认该 App 是否仍供其他项目使用。经所有者批准后，可按 [Cloudflare 的 GitHub 集成排障说明](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)卸载并重装：从 Cloudflare **Create application > Pages > Import an existing Git repository > Connect GitHub** 发起安装，只选 CEEPP，在 GitHub 点 **Install & Authorize**，回到 Cloudflare 确认仓库已列出；不要额外创建 Pages 项目，再返回现有 Worker 的 **Settings > Builds > Connect**。卸载会暂停同一 App 下其他项目的自动构建，须先核查影响。

如果“Save and Deploy”在 token 配好前已触发首次构建，可能出现 D1 权限错误；配置正确 token 后重试该构建即可。不要为了绕过失败而跳过迁移直接发布。

## 2. 保护管理路径

首次构建成功后，取得 `https://ceepp.<账号子域>.workers.dev`。公开首页与 `/api/*` 保持匿名可访问。管理路径需在 **Zero Trust > Access > Applications** 新建一个 **Self-hosted** 应用，目标使用上述 `workers.dev` 主机的路径，并在**同一个应用**中覆盖 `/admin` 和 `/admin/*`。`/admin/*` 单独配置不匹配 `/admin` 本身；分成两个应用又会产生不同 AUD，而当前 Worker 只接受一个 `ACCESS_AUD`。Allow 策略仅填实际管理员邮箱，不要使用“保护整个 Worker”或“保护所有 Workers”，否则公开站也会被要求登录。[Worker 的路径级 Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)、[路径匹配规则](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)

首次启用 Zero Trust 时可选 Free 计划。Cloudflare 的[当前设置流程](https://developers.cloudflare.com/cloudflare-one/setup/)仍要求输入支付信息，即使 Free 计划不会收费；此步骤应由账号所有者亲自完成。

从此 Access 应用记录 **Application AUD**，从 Zero Trust 设置记录团队域名；在 **Workers & Pages > ceepp > Settings > Variables & Secrets** 添加运行时变量：

| 变量 | 值的形式 |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | 上述同一 Access 应用的 AUD |
| `ADMIN_EMAIL` | Allow 策略所允许的唯一管理员邮箱 |

这里是 Worker **运行时**变量，不是 Workers Builds 的 Build variables。仓库 [`wrangler.jsonc`](../wrangler.jsonc) 设置了 `keep_vars: true`，后续 Wrangler 部署会保留控制台设置的变量。管理请求在 Worker 内还要通过 Access JWT 签名、签发者、AUD 和邮箱校验；变量缺失时返回 403。[Access JWT 校验](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 3. 验收与后续自动发布

1. 查看 Workers Builds 的 `main` 构建日志：lint、测试、Vite build、远程 D1 migration、Worker deploy 均应成功。D1 控制台应出现 `d1_migrations` 及业务表；迁移只需对同一数据库应用一次。
2. 无痕窗口访问 Worker 根路径和 `/api/papers`，应能匿名打开；没有已发布试卷时列表为空是正常状态。访问 `/admin`、`/admin/papers` 及 `/admin/api/papers`，未登录应进入 Access 登录或被拒绝，不能看到后台数据。用被允许的邮箱登录后，后台应可打开。
3. 核实任何非 `main` 分支都不会执行 `pnpm deploy` 或生产 D1 迁移。以后每次改动：本地测试通过 → 提交 → 推送 `main` → 查看 Builds 日志与站点。D1 迁移先于 Worker 发布；新增迁移要检查是否兼容当前线上代码。

每周采集是另一条链路，由 [GitHub Actions](../.github/workflows/crawl.yml) 运行，不是 Workers Builds。要启用它，在 GitHub 仓库的 Actions Secrets 配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`；其中 D1 ID 必须与 `wrangler.jsonc` 中生产数据库的 ID 完全相同，否则采集会写入另一座数据库。这里应使用单独的、限定到该账号且具备 D1 Edit 的 token。采集只写待审核候选，不会自动公开。不要将这些值写入文档或提交到仓库。

## 常见故障

| 现象 | 优先检查 |
| --- | --- |
| GitHub 仓库不在导入列表 | Cloudflare Workers & Pages GitHub App 是否获准访问 `chengjinxt/CEEPP`；“用 GitHub 登录 Cloudflare”并不自动完成此授权。 |
| GitHub App 已安装，但连接按钮只打开 App 设置页 | 账号连接可能未完成；核查其他项目影响后，按上文排障流程从 Cloudflare 重新发起安装与授权。 |
| 首次构建找不到 Worker 或名称不符 | Worker 名与 `wrangler.jsonc` 的 `name` 是否都是 `ceepp`；Build 根目录是否为 `/`。 |
| `pnpm` 或 Node 版本不符 | Build variables 中 `NODE_VERSION=24`、`PNPM_VERSION=11.19.0`；检查 Builds 安装依赖阶段日志。 |
| D1 migration 报无数据库或权限不足 | 核对 `database_id`、账号及 Builds 的**用户级** token 是否有 D1 Edit；修正后重试构建，不要跳过迁移。 |
| 发布脚本提示只允许 `main` | 核对 Production branch 和 Builds 注入的 `WORKERS_CI_BRANCH`；不要在其他分支手工执行生产部署。 |
| `/admin` 直接 403、没有登录页 | 核对 Access 应用是否覆盖根路径 `/admin`，Worker 运行时三个变量是否已配置；JWT 校验本身也会在配置错误时拒绝。 |
| 登录后后台仍为 403 | 核对 `ACCESS_AUD`、团队域名、`ADMIN_EMAIL` 与登录身份的邮箱是否一致，且 `/admin` 与 `/admin/*` 属于同一 Access 应用。 |
| 首页也要求登录 | 误启用了 Worker 级或账号级 Access；应仅保护 `workers.dev` 主机的管理路径。 |
| `/api/papers` 返回空列表 | 尚未有管理员审核并发布试卷；先检查管理后台和 D1，不要把采集候选直接公开。 |

保持免费计划时关注 [Workers 用量](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 用量](https://developers.cloudflare.com/d1/platform/pricing/)及 [Workers Builds 额度](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)；Builds 免费额度目前为每月 3,000 构建分钟、并发 1 次、单次最长 20 分钟。接近额度时先优化查询与采集频率，不自动升级付费。
