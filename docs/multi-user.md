# 多用户与节点池

## 账号和订阅

Cloudflare Access 负责 Google OAuth 登录，Worker 校验 Access JWT 的签名、issuer、audience、有效期和邮箱。账号以验证后的邮箱去除首尾空白并转小写作为唯一标识；不合并 Gmail 的点号或 `+` 别名，不使用请求参数、普通邮箱 Header 或 JWT `sub` 识别账号。相同邮箱的新会话复用用户、订阅链接与分配状态；邮箱改变视为新账号。

首次访问用户 API 自动创建账号和 256 位随机订阅 token。用户在域名根路径 `/` 复制 `/AtlasRouter?token=<token>` 链接，也可重置链接；旧 token 立即失效。管理员停用用户时撤销其链接并释放分配，再启用时生成新凭据。用户 API 只返回本人的邮箱、链接、节点名称及顺序；管理员 API 不返回用户订阅 token。

页面“自定义选项”默认启用 DoH，可关闭 DoH、将 Client 从默认 Surge 切换为 Clash，或为 Surge 打开 Tencent OA Compatibility。非默认选项写入订阅 URL 的 `doh=0`、`client=clash`、`tencent_oa=1` 参数，两种格式共用同一 token 和分配结果。Clash 从完整 Surge 配置派生，省略不兼容内容；具体边界见 [订阅说明](subscription.md)。

普通用户和管理员使用同一个网页 URL `/`。管理员邮箱命中 `ADMIN_EMAILS` 时，页面额外包含节点池和用户管理区域；普通用户收到的 HTML 不包含这些区域及管理脚本。管理 API 使用 `ADMIN_API_SLUG` Secret 组成随机前缀，只注入已核验的管理员 HTML，且每次调用都独立校验权限；角色不能通过查询参数或前端修改获得。网页和所有个人、管理 API 共用一个 Access application。

Surge 不能进行交互式 Google 登录，因此订阅入口使用独立 token 鉴权。Access 应保护用户页、管理页及各自 API，而不能把订阅入口重定向到登录页。

## 页面预览（不持久化）

测试身份通过 Cloudflare Access 登录后，从普通首页自动进入页面预览。服务端只读查询 D1 中已启用节点的 ID、名称和分组，不读取节点连接凭据、其他用户或分配记录。页面按节点录入顺序展示每组的预览主备顺序，首个节点仅作为展示用的主节点，不代表真实归属；刷新页面会读取最新节点，节点池为空时显示空状态。

Client、DoH、Tencent OA、复制和重置链接在当前页面内存中模拟，不请求正式数据 API，不新增 Cookie，也不使用 localStorage、sessionStorage 或 IndexedDB。重新加载整个页面即重置这些操作，并重新读取节点。预览不会进入正式用户人数、节点归属、分配次数或其他持久化统计；`preview.invalid` 示例链接不能订阅实际节点。

在 `PREVIEW_EMAIL_HASHES` Secret 配置测试邮箱规范化后的 SHA-256 摘要。普通首页、个人资料和重置链接 API 都在访问 D1 前识别测试身份，并使用只读节点查询；测试身份不注册正式用户、不参与分配，也不能调用管理 API。已经签发的正式订阅 token 会被拒绝。服务端仅保存识别摘要，不写入测试账号、节点变更、操作或统计，页面不含真实测试邮箱。

`/?preview=1` 仍可供其他登录用户临时预览，使用固定虚拟节点且不访问 D1；只有已配置摘要的测试身份读取真实节点。非测试身份从普通根路径继续使用正式业务流程。将已有正式用户改为测试身份时，需要清理先前的用户、归属记录及可核实的测试分配计数，避免历史数据继续显示在管理统计中。

## 分配规则

