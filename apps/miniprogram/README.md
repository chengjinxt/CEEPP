# CEEPP 小程序

这里预留微信小程序客户端。确定原生小程序、Taro 或 uni-app 方案后，在本目录添加独立的 `package.json`、源码和构建配置；小程序依赖不得加入 `apps/web` 或 `apps/worker`。

小程序复用：

- `@ceepp/shared/api` 中的公开试卷接口类型；
- `@ceepp/shared/exam` 中的地区、科目和分类规则；
- Worker 已有的 `GET /api/papers`、`GET /api/papers/:id` 和已发布资源地址。

小程序不直接连接 D1 或 KV，也不复用管理后台接口。网络请求层应适配 `wx.request`，不要假设浏览器 `fetch` 一定存在。
