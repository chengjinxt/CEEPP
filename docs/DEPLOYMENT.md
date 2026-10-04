# CEEPP 发布与自动部署

本项目使用 Cloudflare Workers 托管网站与 API、D1 存储试卷数据、Workers Builds 连接 GitHub `main` 自动部署。首期使用免费套餐和 `workers.dev` 地址。本文区分构建时配置、Worker 运行时配置和 GitHub Actions Secrets；三者不能互相替代。

## 本次上线记录（2026-10-04）

- 生产地址：[https://ceepp.chengjinxuetang.workers.dev](https://ceepp.chengjinxuetang.workers.dev)。已发布 `ceepp` Worker，绑定 `ceepp` D1；首次自动构建发布版本为 `69a3d496-1b0c-4d22-8936-0d078b2ba552`。
- D1 已应用 `0001_init.sql`。实测首页正常打开，`GET /api/papers` 返回 HTTP 200 和空列表；首批试卷尚未审核发布，空列表是预期结果。
- Cloudflare Access 已启用：`CEEPP Admin` 应用只覆盖 `/admin` 和 `/admin/*`，Allow 策略只允许 `chengjinxuetang@hotmail.com`。Worker 运行时的团队域名、AUD 和管理员邮箱也已配置。未登录时实测 `/admin` 跳转 Access 登录（HTTP 302），首页及 `GET /api/papers` 仍返回 HTTP 200。启用 Access 前的 `/admin` HTTP 403 是历史记录，不再代表当前状态。
- Cloudflare GitHub App 仅获准访问 `chengjinxt/CEEPP`，Worker 的 **Settings > Builds** 已连接该仓库的 `main`；Build command 为 `pnpm lint && pnpm test && pnpm build`，Deploy command 为 `pnpm deploy`，预览构建关闭。构建令牌 `ceepp-workers-builds-auto` 已缩减为当前账号的 D1 Edit 与 Workers Scripts Edit。提交 `cc2f31c` 推送到 `main` 后，[首次自动构建 #242b54ea](https://dash.cloudflare.com/ca11979ca46285840cb4dad01152679c/workers/services/view/ceepp/production/builds/242b54ea-a201-4c6e-9f57-524fb8687586)的安装、lint、测试、构建、远程 D1 迁移检查与 Worker 发布全部成功；迁移日志为 `No migrations to apply!`，因为首次手动发布时已应用 `0001_init.sql`。

## 访问地址与管理员操作

| 用途 | 地址 | 访问方式 |
| --- | --- | --- |
| 公开网站 | [ceepp.chengjinxuetang.workers.dev](https://ceepp.chengjinxuetang.workers.dev/) | 浏览器直接打开本站，无需登录；按年份、卷别、地区、科目筛选，进入试卷详情后打开资源。仅显示已发布试卷；第三方网盘或来源站的下载要求以资源页面为准。 |
| 公开 API | [`GET /api/papers`](https://ceepp.chengjinxuetang.workers.dev/api/papers)、`GET /api/papers/:id` | 无需登录；列表支持 `year`、`scope`、`region`、`subject`、`q`、`page` 查询参数，详情中的 `:id` 替换为真实试卷 ID。只返回已发布试卷。 |
| 管理后台 | [网站 `/admin`](https://ceepp.chengjinxuetang.workers.dev/admin) | 仅指定管理员登录。此入口先经过 Cloudflare Access，成功后转到 `/admin/candidates`。 |
| 采集候选审核 | [网站 `/admin/candidates`](https://ceepp.chengjinxuetang.workers.dev/admin/candidates) | 审核采集候选，选择拒绝、创建草稿或合并到现有试卷；采集不会自动发布。 |
| 试卷管理 | [网站 `/admin/papers`](https://ceepp.chengjinxuetang.workers.dev/admin/papers) | 补录或编辑试卷、地区及资源链接，核验后发布；也可下架。 |
| Cloudflare 运维 | [ceepp Worker 控制台](https://dash.cloudflare.com/ca11979ca46285840cb4dad01152679c/workers/services/view/ceepp/production)、[Cloudflare 控制台](https://dash.cloudflare.com/) | 使用有该 Cloudflare 账号权限的身份登录；查看 Builds、D1、运行时变量。Access 应用及策略在 **Zero Trust > Access controls > Applications** 中管理。 |
| 代码与每周采集 | [GitHub 仓库](https://github.com/chengjinxt/CEEPP)、[Actions](https://github.com/chengjinxt/CEEPP/actions) | 使用有仓库权限的 GitHub 账号查看提交、自动构建以外的每周采集工作流及其运行记录。 |

管理员日常使用：在浏览器打开 `/admin`，按 Cloudflare Access 登录页提示选择 **Cloudflare** 身份提供商，使用 `chengjinxuetang@hotmail.com` 对应的 Cloudflare 账号完成验证；不要把 GitHub 登录或 GitHub App 授权误当成后台登录。Access 的 Allow 策略只允许此邮箱，Worker 还会校验令牌的签名、签发者、AUD 与邮箱。登录后先处理候选，再到试卷管理页检查资源并发布。`/admin/api/*` 是后台专用接口，同样受 Access 和 Worker 校验保护，不需要手工复制令牌调用。若当前试卷列表为空，表示尚无已审核发布的试卷，并非网站不可访问。

术语：**AUD** 是 Application Audience（应用受众标识）。Cloudflare Access 为每个应用分配一个唯一 AUD；登录 JWT 的 `aud` 表明令牌适用于哪个应用。`ACCESS_AUD` 是 Worker 用来确认令牌确实发给 `CEEPP Admin` 的运行时变量，不是密码或 API Token；在 **Zero Trust > Access controls > Applications** 中打开 `CEEPP Admin`，查找 **Application Audience (AUD) Tag**（通常在 Additional settings）。[Cloudflare：验证 Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

**MFA** 是 Multi-Factor Authentication（多因素认证），即登录时在一种凭据之外再验证另一种因素，例如验证器动态码或安全密钥。本次配置时，CEEPP Access 应用的额外 MFA 策略显示为 Off；这与管理员的 Cloudflare 账号本身是否启用双重验证是两回事，不能互相推断。以后若要由 Access 强制独立 MFA，先在 Zero Trust 组织级启用，再在应用或策略级配置并重新验证登录流程。[Cloudflare：配置 Access MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/)

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
| `ACCESS_TEAM_DOMAIN` | 当前为 `https://shrill-mouse-73fc.cloudflareaccess.com`；其他账号使用自己的团队域名 |
| `ACCESS_AUD` | 上述同一 Access 应用的 AUD |
| `ADMIN_EMAIL` | 当前为 `chengjinxuetang@hotmail.com`，与 Allow 策略的唯一管理员邮箱一致 |

这里是 Worker **运行时**变量，不是 Workers Builds 的 Build variables。仓库 [`wrangler.jsonc`](../wrangler.jsonc) 设置了 `keep_vars: true`，后续 Wrangler 部署会保留控制台设置的变量。管理请求在 Worker 内还要通过 Access JWT 签名、签发者、AUD 和邮箱校验；变量缺失时返回 403。[Access JWT 校验](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

## 3. 验收与后续自动发布

1. 查看 Workers Builds 的 `main` 构建日志：lint、测试、Vite build、远程 D1 migration、Worker deploy 均应成功。D1 控制台应出现 `d1_migrations` 及业务表；迁移只需对同一数据库应用一次。
2. 无痕窗口访问 Worker 根路径和 `/api/papers`，应能匿名打开；没有已发布试卷时列表为空是正常状态。当前 Access 已启用：无痕访问 `/admin`、`/admin/papers` 及 `/admin/api/papers` 应跳转 Access 登录、挑战或明确拒绝页；仅被允许的管理员登录后，后台才应打开。若只看到 Worker 返回的 JSON 403，**不能证明**路径已受 Access 保护，应核对第 2 节的应用路径配置。
3. 核实任何非 `main` 分支都不会执行 `pnpm deploy` 或生产 D1 迁移。以后每次改动按下文的日常流程操作；新增迁移要检查是否兼容当前线上代码。

每周采集是另一条链路，由 [GitHub Actions](../.github/workflows/crawl.yml) 运行，不是 Workers Builds。要启用它，在 GitHub 仓库的 Actions Secrets 配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`；其中 D1 ID 必须与 `wrangler.jsonc` 中生产数据库的 ID 完全相同，否则采集会写入另一座数据库。这里应使用单独的、限定到该账号且具备 D1 Edit 的 token。采集只写待审核候选，不会自动公开。不要将这些值写入文档或提交到仓库。

## 日常修改、本地验证与自动发布

以下流程适用于 GitHub `main` 与 Workers Builds 已连接后的每次改动。项目要求改动配套测试、全部验证通过后创建对应 Git commit。不要把“已推送 GitHub”当作“已上线”；只有与该提交对应的 Cloudflare 构建和部署成功，才算发布完成。

1. **确认范围并修改。** 在仓库目录运行 `git rev-parse --show-toplevel` 和 `git status --short --branch`，记下已有的无关改动，不要覆盖或顺手提交。修复故障时先补能复现问题的回归测试，确认它因原故障失败，再做最小修改并确认测试转绿。修改 D1 schema 时新增迁移文件，不直接改生产库。
2. **本地运行与验证。** 使用 Node.js 24 和 pnpm 11.19.0；已安装 nvm-windows 时先执行 `nvm use 24`，再用 `node --version`、`pnpm --version` 核对。首次运行或锁文件变化后执行 `pnpm install --frozen-lockfile`。首次建立本地 D1，或新增迁移文件后，先运行 `pnpm exec wrangler d1 migrations apply ceepp --local`，否则首页请求试卷表时可能报缺表。需要查看页面时再运行 `pnpm dev`，按终端给出的本地地址打开网站。提交前依次运行：

   ```sh
   pnpm lint
   pnpm test
   pnpm build
   git diff --check
   ```

   `pnpm test` 包含浏览器端单元测试和 Worker 测试。本地开发服务没有生产环境的 Cloudflare Access 登录流程；在本地点击管理后台后看到未授权响应，不能据此判断线上 Access 配置是否正常。后台入口的导航行为由回归测试验证，真正的 Access 登录须在发布后用无痕浏览器验收。
3. **只提交本次文件。** 确认当前分支为 `main`；其他分支先按项目流程把已验证的改动合入 `main`，不能直接部署生产。查看 `git diff --stat` 和 `git status --short`，明确文件范围；用 `git add --` 后面逐个列出本次文件，再运行 `git diff --cached --check` 与 `git diff --cached --stat` 核对。创建说明本次修改的 commit，并运行 `git push origin main`；不要用 `git add -A` 把本地笔记、密钥或其他无关文件带入提交。
4. **确认自动构建与部署。** 打开 [ceepp 的 Cloudflare Builds](https://dash.cloudflare.com/ca11979ca46285840cb4dad01152679c/workers/services/view/ceepp/production/builds)，找到刚推送的 commit SHA，而非只看最新一行是否为绿色。展开该构建，确认 `pnpm lint && pnpm test && pnpm build` 和 `pnpm deploy` 都成功；Deploy 阶段应先完成远程 D1 迁移，再发布 Worker。本次没有新迁移时，`No migrations to apply!` 是正常结果。失败时读取该构建日志、修复并重新验证后再提交；不要跳过迁移直接手工发布。
5. **线上验收。** 匿名访问[首页](https://ceepp.chengjinxuetang.workers.dev/)与 [`GET /api/papers`](https://ceepp.chengjinxuetang.workers.dev/api/papers)应正常。用未登录的新浏览器会话从**首页实际点击**页眉的“管理后台”入口，确认会进入 Cloudflare Access 登录流程；登录后应到 `/admin/candidates` 且后台接口能加载。页脚入口也要从首页点击验证；若要再次检查首次登录提示，需使用另一个隔离的未登录会话。不要只在地址栏直接输入 `/admin`，因为那无法覆盖前端链接拦截故障。已有 Access 会话时直接进入后台而不再显示登录页是正常现象。最后运行 `git status --short --branch`，确认本地提交已与 `origin/main` 同步。

### 2026-10-04 管理后台入口修复实例

- 故障：公开页的“管理后台”原为 Vue `RouterLink`，点击只切换前端路由，没有向 `/admin` 发起整页请求；首次后台 API 请求才遇到 Access 重定向，于是页面显示 `Failed to fetch`。在地址栏直接访问后台地址却能完成登录。
- 修改：[App.vue](../src/client/App.vue) 的页眉和页脚入口改为原生 `<a href="/admin">`，让首次点击先由 Access 检查；后台内部路由保持不变。[导航回归测试](../tests/client/navigation.test.ts)覆盖两个入口不被 Vue Router 拦截。测试在修改前两项失败、修改后通过。
- 本地验证：定向导航测试可运行 `pnpm exec vitest run tests/client/navigation.test.ts --config vitest.config.ts`；本次在 Codex 的 Windows 终端因 `pnpm exec` 未找到可执行文件，改用 `.\node_modules\.bin\vitest.cmd run tests/client/navigation.test.ts --config vitest.config.ts` 运行，结果 4/4。完整单元测试 35/35、Worker 测试 16/16、类型检查和 Vite 构建通过；`git diff --check` 通过。
- 提交与发布：仅暂存 `src/client/App.vue`、`tests/client/navigation.test.ts`，运行 `git diff --cached --check` 后创建 [`c7a39bf`](https://github.com/chengjinxt/CEEPP/commit/c7a39bf357a7c637d016d854bbb50a5f04c4164f) 并执行 `git push origin main`。[Cloudflare 构建 #2edb398f](https://dash.cloudflare.com/ca11979ca46285840cb4dad01152679c/workers/services/view/ceepp/production/builds/2edb398f-18db-4c29-81e4-88904893056f)显示成功。线上首页已引用新前端资源；匿名请求 `/admin` 返回 Access 登录重定向（HTTP 302），`/api/papers` 返回 HTTP 200。无痕窗口点击入口并完成管理员交互式登录仍需按上一步人工确认。

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
| 从首页点“管理后台”不显示登录，后台报 `Failed to fetch`；直接输入 `/admin` 却能登录 | 检查公开页入口是否使用原生 `<a href="/admin">` 发起整页请求，而非只切换 Vue 前端路由；再核对线上构建 SHA、Access 的 `/admin` 路径，并用未登录的新会话重试。 |
| 首页也要求登录 | 误启用了 Worker 级或账号级 Access；应仅保护 `workers.dev` 主机的管理路径。 |
| `/api/papers` 返回空列表 | 尚未有管理员审核并发布试卷；先检查管理后台和 D1，不要把采集候选直接公开。 |

保持免费计划时关注 [Workers 用量](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 用量](https://developers.cloudflare.com/d1/platform/pricing/)及 [Workers Builds 额度](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)；Builds 免费额度目前为每月 3,000 构建分钟、并发 1 次、单次最长 20 分钟。接近额度时先优化查询与采集频率，不自动升级付费。