1. 节点按“地区 + 出口 IP 类型”分组，每位启用用户在每个启用组获得一个主节点。
2. 优先选当前分配用户数最少的节点；相同时选历史分配次数最少的节点，再按首次录入顺序决定。空闲节点优先于已被分配的节点。
3. 同组节点数不足时允许重复分配。各节点的当前分配人数之差不超过 1。
4. 使用两层轮转：主节点固定在首位，其余节点从主节点之后按首次录入顺序环绕排列，再按用户在该主节点分配名单中的序号轮转。三个节点的首批三个用户得到 `1→2→3`、`2→3→1`、`3→1→2`；第二批得到 `1→3→2`、`2→1→3`、`3→2→1`。每个主备位置上各节点出现次数之差不超过 1。Surge / Clash 按首个可用节点回退时，同一个主节点失效后的新增接管人数之差不超过 1；两端的健康检查结果可能不同，因此不保证实际同时选择相同节点。
5. 保存清单、启停节点或用户时重新平衡。保留仍然均衡的归属，只移动过量分配的用户；同一节点上较晚分配的用户先移动。新增容量可减少主节点共享。编辑凭据、重排清单不会自行改变节点环顺序。用户增减或节点启停可能调整备用顺序；同一状态下重复生成或重启服务后，顺序保持一致。
6. 没有任何启用节点时仍生成用户链接，订阅返回 `503 Waiting for node allocation`。管理员启用节点后自动完成分配。

用户、节点和归属分别保存在 D1 的 `users`、`nodes`、`assignments` 表中，字段与约束见 [env.md](env.md)。`assignments` 的 `(user_id, group_name)` 主键保证每人每组最多一个主节点，外键保证该节点属于同组；共享主节点不受此限制。当前分配人数由关系表统计，历史次数单独保存在节点表。节点录入顺序和同一主节点的 `owner_order` 持久化保存，备用列表按两层轮转规则生成。

读取一致的关系数据后计算分配，只在 `store_versions` 版本仍匹配时，通过一个 [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)写入变化的记录。事务中的每条写入均检查本次提交标识；版本不匹配时不会修改任何业务记录，任一语句失败则整批回滚。遇到并发修改则重新读取、计算并重试，最多 12 次，持续冲突返回 503，不返回尚未提交的 token。库存另有独立版本号，过期的管理员编辑返回 409；新用户登录不会改变库存版本。普通账号和订阅请求通过邮箱/token 索引查找，不读取其他用户的凭据。读取使用 D1 主库，确保停用和 token 撤销不会受只读副本延迟影响。

以 Clash 的顺序 fallback 为例，30 个用户均匀使用同组三个节点，每个节点主分配 10 人。当一个节点失效且另外两个可用时，受影响的 10 人各有 5 人切换到另外两个节点，最终各承接 15 人。这个保证针对单节点故障下的新增接管人数；多个节点同时失效、各用户流量差异或各客户端可用性检测结果不同，仍可能造成实际负载不均。同组仅一个节点时没有备用节点。

“专属主节点”表示该用户配置中的首选节点。主备组会把同组其他节点的连接凭据一并下发，且容量不足时主节点可以共享，因此它不代表网络凭据独享。均衡针对配置位置和分配人数，不是实时流量。已经导入设备的旧配置需要完成订阅更新后才能获得新分配；撤销订阅 token 不会撤销已下载的节点凭据。

master 与 develop 的 Surge 都使用带权重的 Smart，Clash 转为个人主备次序的 `fallback`、间隔 300 秒。正式与开发服务均使用 `geometric-10-from-10000`，各组权重为 1、10000、100000…；Smart 与 fallback 的选择行为不等价。健康检测由客户端执行，全部失效时遵循各客户端行为；Worker 不主动探测代理，也不因短时故障改写永久归属。

## 节点命名与管理

Dev 开关在当前页面加载账户和节点池，用户启停与 Token 重置均作用于当前选中的独立数据库。开发 API 使用 `/api/AtlasRouter-Dev/*`，订阅使用 `/AtlasRouter-Dev`。两库不自动同步；“重置为生产节点”入口不恢复。切换环境保留 Client、DoH 与 Tencent OA 选择，加载失败保持原环境，有未保存编辑时先确认；订阅客户端需要更新为当前环境的链接。

管理员在根路径 `/` 网页的节点池区域按行粘贴 HTTPS 订阅链接、`vmess://` 链接或完整 Surge 节点，点击“转换并加入待保存清单”后核对，再点击“保存并分配”。订阅支持明文或 Base64 编码的 VMess 节点列表，也可读取 Surge 的 `[Proxy]` 节点；不会导入远程规则或策略组。旧页面、API 和手动订阅入口均已停用，统一使用当前根路径。示例使用保留域名和占位密码：

