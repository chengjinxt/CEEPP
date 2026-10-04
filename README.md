# CEEPP 普通高考真题站

首期收录普通高考历年全科试卷。访客可按年份、卷别、适用地区、科目和名称查找已发布试卷，并打开 PDF、HTML 或网盘资源；采集结果只进入待审核队列，不会自动公开。前台与后台使用 Vue 3，API 运行在 Cloudflare Worker，数据存于 D1。

## 在线访问

- 公开网站：[https://ceepp.chengjinxuetang.workers.dev/](https://ceepp.chengjinxuetang.workers.dev/)，浏览本站已发布资料无需登录；第三方网盘或来源站的下载要求以资源页面为准。
- 管理后台：[https://ceepp.chengjinxuetang.workers.dev/admin](https://ceepp.chengjinxuetang.workers.dev/admin)，仅限指定管理员通过 Cloudflare Access 登录；登录后进入采集候选审核页。

公开 API、试卷管理入口、管理员登录步骤及 AUD/MFA 说明见[发布与访问指南](docs/DEPLOYMENT.md#访问地址与管理员操作)。

## 本地运行

需要 Node.js 24、pnpm 11。首次运行：

如果使用 nvm-windows，先用 `nvm list` 检查本机版本；没有 Node 24 时运行 `nvm install 24`，再运行 `nvm use 24` 和 `node --version` 确认版本。nvm 不会自动安装 pnpm，仍需准备 pnpm 11。

```sh
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations apply ceepp --local
pnpm dev
```

本地 D1 与生产 D1 分离。`/admin` 及其子路径需要有效的 Cloudflare Access JWT；本地无令牌时会拒绝管理操作。可运行以下检查：

```sh
pnpm lint
pnpm test
pnpm build
```

每次修改后的测试、Git 提交、Workers Builds 自动发布与线上验收步骤见[日常修改与发布流程](docs/DEPLOYMENT.md#日常修改本地验证与自动发布)；其中后台登录问题必须从首页点击入口验证，不能只在地址栏直接打开 `/admin`。

公开 API 是 `GET /api/papers`（支持 `year`、`scope`、`region`、`subject`、`q`、`page`）和 `GET /api/papers/:id`。仅返回已发布试卷，供网站及后续小程序复用。管理员在 `/admin` 及其子路径审核候选、补录资源、发布或下架试卷。

## 首次上线（需 Cloudflare 和 GitHub 账号）

完整操作、验收与故障排查见 [发布与自动部署指南](docs/DEPLOYMENT.md)。当前 Cloudflare 账号已创建 `ceepp` D1；上线前需核对其真实 ID 与 [`wrangler.jsonc`](wrangler.jsonc) 的绑定一致。Workers Builds 只部署 `main`：Build command 为 `pnpm lint && pnpm test && pnpm build`，Deploy command 为 `pnpm deploy`，非生产 Preview 关闭。构建 token 需要 D1 Edit 才能先迁移、再发布 Worker。

后台只在同一个 Cloudflare Access 应用中保护 `/admin` 和 `/admin/*`，公开站与 `/api/*` 保持匿名可访问。账号侧的 Access 设置、运行时变量和 GitHub Actions Secrets 均须按指南配置；不要把 API token 或 `.dev.vars` 提交到版本库。

## 采集与审核

`pnpm crawl --dry-run` 仅抓取和统计；`pnpm crawl` 将去重后的候选写入 D1，不发布试卷。采集器读取 `deekur/gaokaomath` 普通高考目录与 `t.urongda.com/exams` 年份页，排除春考、答案单页和解析资料，模糊分类留待人工复核。本站网盘文件由管理员手工上传，随后在后台录入分享链接和提取码。

每周采集由 [GitHub Actions](.github/workflows/crawl.yml) 执行，也可手动触发。仓库 Secrets 需要 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`（D1 Edit）；可选 `GITHUB_TOKEN`。采集只在 `main` 上运行。抓取来源、资源版权与可下载性仍需管理员逐条核验。

## 免费额度与运维

默认保持免费套餐。Workers 免费计划每日动态请求和 D1 的读写额度有限，前台查询已分页、字段有索引；应在 Cloudflare 控制台监控 Workers/D1 用量。接近额度时先优化查询和降低采集频率，不自动升级付费。公开内容只包含经管理员核验的资料和可访问链接。
