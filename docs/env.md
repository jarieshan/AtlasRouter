# Worker 环境与存储

正式页面通过 Service binding 调用私有开发订阅服务；配置入口是 [wrangler.jsonc](../worker/wrangler.jsonc) 与 [wrangler.development.jsonc](../worker/wrangler.development.jsonc)，发布步骤见 [部署说明](deployment-cloudflare.md)。

## 运行时配置

| 配置 | 正式环境 |
| --- | --- |
| `DB`（D1 binding） | `atlas-router` 正式库 |
| `UI_ENABLED`（变量） | `true` |
| `SUBSCRIPTION_PATH`（变量） | `/AtlasRouter` |
| `SMART_PRIORITY_SCHEME`（变量） | `geometric-10-from-100`：地区组权重 1、100、1000…，每组最多 15 个节点 |

正式页面绑定 `DEV_DB`（独立测试库）和 `DEV_SUBSCRIPTION_SERVICE`（私有开发 Worker）。开发管理请求使用 `/api/AtlasRouter-Dev/*`，读取测试库并生成 `/AtlasRouter-Dev` 链接；开发服务只绑定测试库，并设置 `SUBSCRIPTION_VARIANT=development`、`SUBSCRIPTION_PATH=/AtlasRouter-Dev`。服务或数据库缺失时拒绝请求，不回退到正式库。`DEV_SUBSCRIPTION_ORIGIN` 与原生 `previews` 不再使用。开发服务可设置 `SMART_PRIORITY_SCHEME=geometric-10-from-100`（与正式相同）、`SHOW_ALL_PROXY_GROUPS=true`；正式分流行为保持独立。旧环境参数仅供已发出链接兼容，新页面不再生成。

开发服务直接使用测试节点池保存的公网地址、端口和 TLS 设置，节点 443 不再经 Tailnet 转接。`SUBSCRIPTION_VARIANT=development` 仍用于隔离开发服务和数据，不再切换节点传输通道；节点名称、用户分配及出口保持原样。客户端的 Tailnet 策略继续提供 SSH 等私网管理访问。

Dev 运行时忽略遗留的 `TAILNET_ENDPOINTS` Secret，`deploy:development` 也不再要求、校验或上传该映射；缺少映射不会阻止发布或订阅生成。其他运行时 Secrets 继续继承。