```text
🇺🇸 LosAngeles - ISP 1 = trojan, us.example.com, 443, password=REPLACE_ME
🇭🇰 HongKong - IDC 1 = trojan, hk.example.com, 443, password=REPLACE_ME
🇸🇬 Singapore - WARP 1 = trojan, sg.example.com, 443, password=REPLACE_ME
🇺🇸 LosAngeles - ISP 2 = https://subscription.example.com/node
```

每个节点名必须包含一个地区旗帜和唯一一种独立关键词 `IDC`、`ISP` 或 `WARP`，关键词不区分大小写；缺失或冲突时拒绝保存，避免误分类。美国显示 `USA`，其余使用旗帜对应的两位地区代码，分别生成 `🇺🇸USA-ISP`、`🇭🇰HK-IDC`、`🇸🇬SG-WARP`。

链接默认保留节点原名，也可用“节点名 = 链接”指定名称。原名缺少旗帜或类型关键词时，转换结果仍进入待保存清单，并提示补全名称；系统不会猜测 IP 类型。去重比较连接配置，忽略节点名称、参数顺序和参数两侧空格，同时对齐 VMess 的常见默认值。与已有或本批节点相同的配置会跳过，保留先前节点的 ID、启停状态和名称；地址相同但凭据或传输配置不同的节点不会合并。同名但配置不同的新节点会追加序号。导入不会自动保存、修改原有节点或重新分配用户。

