# CEEPP 普通高考真题站

首期收录普通高考历年全科试卷。访客可按年份、卷别、适用地区、科目和名称查找已发布试卷，并打开 PDF、HTML 或网盘资源；采集结果只进入待审核队列，不会自动公开。前台与后台使用 Vue 3，API 运行在 Cloudflare Worker，数据存于 D1。

## 本地运行

需要 Node.js 24、pnpm 11。首次运行：

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations apply ceepp --local
pnpm dev
```

本地 D1 与生产 D1 分离。`/admin/*` 需要有效的 Cloudflare Access JWT；本地无令牌时会拒绝管理操作。可运行以下检查：

```sh
pnpm lint
pnpm test
pnpm build
```

公开 API 是 `GET /api/papers`（支持 `year`、`scope`、`region`、`subject`、`q`、`page`）和 `GET /api/papers/:id`。仅返回已发布试卷，供网站及后续小程序复用。管理员在 `/admin/*` 审核候选、补录资源、发布或下架试卷。

## 首次上线（需 Cloudflare 和 GitHub 账号）

1. 在 Cloudflare 建立名为 `ceepp` 的 D1 数据库，将其真实 UUID 写入 [`wrangler.jsonc`](wrangler.jsonc) 的 `database_id`，替换仓库中的全零占位值。切勿使用占位值部署。启用免费的 `workers.dev` 子域。
2. 创建名为 `ceepp` 的 Worker，并将本仓库连接到 Workers Builds。生产分支选择 `main`，关闭非生产分支 Preview（或保留默认 Preview 命令，**不能**设为 `pnpm deploy`）。Build variables 设置 `NODE_VERSION=24`、`PNPM_VERSION=11.19.0`。Build command 设为 `pnpm lint && pnpm test && pnpm build`，Deploy command 设为 `pnpm deploy`。连接 Worker 的名称必须与 Wrangler 的 `name` 一致。
3. Workers Builds 使用的 API token 必须有 Workers 部署权限及账号级 **D1 Edit** 权限；默认自动生成的构建 token 不包含 D1 权限，不能执行生产迁移。将有权限的自定义 token 配置为 Workers Builds 的 API token，不要提交到 Git。
4. 首次 Worker 已有 `workers.dev` 地址后，在 Zero Trust > Access > Applications 建立 self-hosted 应用，只保护 `ceepp.<你的子域>.workers.dev/admin` 及其子路径，Allow 策略只列出一名管理员的邮箱。不要保护整个 Worker，否则公开目录也会要求登录。记下该 Access 应用的 AUD 与团队域名。
5. 在 Worker 的 Settings > Variables & Secrets 配置运行时 `ACCESS_TEAM_DOMAIN`（如 `https://team.cloudflareaccess.com`）、`ACCESS_AUD`（上述应用 AUD）、`ADMIN_EMAIL`（允许的唯一邮箱）。`keep_vars` 会保留控制台配置的变量。未正确配置时后台应拒绝访问；写接口还会校验 Access JWT 签名、受众与管理员邮箱。
6. 推送到 `main` 后，Workers Builds 先执行 lint、测试和构建，再按顺序执行远程 D1 迁移与 Worker 发布。迁移失败即停止发布。部署脚本会拒绝任何非 `main` 分支写生产库，包括本地手动执行。生产地址形如 `https://ceepp.<你的子域>.workers.dev`。

这些账号侧设置和真实数据库 UUID 无法从仓库自动生成；完成后可在 Workers Builds 日志确认首次发布。不要把 Cloudflare token 或 `.dev.vars` 提交到版本库。

## 采集与审核

`pnpm crawl --dry-run` 仅抓取和统计；`pnpm crawl` 将去重后的候选写入 D1，不发布试卷。采集器读取 `deekur/gaokaomath` 普通高考目录与 `t.urongda.com/exams` 年份页，排除春考、答案单页和解析资料，模糊分类留待人工复核。本站网盘文件由管理员手工上传，随后在后台录入分享链接和提取码。

每周采集由 [GitHub Actions](.github/workflows/crawl.yml) 执行，也可手动触发。仓库 Secrets 需要 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`（D1 Edit）；可选 `GITHUB_TOKEN`。采集只在 `main` 上运行。抓取来源、资源版权与可下载性仍需管理员逐条核验。

## 免费额度与运维

默认保持免费套餐。Workers 免费计划每日动态请求和 D1 的读写额度有限，前台查询已分页、字段有索引；应在 Cloudflare 控制台监控 Workers/D1 用量。接近额度时先优化查询和降低采集频率，不自动升级付费。公开内容只包含经管理员核验的资料和可访问链接。