生产网页和浏览器 API 还需要以下配置：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | 普通变量 | Access team origin，例如 `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | 普通变量 | 统一网页与 API 的 Access application Audience |
| `ADMIN_EMAILS` | Secret | 允许管理配置的邮箱，英文逗号分隔 |
| `ADMIN_API_SLUG` | Secret | 密码学随机生成的 32 位小写十六进制管理路径标识 |
| `PREVIEW_EMAIL_HASHES` | 可选 Secret | 测试邮箱规范化后的 SHA-256 摘要，英文逗号分隔 |

`PREVIEW_EMAIL_HASHES` 是只读的**页面演示身份**，与原生 Worker Preview 和 Dev 数据环境不同。匹配身份只查看启用节点的展示信息，模拟操作保留在页面内存，不注册正式用户、不获取有效订阅，也不写入分配记录。

同一个 Access application 保护生产 `/` 及 `/api/*`；订阅路径及其子路径使用精确 Bypass，再由 Worker 校验个人 token。Google OAuth client ID/secret 配置在 Access 身份提供商中。Worker 不处理 Google client secret；`ACCESS_JWKS_JSON` 仅供离线测试，生产不设置。旧 `ACCESS_USER_AUD`、KV binding 和组合构建的 `DEV_ADMIN_*` 不属于当前配置。

管理页面导入受 Cloudflare Access 保护的上游订阅时，可配置以下项目。上游 Access application 应只允许指定服务令牌的 **Service Auth** 策略；3x-ui 面板使用独立的管理员登录策略。两者通过 Tunnel 回源，源站端口不需要向公网开放。

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `NODE_IMPORT_ACCESS_ORIGIN` | 普通变量 | 唯一可信上游，例如 `https://subscription.example.com`，不能包含路径、查询、片段或用户信息 |
| `NODE_IMPORT_ACCESS_CLIENT_ID` | Secret | 上游 Access 服务令牌的 Client ID |
| `NODE_IMPORT_ACCESS_CLIENT_SECRET` | Secret | 同一服务令牌的 Client Secret |
| `NODE_IMPORT_ACCESS_UPSTREAMS` | 可选 Secret | 额外上游的 JSON 数组，每项包含 `origin`、`clientId`、`clientSecret`；各上游使用各自的服务凭据 |

使用原有单上游配置时，前三项必须同时配置。Worker 仅向 HTTPS origin（协议、域名、端口）完全匹配的导入地址发送服务凭据，拒绝跟随重定向；其他订阅地址保持普通导入。配置不完整时，链接导入返回 503，避免无认证访问上游。导入时使用新的 Tunnel HTTPS 域名，保留原订阅路径和订阅标识，省略源站 `:2096` 端口。

需要多个受保护上游时，可保留原三项并通过 `NODE_IMPORT_ACCESS_UPSTREAMS` 添加额外上游，也可只使用该数组。示例结构为 `[{"origin":"https://second.example.com","clientId":"REPLACE_WITH_CLIENT_ID","clientSecret":"REPLACE_WITH_CLIENT_SECRET"}]`。该值整体作为 Secret 保存。重复的 origin、无效地址或缺少凭据都会使链接导入返回 503；每个请求只携带其精确匹配上游的凭据。

服务凭据不下发到浏览器、Surge 或 Clash，也不写入节点清单。现有个人订阅仍由 AtlasRouter 从 D1 生成，不要求客户端使用 Access 服务令牌。这些配置保留在正式 Worker。服务令牌到期前需在 Access 中续期或轮换并同步 Secrets；源站与 Cloudflare 边缘的 HTTPS 证书独立续期。

Workers Preview 已关闭。管理和上游订阅域名直接通过 Access 与 Tunnel 回源，不需要额外的转发 Worker。配置方式见 [部署说明](deployment-cloudflare.md)。

入口域名必须由 Access 保护，cloudflared 必须再次验证对应应用的 Access JWT。面板回源 Host 使用公开面板域名；3x-ui 入站的分享地址应显式设置为实际 Xray 域名，订阅 URI 则使用公开订阅入口。仅修改回源 Host 仍可能被转发头覆盖，不能保证生成正确的节点地址。

节点凭据通过受保护管理页面录入 D1，不放在普通环境变量或代码中。D1 读取权限视为敏感数据读取权限。构建凭据由 Workers Builds 管理，其 token 需有 D1 Edit 权限以迁移正式库和测试库；GitHub Actions 只验证代码，不需要 Cloudflare Secrets。构建变量与 Worker 运行时变量分开配置，个人订阅 token 不放入构建变量。

MagicRule 定时检查（见 [订阅说明](subscription.md)）用可选 Secret `BARK_DEVICE_KEY` 推送提醒。值是 Bark App 中的设备 key，持有者可向该设备发送任意通知。只需在生产环境设置，私有开发订阅服务不运行定时任务：在 Cloudflare Dashboard 的 `atlas-router` → Settings → Variables and Secrets 中以 Secret 类型添加，或在 `worker/` 运行 `npx wrangler secret put BARK_DEVICE_KEY` 后按提示输入；不要写入仓库、构建变量或命令参数。生产发布只上传新的管理路径 Secret，其余 Secret 保持不变。Bark 返回错误时，日志只记录 HTTP 状态。未设置时检查照常进行，需要提醒时只在 Worker 日志中记录警告。

## 本地配置与发布命令

本地 `.dev.vars*`、`.env*`、`local-private/`、Wrangler 状态、依赖和生成资源由 [.gitignore](../.gitignore) 排除。可把仅含占位域名的 [env.example](../worker/env.example) 复制为 `worker/.env`，供只读线上检查使用；这不是云端部署前置步骤，不提交真实值。

- `npm test`：单元测试、构建和本地运行时测试。
- `npm run build`：当前源代码的 Wrangler dry-run，不发布。
- `npm run deploy`：只允许 Cloudflare Workers Builds 的 master 构建执行；先迁移正式库与独立测试库，再发布正式页面。
- `npm run deploy:development`：只允许 develop 构建执行；只迁移测试库并发布私有开发服务。加 `--dry-run` 可在本地校验。

Cloudflare 生产 Deploy command 使用 `npm run deploy`。预览与旧双分支发布入口已移除。发布只由 Cloudflare 监听 Git 推送触发；不从本机手工部署，也不通过 GitHub Actions 发布。

## D1 关系表

数据库结构见 [0002_relational.sql](../worker/migrations/0002_relational.sql)、[0003_magic_rule_sets.sql](../worker/migrations/0003_magic_rule_sets.sql) 和 [0004_magic_rule_checks.sql](../worker/migrations/0004_magic_rule_checks.sql)。运行时不保存 JSON 快照：

| 表 | 用途与主要字段 |
| --- | --- |
| `users` | 用户 ID、唯一规范化邮箱、唯一订阅 token、启用状态、创建时间、注册顺序 |
| `nodes` | 节点 ID、唯一名称、地区、IP 类型、组名、Surge 配置值、启用状态、历史分配次数、首次分配时间、录入顺序 |
| `assignments` | 用户 ID、组名、主节点 ID、同一主节点内的分配顺序；`(user_id, group_name)` 为主键 |
| `store_versions` | 节点池的写入版本、事务标识和管理员清单版本 |
| `magic_rule_sets` | MagicRule 规则名、客户端、内容 SHA-256、最后一次通过校验的公开规则内容和写入时间；`(name, client)` 为主键，不含用户数据 |
| `magic_rule_checks` | MagicRule 规则名、客户端、定时检查的连续失败次数、是否已推送失败提醒和更新时间；`(name, client)` 为主键，不含用户数据 |

外键保证归属引用有效用户及同组节点，唯一约束保证每人每组最多一个主节点；多个用户可引用同一节点。当前分配人数由 `assignments` 统计，历史次数保存在 `nodes.assignment_count`。固定录入顺序与 `owner_order` 共同决定主备顺序，不保存重复的备用节点列表。

多表更新使用 D1 `batch()` 事务和版本条件；冲突后重新读取和计算，只写入变化的用户、节点及归属记录。管理清单版本用于拒绝过期编辑。普通订阅按 token 索引查询，账号按邮箱索引查询。具体限制和分配策略见 [多用户与节点池](multi-user.md)。

## 管理路径与节点配置

管理员只需打开根路径。Worker 验证管理员邮箱后将随机管理路径注入 HTML；普通用户页面和个人 API 不包含该值。随机路径不能替代 Access JWT、邮箱白名单和同源写入检查。

master 构建在两库迁移成功后自动生成新的 `ADMIN_API_SLUG`，通过权限受限的临时 Secrets 文件与正式页面一同发布。开发服务不接收管理请求、不轮换该值；其他 Secrets、个人 token 和节点分配保持。

节点只从根路径管理区域录入，格式为 `节点名 = Surge 节点配置`。国家旗帜和 `IDC`、`ISP`、`WARP` 决定分组，完整约定见 [multi-user.md](multi-user.md)。保存时提交 `{ revision, nodes: [{ id, line, enabled }] }`，Worker 拆入节点和分配关系表。

旧手动订阅、手动配置页面与证书生成均已移除，订阅不包含 MitM 配置。已执行的历史迁移保持不变；迁移留下的 `manual_*` 表及手动配置版本行不会被当前 Worker 读写。本次下线功能不删除历史数据。
