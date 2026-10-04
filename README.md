# CEEPP 普通高考真题站

首期收录普通高考历年全科试卷。访客可按年份、命题范围、科目角色、适用地区、科目和名称查找已发布试卷，并打开 PDF、MP3、HTML 或网盘资源；采集结果只进入待审核队列，不会自动公开。前台与后台使用 Vue 3，API 运行在 Cloudflare Worker，结构化数据存于 D1，管理员有权上传的少量 PDF/MP3 暂存于私有 Workers KV。

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

本地 D1、KV 模拟存储与生产资源分离。`/admin` 及其子路径需要有效的 Cloudflare Access JWT；本地无令牌时会拒绝管理操作。可运行以下检查：

```sh
pnpm lint
pnpm test
pnpm build
```

每次修改后的测试、Git 提交、Workers Builds 自动发布与线上验收步骤见[日常修改与发布流程](docs/DEPLOYMENT.md#日常修改本地验证与自动发布)；其中后台登录问题必须从首页点击入口验证，不能只在地址栏直接打开 `/admin`。

公开 API 是 `GET /api/papers`（支持 `year`、`originType`、`scope`、`subjectRole`、`region`、`subject`、`q`、`page`）和 `GET /api/papers/:id`。仅返回已发布试卷，供网站及后续小程序复用。本站 PDF/MP3 通过 `GET /api/resources/:id/file` 在线查看或播放，追加 `?download=1` 下载；草稿文件只有管理员接口可访问。管理员在 `/admin` 及其子路径审核候选、补录资源、上传文件、发布或下架试卷。

## 首次上线（需 Cloudflare 和 GitHub 账号）

完整操作、验收与故障排查见 [发布与自动部署指南](docs/DEPLOYMENT.md)。当前 Cloudflare 账号已创建 `ceepp` D1 和私有 KV namespace `ceepp-paper-files`；上线前需核对其真实 ID 与 [`wrangler.jsonc`](wrangler.jsonc) 的绑定一致。R2 没有启用。Workers Builds 只部署 `main`：Build command 为 `pnpm lint && pnpm test && pnpm build`，Deploy command 为 `pnpm deploy`，非生产 Preview 关闭。当前 Builds token 保留 Workers Scripts Edit 与 D1 Edit 即可迁移 D1、绑定既有 KV namespace 并发布 Worker，不需要 Workers KV Storage Edit；只有需要通过 token 创建 namespace，或由 CI 直接执行 KV 运维时，才临时授予 Workers KV Storage Edit，完成后移除。

后台只在同一个 Cloudflare Access 应用中保护 `/admin` 和 `/admin/*`，公开站与 `/api/*` 保持匿名可访问。账号侧的 Access 设置、运行时变量和 GitHub Actions Secrets 均须按指南配置；不要把 API token 或 `.dev.vars` 提交到版本库。

## 采集与审核

`pnpm crawl --dry-run` 仅抓取和统计；`pnpm crawl` 将去重后的候选写入 D1，不发布试卷。采集器读取 `deekur/gaokaomath` 普通高考目录、`t.urongda.com/exams` 年份页，以及用户指定的 [JHCEE 2026 汇总页](https://www.jhcee.cn/pc/gk_information/consultation_detail-8ab0d407-8729-41a4-b5a9-8c5218881b03.html)。JHCEE 候选会分别记录试卷/答案/听力资源、命题范围、科目角色和多个适用地区；全国一卷、全国二卷的地区预设只用于该年份对应的统一高考科目，省级选考科目单独归入省级卷。模糊分类留待人工复核。

采集器只保存外部链接，不复制第三方 PDF 或音频，并区分“来源链接”和“网盘分享”；例如融大页面中的 ctfile 网盘会保留为网盘类型，审核后在详情页显示为“网盘分享”。管理员只能把已取得保存与公开权限的文件上传到本站：试卷、答案、解析和听力材料使用 PDF，“听力音频”使用 MP3。上传后先保持草稿，通过在线查看或播放核验，再手动发布。KV 试运行期单个文件最大 20 MiB；900 MiB 软限制只统计本站 D1 已登记文件与待清理对象。

每周采集由 [GitHub Actions](.github/workflows/crawl.yml) 执行，也可手动触发。仓库 Secrets 需要 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`（D1 Edit）；可选 `GITHUB_TOKEN`。采集只在 `main` 上运行。抓取来源、资源版权与可下载性仍需管理员逐条核验。

## 免费额度与运维

Workers、D1 与 Workers KV 保持免费套餐，R2 仍不启用。KV Free 的存储额度是同一账号下所有 namespace 合计 1 GB，同时单个 namespace 的存储上限也是 1 GB；单值最多 25 MiB。应用把单文件限制为 20 MiB，900 MiB 软限制只统计本站 D1 已登记文件与待清理对象，不包含账号内其他 KV 占用；如果同一账号还有其他 namespace 或 KV 数据，本站可能在软限制之前就因账号总额度不足而写入失败。KV 是最终一致存储，上传后从其他 Cloudflare 节点读取可能短暂延迟；KV 没有原生 Range 读取，Worker 会以流式方式跳过并输出所需字节，靠后的范围仍可能读取较多数据，所以该方案只用于少量、低访问 PDF/MP3 的首期闭环。D1 清理队列与每日 Cron 会重试失败的 KV 删除。应同时监控 Workers、D1、KV 用量，接近额度时先优化查询、降低采集频率或暂停上传，不自动升级套餐。公开内容只包含经管理员核验且有权公开的资料。[KV 限额](https://developers.cloudflare.com/kv/platform/limits/)、[KV 定价与免费额度](https://developers.cloudflare.com/kv/platform/pricing/)