VMess 转换支持 AEAD（`aid` 为 0 或省略）、普通 TCP / WebSocket、可选 TLS、SNI 和 ALPN。`auto` 加密映射为 `aes-128-gcm`；不支持的协议、传输方式或加密方式会拒绝导入。TLS 浏览器指纹 `fp` 没有对应的 Surge 参数，省略并提示；ALPN 需要 Surge iOS 5.20.0+ / Mac 6.7.0+，证书校验名称需要 iOS 5.21.0+ / Mac 6.8.0+，参见 [VMess](https://manual.nssurge.com/policies/vmess.html) 和 [TLS 参数](https://manual.nssurge.com/policies/tls.html)。

每批最多请求 20 个不同的 HTTPS 公网域名订阅地址，单个请求超时 10 秒、响应最多 512 KiB，不跟随重定向；重复链接仅请求一次。解析由管理员专用接口完成，不转发浏览器 Cookie 或 Access 凭据，不保存来源链接，不经过第三方转换服务。任一条解析失败时，原待保存清单和输入保留，修正后可重试。

管理员可以逐条展开节点配置，查看当前分配人数、所有已分配用户邮箱、累计主节点分配次数。累计次数包含初次分配及重新分配，不是连接次数或实际流量；从未分配的节点计数为 0。

每个节点行末的“删除”按钮经确认后立即删除该节点并重新分配，无需再次点击“保存并分配”。删除会同步移除完整清单中该节点的记录，其他尚未保存的编辑仍保留在清单中，不会一起提交。清单版本过期时删除返回冲突，需重新加载后核对。

在完整清单编辑区可修改配置和 `enabled`。编辑同一节点时保留 `id`；设为 `enabled: false` 可停用节点并保留历史。从 JSON 数组中删除整条节点记录，再点击“保存并分配”，会永久删除该节点、其累计分配历史和归属关系，即使节点已分配给用户也可移除。受影响用户自动分配到同组剩余启用节点，剩余节点保持原有相对顺序，再生成备份列表；用户订阅链接不变，客户端需更新订阅。删空某组后该组从订阅移除；整个节点池没有启用节点时，订阅返回 503 等待分配。更换地区/IP 类型会释放该节点旧组的归属，再分配到新组。

## 模板和版本范围

自动订阅沿用 `surge/template.conf` 的通用配置与规则区，用 `surge/pool-groups.conf` 替换策略组区。地区/IP 类型组按个人主备顺序回退；业务 `Proxy` 另提供放在所有地区组之后的 `Auto` 选项，手动选择它会使用全部节点。`RULE-SET`、`GEOIP` 和 `FINAL` 仍在主模板，零散规则仍在 `surge/rules.list`，仓库维护的规则集在 `surge/rule-sets/`。

`AIProxy`、`X` 的选项统一按 ISP → WARP → IDC → `Proxy` → `DIRECT` 排列，默认选择首个可用的 ISP 组。`GlobalMedia` 按 WARP → IDC → ISP → `Proxy` → `DIRECT` 排列，默认选择首个可用的 WARP 组。`Proxy` 自身按 ISP → WARP → IDC → `Auto` → `DIRECT` 排列，默认选择首个可用的 ISP 组。`ISP First` 只按 ISP → WARP → IDC 排列，不含 `Proxy` 和 `DIRECT`，默认选择首个可用的 ISP 组，接收 Facebook（含 Instagram、WhatsApp 等 Meta 服务）、Threads、Reddit 和 Line 规则的流量。`GeneralSite` 先按 ISP → WARP → IDC 列出香港组，再按同样的 IP 类型顺序列出其他地区组，不含 `Proxy` 和 `DIRECT`，默认选择首个可用的香港组，没有香港组时与 `ISP First` 相同，接收 Alphabet、GitHub 和 Wikimedia 规则的流量。地区/IP 类型选项先按 IP 类型排序，同一类型内按美国 → 香港 → 新加坡 → 日本 → 其他地区排列（`GeneralSite` 提前的香港组除外），其他地区按两位地区代码的字母升序排列。只列出当前可用组，缺少某类节点时跳过。所有可选策略组均不提供 `REJECT` 选项。这里的“可用组”指有启用节点并生成到订阅中的组，不代表客户端已测速通过；`select` 不会因当前地区组失效而自动切换到下一个地区组。

`WeChat` 按 `DIRECT` → IDC → WARP → ISP 排列，默认直连，并接收 WeChat 规则集的流量。`Telegram` 按 IDC → WARP → ISP → `Proxy` → `DIRECT` 排列，默认选择首个可用的 IDC 组。这两个策略组均可见。`OverseasFinance`（原 `Coin`）同样可见，按 ISP → WARP → IDC → `DIRECT` 排列，默认选择首个可用的 ISP 组，接收 Binance、OKX、Coinbase、Bybit、Bitget、PayPal、eBay、Stripe 和 Wise 规则的流量。Apple 只保留 `iCloud` 一个分组：可见，先列 `DIRECT`，然后按 IDC → WARP → ISP 列出可用组；其余 Apple 服务固定直连，不再设 AppleDirect 组。Apple TV+ 进入 `GlobalMedia`，Apple Intelligence 进入 `AIProxy`。模板规则行中的 `hidden=true` 由 Worker 转换为对应策略组的隐藏属性，规则继续参与分流。同一 IP 类型内均使用上述地区顺序。`💎 Select` 已移除。

`YouTube` 使用可见的独立策略组和品牌 Logo，选项按 WARP → IDC → ISP 排列，缺少某类节点时跳过，只列出当前可用的地区/IP 类型组。YouTube 规则在 Netflix 等影音规则之前匹配，使用 MagicRule 的原生 Surge / Mihomo 完整规则。GlobalMedia 策略组仅接收所选 6 项服务的独立清单，不再引用同名聚合列表；完整列表见[影音规则说明](subscription.md#影音音乐和直播规则)。

地区组定义按地区、IP 类型顺序输出。WARP、IDC 地区组设置 `hidden=true`，仅隐藏客户端主面板中的独立分组；ISP 地区组保持可见。开发服务启用 `SHOW_ALL_PROXY_GROUPS`，所有地区组均可见。保留其他策略中的地区组选项，账户网页和管理员页面继续展示节点分配。各组内部的主节点与备用顺序不受影响。Surge 的 [`select` 组](https://manual.nssurge.com/policy-groups/select.html)会保存已有选择，更新订阅不会强制重置已选策略。iCloud 的 DIRECT → IDC → WARP → ISP 是手动选项顺序，组内节点由 Surge Smart 或 Clash 的同顺序 fallback 选择。

`[Proxy]` 中的节点行也先按上述国家/地区顺序、再按 ISP → WARP → IDC 输出；同一地区、同一 IP 类型的节点保持原有相对顺序，不改变策略组的主备关系。

存储不再使用 JSON 快照，也不再有整份状态 1.9 MB 的限制。仍限制最多 1000 个库存节点、单次清单请求 512 KiB、单条节点配置 4096 个字符；SQL 写入会分批构造语句，以满足 [D1 每条语句最多 100 个绑定参数](https://developers.cloudflare.com/d1/platform/limits/)的限制，整次操作仍在同一个事务中。新增用户及库存调整仍需读取完整归属进行全局均衡，大规模部署需结合 D1 与 Worker 配额验证容量。

订阅不包含 MitM 配置，旧手动订阅及其证书生成功能已移除。
