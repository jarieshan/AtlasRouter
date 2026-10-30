# 原生 Worker Preview

同一个 `atlas-router` Worker 使用生产和原生 Preview 环境。生产页面生成链接；订阅客户端直接请求链接对应的环境，没有生产到开发的反向代理，也无需组合两个分支的订阅转换代码。

## 入口

以下为完成 Cloudflare 接入后的目标地址，不代表已经部署：

| 用途 | 地址（省略个人凭据） | 执行环境 |
| --- | --- | --- |
| 生产页面 | `https://atlasrouter.zslab.ai/` | 生产 |
| 页面中的 Dev 模式 | `https://atlasrouter.zslab.ai/?environment=development` | 生产 UI，管理测试数据 |
| 正式订阅 | `https://atlasrouter.zslab.ai/AtlasRouter` | 生产 |
| 测试订阅 | `https://develop.atlasrouter.zslab.ai/AtlasRouter-Dev` | 名为 `develop` 的原生 Preview |

Dev 按钮切换整个管理页面的数据环境，节点清单、个人订阅和重置凭据都使用测试 D1。生产与测试 Token 独立，不能仅把正式订阅替换为开发域名。生产页面通过 D1 binding 管理测试凭据和节点，不调用或转发开发订阅接口。页面会标明开发环境，切回生产需点击“返回生产”。切换页面会重新加载客户端等临时选项。

开发预览不提供 UI，保留订阅、模块和规则集接口；浏览器 API 若需直接使用，仍必须单独配置并通过 Access 鉴权。开发下载文件名为 `AtlasRouter-Dev.conf` / `AtlasRouter-Dev.yaml`，自动更新和受保护规则、模块地址都保留开发域名与开发路径。生产路径在开发环境返回 404，开发路径在生产环境返回 404。

## 配置与存储

[wrangler.jsonc](../worker/wrangler.jsonc) 的顶层是生产配置，`previews` 是原生预览配置：

| 配置 | 生产 | Preview |
| --- | --- | --- |
| `UI_ENABLED` | `true` | `false` |
| `SUBSCRIPTION_PATH` | `/AtlasRouter` | `/AtlasRouter-Dev` |
| `DB` | 正式 D1 | 测试 D1 |
| `DEV_DB` | 测试 D1，仅用于生产 UI 管理 | 无 |
| `DEV_SUBSCRIPTION_ORIGIN` | 开发预览的固定 HTTPS origin | 无 |
| `SMART_PRIORITY_SCHEME` | 保持现有生产配置 | `geometric-3` |

`DEV_SUBSCRIPTION_ORIGIN` 只能包含 HTTPS origin，不能带凭据、路径、查询或片段。开发配置缺失时，开发页面和 API 返回 503，不回退到生产库。生产 UI 的管理员身份继续由生产 Access 配置与 `ADMIN_EMAILS` 决定。独立 D1 隔离用户、Token、节点和分配；测试库的账号与节点表必须保持与生产管理页面兼容，订阅转换实现可以独立变化。修改测试库结构时需审查这一管理接口的兼容性。

生产订阅仍只读生产 `DB`；Preview 只绑定测试 `DB`，无需绑定生产库。不能把两个 binding 配成同一个 D1 ID。数据库迁移分别执行，不能只因代码预览独立即认为数据库已自动隔离。参见 [Cloudflare 资源隔离](https://developers.cloudflare.com/workers/previews/resources/)。

## Cloudflare 接入边界

本分支已包含代码、配置和 `npm run deploy:preview` 命令。该命令只允许 `develop` 发布，先校验 Worker 名称、独立 D1 和页面配置，迁移开发库后调用 `wrangler preview --name develop --ignore-base-config`。其他分支跳过发布，迁移失败不上传。`--ignore-base-config` 保证采用仓库中的 Preview 配置；不需要手动填写 Preview Base 的数据库或变量。`npm run deploy:preview -- --dry-run` 仅校验配置，不调用远程 API。Cloudflare 的连接步骤见 [部署说明](deployment-cloudflare.md)。

本次未主动部署 Worker、修改 Cloudflare 配置或更新 `master`。现有 `master` 仍需与生产源码基线核对后才能启用生产自动发布。

- 域名选择“生产和预览”后，生产使用原域名，预览使用 `<preview-name>.<原域名>`。这里固定预览名 `develop`。域名、DNS 和覆盖开发子域名的证书必须实际就绪，参见 [预览域名](https://developers.cloudflare.com/workers/previews/custom-domains/)。
- 生产 UI 与 `/api` 保持 Access 登录保护。订阅客户端需要直接访问正式 `/AtlasRouter` 和开发 `/AtlasRouter-Dev` 及其子路径；如果这些地址由 Access 保护，要为对应订阅路径设置精确的 Bypass，之后仍由应用校验个人 Token。不要为整个生产域名或管理 API 设置 Bypass。
- Preview 不继承生产变量和 Secrets；订阅不依赖 Access 登录，但若启用 Preview 的浏览器 API，需要明确配置它自己的 Access 参数。日志查询字符串应继续脱敏。
- Workers Builds 的目标是 `master` 推送执行生产流程，`develop` 推送执行原生 Preview 流程。官方的原生预览命令是 `npx wrangler preview`，会按分支更新固定预览环境；`wrangler versions upload` 是另一种机制。参见 [Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)。
- `npm run deploy`、`build:branches`、`deploy:branches`、`setup:builds` 仍服务于旧组合构建，不应用于原生 Preview。Cloudflare Preview command 使用新增的 `npm run deploy:preview`，生产 Deploy command 保持 dry-run，继续暂停生产发布。

本地验证使用 `cd worker && npm test`。测试覆盖生产页面生成开发链接、两库读写隔离、Token 隔离与轮换、开发页面关闭、路径校验，以及 Surge / Clash 自动更新、规则集和模块地址。
