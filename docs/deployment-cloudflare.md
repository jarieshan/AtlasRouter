# Cloudflare Deployment

`atlas-router` 提供正式页面与订阅，私有 `atlas-router-development` 提供开发版订阅。自定义选项中的 Dev 开关切换独立测试数据；生产分流行为见 [生产基线](production-baseline.md)。

## 域名与香港 Tunnel

Worker 只保留 `atlasrouter.zslab.ai` 这个正式 Custom Domain，`previews_enabled=false`。`workers_dev` 和 `preview_urls` 均关闭，不配置 `previews`。

香港管理入口和上游订阅入口直接通过 Cloudflare Access 与 Tunnel 回源。它们不属于 AtlasRouter Worker 的路由，不能因清理预览而删除 DNS、Access 应用、Tunnel ingress 或覆盖它们的边缘证书。不要重新启用 `*.atlasrouter.zslab.ai` 的 Worker 预览通配路由。

## Cloudflare Builds

两个 Worker 分别在 Settings → Builds 配置对应分支。

| 设置 | 正式 Worker | 开发 Worker |
| --- | --- | --- |
| Worker | `atlas-router` | `atlas-router-development` |
| Repository | `jarieshan/AtlasRouter` | `jarieshan/AtlasRouter` |
| Production branch | `master` | `develop` |
| Root directory | `worker` | `worker` |
| Build command | `npm ci && npm test` | `npm ci && npm test` |
| Deploy command | `npm run deploy` | `npm run deploy:development` |
| Wrangler 配置 | `wrangler.jsonc` | `wrangler.development.jsonc` |
| Enable Preview Builds | 关闭 | 关闭 |

删除已有的非生产预览发布触发器，并确认没有排队或运行中的预览构建。仅删除预览实例不会阻止下一次 Git 推送重新创建预览；必须同时关闭 Builds 的预览发布。控制台开关见 [Cloudflare Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)。

GitHub Actions 在 `master`、`develop` 和 PR 上运行 `npm test`。该命令使用同一次检出的源码构建两个 Worker，并测试各自的规则引用、订阅输出和凭据隔离。发布由上表对应的 Cloudflare Builds 执行。本地 `npm run build` 和 `npm run build:development` 分别检查正式和开发配置，均使用 dry-run。

## 分支合并与发布

1. 功能分支从 develop 开始，完成后通过 PR 合入 develop。两分支都维护同一套实现、模板、测试和两份部署配置。
2. develop 的 Cloudflare 构建通过后发布私有开发 Worker。在页面开启 Dev，验证开发订阅的 Surge / Clash 输出及本次改动。
3. 该批功能验收通过后，创建 `develop → master` 的整体 PR。建议使用普通合并保留提交历史，环境差异由对应配置表达。
4. master 的 Cloudflare 构建发布正式 Worker。更新正式订阅，检查正常输出、401/404 和本次功能。如果 master 有独立的紧急修复，通过普通合并同步回 develop。

模板使用 `{{REPOSITORY_RULES_REF}}` 占位符，Worker 从部署变量生成正式的 `@master` 或开发的 `@develop` 规则地址。合并时直接带入两份配置。`SHOW_ALL_PROXY_GROUPS` 同样由各部署读取。

需要独立启用的实验功能可增加专用开关，并测试开启与关闭两条路径。现有 Dev 线上验收覆盖订阅服务，页面和管理 API 由正式 Worker 执行，这些部分的变更需结合本地或 CI 集成测试验证。

数据库迁移随代码参与发布。正式发布会先迁移两库，迁移需要兼容当前运行的页面和订阅代码。Worker 回滚后，数据库继续使用已迁移的结构。

## 数据与凭据

[wrangler.jsonc](../worker/wrangler.jsonc) 绑定正式 `DB`、独立 `DEV_DB` 和 `DEV_SUBSCRIPTION_SERVICE`。开发服务使用 [wrangler.development.jsonc](../worker/wrangler.development.jsonc)，只绑定测试库、不配置公开路由，`workers_dev` 和 `preview_urls` 均关闭。浏览器 API 通过 `/api/AtlasRouter-Dev/*` 选择测试库；`/AtlasRouter-Dev` 及其模块、规则请求通过 Service binding 调用开发服务。

Builds 使用的 Token 需要发布对应 Worker 和迁移其配置中 D1 数据库的权限。运行时的 Access 设置、管理员 Secret 和上游订阅服务令牌见 [环境与存储](env.md)。不要把 Token、个人订阅链接或节点凭据写进构建命令、普通变量或仓库。

`npm run deploy` 校验 Cloudflare Builds 的 master 上下文和两库隔离，先迁移两库，再发布正式页面并轮换 `ADMIN_API_SLUG`。`npm run deploy:development` 仅接受 develop 构建上下文，只迁移测试库并发布私有开发服务。两种发布脚本都会核对 Cloudflare Builds 注入的目标 Worker 名称，名称错配时在数据库迁移前终止。`--dry-run` 可在本地验证。部署顺序为开发服务、正式页面。开发服务需要单独配置 Builds，不能恢复正式 Worker 的通配预览。

## Access 与验证

根页面和全部 `/api/*`（包含开发管理 API）保持 Access 登录保护；只为 `/AtlasRouter`、`/AtlasRouter-Dev` 及各自的子路径设置订阅 Bypass，Worker 继续校验对应库的个人 Token。不为整个域名设置 Bypass。

发布前运行 `cd worker && npm test`。发布后验证正式订阅的 Surge / Clash 输出、错误 Token 返回 401、未知路径返回 404，以及香港两个 Tunnel 入口仍受 Access 保护且正常回源。

Dev 开关原地加载订阅和节点池，生成同域名 `/AtlasRouter-Dev` 链接。浏览器管理接口使用 `/api/AtlasRouter-Dev/*`，不能通过订阅 Bypass 绕过 Access。开发服务缺失时返回 503，绝不回退到正式库。验证两库凭据隔离、模块和规则的路径归属、切换失败时保持原环境，以及 Dev 重置凭据不影响正式订阅。旧 `dev=1` 订阅继续可用，并生成新路径的自动更新地址。
