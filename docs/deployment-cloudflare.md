# Cloudflare Deployment

`atlas-router` 提供正式页面与订阅，私有 `atlas-router-development` 提供开发版订阅。自定义选项中的 Dev 开关切换独立测试数据；生产分流行为见 [生产基线](production-baseline.md)。

## 域名与香港 Tunnel

Worker 只保留 `atlasrouter.zslab.ai` 这个正式 Custom Domain，`previews_enabled=false`。`workers_dev` 和 `preview_urls` 均关闭，不配置 `previews`。

香港管理入口和上游订阅入口直接通过 Cloudflare Access 与 Tunnel 回源。它们不属于 AtlasRouter Worker 的路由，不能因清理预览而删除 DNS、Access 应用、Tunnel ingress 或覆盖它们的边缘证书。不要重新启用 `*.atlasrouter.zslab.ai` 的 Worker 预览通配路由。

## Cloudflare Builds

在该 Worker 的 Settings → Builds 中保持以下配置：

| 设置 | 值 |
| --- | --- |
| Repository | `jarieshan/AtlasRouter` |
| Production branch | `master` |
| Root directory | `worker` |
| Build command | `npm ci && npm test` |
| Deploy command | `npm run deploy` |
| Enable Preview Builds | 关闭 |

删除已有的非生产预览发布触发器，并确认没有排队或运行中的预览构建。仅删除预览实例不会阻止下一次 Git 推送重新创建预览；必须同时关闭 Builds 的预览发布。控制台开关见 [Cloudflare Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)。

仓库已移除 `deploy:preview`、`deploy:branches`、`setup:builds` 入口及对应发布配置。GitHub Actions 保留 `master`、`develop` 和 PR 的测试，不含部署步骤。正常发布只由 Cloudflare 的 master 构建执行；本地 `npm run build` 是 dry-run。

## 数据与凭据

[wrangler.jsonc](../worker/wrangler.jsonc) 绑定正式 `DB`、独立 `DEV_DB` 和 `DEV_SUBSCRIPTION_SERVICE`。开发服务使用 [wrangler.development.jsonc](../worker/wrangler.development.jsonc)，只绑定测试库、不配置公开路由，`workers_dev` 和 `preview_urls` 均关闭。浏览器 API 通过 `/api/AtlasRouter-Dev/*` 选择测试库；`/AtlasRouter-Dev` 及其模块、规则请求通过 Service binding 调用开发服务。

Builds 使用的 Token 需要发布 Worker 和迁移正式 D1 的权限。运行时的 Access 设置、管理员 Secret 和上游订阅服务令牌见 [环境与存储](env.md)。不要把 Token、个人订阅链接或节点凭据写进构建命令、普通变量或仓库。

`npm run deploy` 校验 Cloudflare Builds 的 master 上下文和两库隔离，先迁移两库，再发布正式页面并轮换 `ADMIN_API_SLUG`。`npm run deploy:development` 仅接受 develop 构建上下文，只迁移测试库并发布私有开发服务；`--dry-run` 可在本地验证。部署顺序为开发服务、正式页面。开发服务需要单独配置 Builds，不能恢复正式 Worker 的通配预览。

## Access 与验证

根页面和全部 `/api/*`（包含开发管理 API）保持 Access 登录保护；只为 `/AtlasRouter`、`/AtlasRouter-Dev` 及各自的子路径设置订阅 Bypass，Worker 继续校验对应库的个人 Token。不为整个域名设置 Bypass。

发布前运行 `cd worker && npm test`。发布后验证正式订阅的 Surge / Clash 输出、错误 Token 返回 401、未知路径返回 404，以及香港两个 Tunnel 入口仍受 Access 保护且正常回源。

Dev 开关原地加载订阅和节点池，生成同域名 `/AtlasRouter-Dev` 链接。浏览器管理接口使用 `/api/AtlasRouter-Dev/*`，不能通过订阅 Bypass 绕过 Access。开发服务缺失时返回 503，绝不回退到正式库。验证两库凭据隔离、模块和规则的路径归属、切换失败时保持原环境，以及 Dev 重置凭据不影响正式订阅。旧 `dev=1` 订阅继续可用，并生成新路径的自动更新地址。
