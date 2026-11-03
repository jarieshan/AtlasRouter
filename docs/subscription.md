# Subscription

AtlasRouter 仅提供当前多用户节点池订阅，不再兼容旧手动配置或旧 URL。

原生 Preview 使用独立开发域名和 `/AtlasRouter-Dev`，生产仍使用 `/AtlasRouter`。生产页面的 Dev 按钮进入 `/?environment=development`，浏览器 API 保留该参数，从测试库获取独立凭据与节点；生成的链接直接指向开发环境。这个参数只选择 UI 管理的数据，不选择订阅执行代码。开发预览设置 `UI_ENABLED=false` 后根页面返回 404；自动更新、模块、规则集地址均保留开发域名和 `/AtlasRouter-Dev`。下载文件分别命名为 `AtlasRouter.conf` / `AtlasRouter-Dev.conf`，Clash 使用 `.yaml`。原生 Preview 的线上接入状态见 [native-previews.md](native-previews.md)。

## 当前入口

| 路径 | 方法 | 鉴权 / 用途 |
| --- | --- | --- |
| `/` | GET | Access JWT；统一网页，管理员额外看到节点池管理 |
| `/?preview=1` | GET | Access JWT；个人页面预览，模拟操作只保留在当前页面内存 |
| `/api/account/profile` | GET | Access JWT；按邮箱注册或返回本人订阅与节点顺序 |
| `/api/account/token` | POST | Access JWT + 同源 JSON；重置本人的订阅 token |
| `/api/<slug>/pool/state` | GET | 管理员；节点清单、归属、当前人数与累计分配次数 |
| `/api/<slug>/pool/nodes` | PUT | 管理员 + 同源 JSON；保存 `{ revision, nodes: [{ id, line, enabled }] }` |
| `/api/<slug>/pool/import` | POST | 管理员 + 同源 JSON；解析 `{ text, nodes }`，返回去重后的待保存清单与提示，不写入数据库 |
| `/api/<slug>/pool/users` | PATCH | 管理员 + 同源 JSON；启停 `{ id, enabled }` |
| `/AtlasRouter?token=<token>` | GET | 用户专属 token；输出完整 Surge 配置 |
| `/AtlasRouter?token=<token>&client=clash` | GET | 同一 token；输出从 Surge 配置转换的 Clash / Mihomo YAML |
| `/AtlasRouter/modules/<name>.sgmodule?token=<token>` | GET | 用户专属 token；输出模块 |
| `/AtlasRouter/rules/magicrule/surge/<name>.list?token=<token>` | GET | 用户专属 token；输出 MagicRule 原生 Surge 完整规则 |
| `/AtlasRouter/rules/magicrule/mihomo/<name>.yaml?token=<token>` | GET | 用户专属 token；输出 MagicRule 原生 Mihomo classical YAML |
| `/AtlasRouter/rules/rule-<hash>.txt?token=<token>` | GET | 用户专属 token；输出已过滤不兼容规则的 Clash 规则集 |

`<slug>` 来自 Worker Secret `ADMIN_API_SLUG`，为 128 位随机值的 32 位小写十六进制表示。管理路径只在管理员验证后的页面中注入，不包含在普通用户页面中。每次 master 构建发布会轮换该 Secret，已打开的管理页面需刷新；原生 Preview 发布不轮换生产标识，配置方式见 [env.md](env.md)。即使知道路径，也必须通过 Access JWT 和 `ADMIN_EMAILS` 校验。

网页和所有 API 使用同一个 Access application 的 `ACCESS_AUD`，同一会话根据邮箱拥有不同权限。浏览器写入请求要求 `Origin` 与目标源一致，并使用 `Content-Type: application/json`。不能通过 URL 角色、邮箱、用户 ID、伪造身份 Header 或 `Authorization` 切换用户或提权。

## 自定义订阅

网页提供“启用 DoH”和“Client：Surge（默认）/ Clash”两个订阅选项。选项即时更新待复制的 URL，不修改账号、token 或节点分配；修改后将新链接复制到客户端。刷新分配或重置 token 时保留当前页面上的选项。Tencent OA Compatibility 以 Surge 模块提供，不再修改订阅链接，见下文。

| 参数 | 默认值 | 可选值 |
| --- | --- | --- |
| `client` | `surge` | `surge`、`clash`；Clash 以 Mihomo（Clash Meta）为兼容目标 |
| `doh` | `0` | `0`、`1`；`1` 启用 DoH |
| `tencent_oa` | `0` | `0`、`1`；仅为兼容旧链接保留，页面不再生成；`1` 追加与 Tencent OA 模块相同的系统代理例外 |

例如 `/AtlasRouter?token=<token>&client=clash&doh=1` 同时启用 Clash 输出和 DoH。这些参数重复、为空或使用其他值时返回 400；无效 token 仍先返回 401。默认选项省略于页面生成的 URL，现有订阅无需调整。

默认 DoH 上游使用 [Cloudflare](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/) 的 `https://cloudflare-dns.com/dns-query` 和 [Google](https://developers.google.com/speed/public-dns/docs/secure-transports) 的 `https://dns.google/dns-query`，地址维护在 `surge/template.conf`。`doh=1` 同时激活 `encrypted-dns-server` 和 `encrypted-dns-follow-outbound-mode = true`；托管更新地址保留该选项。DoH 仅按上游域名分流：`surge/rules.list` 前部将 `dns.alidns.com`、`doh.pub` 精确匹配到 `DIRECT`，将 `cloudflare-dns.com`、`dns.google` 精确匹配到 IDC 专用组 `DoH Proxy`。Surge 和 Clash 使用相同的域名规则，均先于外部规则集；未列出的上游域名继续匹配其他分流规则。证书校验保持开启，参见 [Surge 加密 DNS](https://manual.nssurge.com/dns/encrypted-dns.html)。

`[Host]` 通过 `RULE-SET:https://magicrule.pages.dev/data/_shared/artifacts/China_rules_25adbc0394103807.list` 引用国内直连名单（见“订阅内容”），为名单中的域名分配 DNS：`doh=0` 使用 `223.5.5.5, 119.29.29.29`，`doh=1` 使用 `https://dns.alidns.com/dns-query, https://doh.pub/dns-query`。名单中的 IP 规则不参与 DNS 映射。开关由订阅生成器渲染为具体的 `server:` 值；这两个国内 DoH 上游经 `DIRECT` 出站。该映射位于 `zslab.ai` 和国内 DoH 上游的专用映射之后，专用映射优先；名单外域名沿用默认 DNS。

`[Host]` 固定为 `zslab.ai` 和 `*.zslab.ai` 指定 `server:223.5.5.5, 119.29.29.29`，覆盖根域名及所有层级子域名，不受 DoH 开关影响；这是 DNS 服务器分配，不是把域名绑定到这两个 IP。按 [Surge Host 语法](https://manual.nssurge.com/dns/local-dns-mapping.html)，多 DNS 服务器需要 Surge Mac 6.8.0+ / iOS 5.21.0+。节点使用域名时，需要普通 DNS 映射或 IP 地址完成引导解析，避免“连接代理前先通过该代理解析节点”的循环；`zslab.ai` 下的节点由上述映射覆盖，其他节点域名需另配映射。相关行为见 [Surge Mac 版本说明](https://kb.nssurge.com/surge-knowledge-base/release-notes/surge-mac-legacy#version-5.6.0)。

`[Host]` 还固定包含以下两条映射，为国内 DoH 上游自身的域名使用普通 DNS 引导解析；两条均放在国内直连名单映射之前，不受 DoH 开关影响：

```ini
dns.alidns.com = server:223.5.5.5, 119.29.29.29
doh.pub = server:223.5.5.5, 119.29.29.29
```

Clash 将默认和 Host 指定的 DoH 地址追加 `#RULES`，使用相同的上游域名规则：Cloudflare、Google 走 `DoH Proxy`，阿里、腾讯走 `DIRECT`；节点域名使用普通 `proxy-server-nameserver`。`[Host]` 的 DNS 映射转换为 `nameserver-policy`，包括上述两个上游域名的普通 DNS 映射；国内直连名单复用 `[Rule]` 中对应的规则提供器，生成 `rule-set:<提供器名>` 项，下载地址继续携带同一订阅 token。普通 DNS 仍用于关闭 DoH 时的解析、上游域名引导解析和连通性测试，这不表示明文查询被完全禁用。

DNS 劫持固定为以下两个目标，不随 DoH 开关或 Tencent OA 模块变化；DoH 开关只控制加密 DNS 上游：

```ini
hijack-dns = 8.8.8.8:53, 8.8.4.4:53
```

该字段只处理经过 Surge 虚拟网卡、发往上述地址的 53 端口 DNS 查询，不拦截其他 DNS 地址或应用自行发起的 DoH/DoT；仅使用系统代理、关闭增强模式时，不会因此接管系统 DNS。参见 [Surge DNS 劫持说明](https://manual.nssurge.com/dns/advanced.html#hijack-dns)。Clash 输出沿用转换规则，生成 `tun.dns-hijack: [8.8.8.8:53, 8.8.4.4:53]`，是否启用 TUN 由客户端决定。

### 腾讯公司内网兼容

适用于腾讯公司内网或公司 VPN 环境下，仅开启 Surge Mac 的“设置为系统代理”、关闭增强模式的用法。兼容配置以 Surge 模块 `tencent-oa.sgmodule` 提供：在页面“Tencent OA Compatibility”处点击“安装到 Surge”（调用 `surge:///install-module`），或复制模块链接后在 Surge 的模块列表中通过 URL 安装；之后在 Surge 中启用或停用模块即可切换，不需要更换订阅链接，启用状态也不会同步到其他设备。模块地址为 `/AtlasRouter/modules/tencent-oa.sgmodule?token=<token>`，与订阅使用同一 token，重置 token 后需重新安装；生成配置开头的“Available modules”注释同样列出该地址。模块声明 `#!system=mac`，Surge iOS 不加载。参见 [Surge 模块](https://manual.nssurge.com/profile/module.html)。

旧链接中的 `tencent_oa=1` 仍被接受：生成配置时把模块中的同一份例外追加到 `skip-proxy` 并去重，托管更新地址也继续保留该参数，但页面不再生成它。改用模块时从页面重新复制订阅链接，避免模块停用后旧参数仍让例外生效。手动请求 `client=clash&tencent_oa=1` 仍返回 400，避免静默忽略系统代理例外。

名单维护在 `modules/tencent-oa.sgmodule` 的 `skip-proxy = %APPEND% …` 一行，由 Worker 打包提供，不依赖外部规则站点。默认 `skip-proxy` 保留建行、农行、邮储和上海银行的 4 项域名例外，已移除 `localhost` 和 `*.local`。模块再追加 12 项 IP 地址或网段及 16 项域名匹配，共 32 项。`oa.com` 和 `woa.com` 各自保留根域名与 `*.` 子域名两项，其余 12 个域名使用 `*域名`，例如 `*tencentyun.com`、`*workbuddy.cn`；这种形式也会匹配其他以该字符串结尾的域名。`*qcloud.com` 已覆盖 `myqcloud.com` 及其子域名，因此不另列 `*myqcloud.com`。IP 清单将 `10.0.0.0/8` 与 `11.0.0.0/8` 等价合并为 `10.0.0.0/7`，将 `28.0.0.0/8` 与 `29.0.0.0/8` 等价合并为 `28.0.0.0/7`，其余条目保持原样，IP 整体覆盖范围不变。这些域名包含公网服务，并非全部为内网域名。现有 `exclude-simple-hostnames = true` 仍保留，不含点的简单主机名继续适用该设置。

模块和旧参数都只追加 `skip-proxy`，保留上述两个目标的 DNS 劫持配置，不追加 `[Host]`、域名或 IP 直连规则；DoH 是否开启仍由独立开关决定，原有 DNS 上游、SYSTEM、LAN、业务规则和最终兜底保持不变。腾讯专用的规则集和 Host 订阅入口已移除，请求返回 404。原 `skip-proxy-lists.sgmodule` 与默认 `skip-proxy` 内容完全相同，已删除。启用模块或旧参数都不会改变 D1 中的用户、节点和分配关系。

遵守系统代理例外的应用，访问匹配目标时由系统直接连接；内网 DNS 和路由需由 macOS 或公司 VPN 提供。模块不会修改 Mac 的系统 DNS，Surge 的 DNS/DoH 设置也不会自动用于这些绕过请求。IP 网段例外只匹配直接以 IP 为目标的请求，不会主动解析域名再匹配网段；开启增强模式后，绕过系统代理的连接仍可能被虚拟网卡接管。参见 [Surge 的 skip-proxy 说明](https://manual.nssurge.com/profile/general.html#skip-proxy)。

## 返回值与兼容边界

订阅缺少或使用无效 token 返回 401；未通过 Access 或管理员校验返回 403；未知路径返回 404；方法不支持返回 405；旧清单版本写入返回 409。暂无启用节点、存储未配置或持续写入冲突时返回 503。`ADMIN_API_SLUG` 未配置或格式错误时，管理员根页面返回 503，管理 API 不开放；个人 API 和订阅独立工作，重新运行 `npm run deploy` 可补齐管理标识。

Clash 转换后没有可用节点或有效兜底策略时返回 422；远程规则下载失败、超时、过大或返回网页时返回 502，不暴露上游内容。

以下旧入口到达 Worker 后一律返回 404，不跳转、不接受旧凭据，也不再提供写入兼容：

- `/admin`、`/admin/*`、`/api/admin/*`。
- `/atlasrouter`、`/atlasrouter/*`、`/atlas-router`。
- `/AtlasRouter/subscription`、`/AtlasRouter/subscription/*`、`/AtlasRouter/account`、`/AtlasRouter/account/*`、`/AtlasRouter/admin`、`/AtlasRouter/admin/*`。
- `/modules/*`、`/atlas`、`/atlas/*`。

Access 边缘可能先要求这些路径登录；通过 Access 不会恢复旧功能。订阅入口由小写 `/atlasrouter` 改为 `/AtlasRouter`，个人 token、节点和分配保持不变；已有客户端需从根页面重新复制订阅链接，或只替换 URL 的路径并保留原 token。

## 订阅内容

生成内容中的 `#!MANAGED-CONFIG` 和模块 URL 使用当前环境的域名及路径：生产 `/AtlasRouter`、预览 `/AtlasRouter-Dev`。它们只接受订阅 `token`，不能用浏览器登录身份代替。修改模板不会改变个人 token；用户重置后，旧 token 同时失去订阅和模块访问权。

master 按地区/IP 类型生成顺序 `fallback` 组，成员依照每位用户的主节点、备用节点排列，间隔为 300 秒，不生成 `policy-priority`。develop 独立试验 Smart 权重，生产源码不读取 `SMART_PRIORITY_SCHEME`，遗留变量不会启用实验。节点不足时允许共享主节点；规则见 [multi-user.md](multi-user.md)。`surge/template.conf` 提供通用设置和规则区，`surge/pool-groups.conf` 提供动态策略组，`surge/rules.list` 放零散规则；最终保留 `FINAL,Proxy,dns-failed`。MitM 默认关闭。

可见的 `Auto` 使用 `smart, include-all-proxies=true`，包含当前订阅 `[Proxy]` 中的所有节点，不包含 `DIRECT` 或其他策略组；在 `Proxy` 中排在所有地区/IP 类型组之后、`DIRECT` 之前。`Proxy` 默认选择排在首项的地区/IP 类型组，已有且仍有效的客户端手动选择可能被保留；从旧名称 `auto` 更新后，如需继续自动选择，可重新选中 `Auto`。Surge [smart 组](https://manual.nssurge.com/policy-groups/smart.html)结合测速延迟、真实连接响应和丢包择优，并自动重试；它不是始终固定选择单次测速最低的节点。Clash 无等价 smart 类型，转换为每 300 秒测速、容差为 0 的 `url-test`，输出注释说明差异。地区/IP 类型组的主备顺序保持原样。

develop 的 `DoH Proxy` 组仅列出当前订阅中已启用的 IDC 节点，跨地区汇集，不包含 ISP、WARP、`DIRECT`、`REJECT` 或其他策略组。Surge 使用不带权重的 `smart`，Clash 使用 `url-test`（间隔 300 秒、容差 0）。没有 IDC 节点时不输出空组，将原本指向该组的国外 DoH 规则改为 `REJECT`，国内 DNS 和其余订阅照常生成，避免 [Surge 空组自动替换为直连](https://manual.nssurge.com/policy-groups/overview.html)。Clash 过滤掉全部不兼容 IDC 节点时同样保留这些拒绝规则；只过滤部分节点时继续使用剩余 IDC。

香港银行与政府使用 `surge/rules.list` 中的固定 `DIRECT` 规则，位于 SYSTEM / LAN 之后、所有外部规则集之前；Surge 和 Clash 均生效。不创建可选策略组，因此客户端策略面板没有对应项目。当前范围如下，域名后缀包含根域名及其子域名：

| 服务 | 直连范围 |
| --- | --- |
| [汇丰香港](https://www.hsbc.com.hk/) / [HSBCnet](https://www.hsbcnet.com/) | `hsbc.com.hk`、`hsbc.com`、`hsbcnet.com` |
| [渣打香港](https://www.sc.com/hk/) | `sc.com`、`standardchartered.com`、`standardchartered.com.hk` |
| [中银香港](https://www.bochk.com/) | `bochk.com` |
| [工银亚洲](https://www.icbcasia.com/) | `icbcasia.com`；精确匹配网银域名 `myebankasia.icbc.com.cn`、`corpebankasia.icbc.com.cn` |
| [众安银行](https://bank.za.group/) | `za.group`，包含银行及其共用服务域名 |
| [恒生银行](https://www.hangseng.com/) | `hangseng.com` |
| [香港政府](https://www.gov.hk/) | `gov.hk` |

`hsbc.com`、`hsbcnet.com`、`sc.com`、`standardchartered.com` 等为银行共用域名，其下的其他地区服务也会直连。这里控制的是规则模式下的分流，不修改 `skip-proxy`，也不启用 MitM。

master 的地区/IP 类型组设置 `hidden=true`，隐藏客户端主面板中的独立分组，仍可作为其他策略组的选项。develop 的 Preview 配置启用 `SHOW_ALL_PROXY_GROUPS=true`，统一省略所有策略组的隐藏属性，覆盖组定义和规则上的 `hidden` 设置，包括地区组、AppleDirect、DoH Proxy 及以后新增的组；Surge 与 Clash 输出保持一致，更新 Dev 订阅后生效。账户网页和管理员节点清单继续展示分配信息。Apple 的两个分组按 `iCloud` → `AppleDirect` 定义，生产环境中 iCloud 可见、AppleDirect 隐藏，Dev 全部可见。iCloud 首项为 `DIRECT`，其余选项先按 IDC → WARP → ISP，再按地区顺序排列；AppleDirect 仅保留 `DIRECT` 一个选项，固定直连。这里的顺序是手动选择项顺序，不是 DIRECT 失败后的自动切换顺序；客户端已有且仍有效的手动选择可能被保留。

模板支持在 `[Rule]` 的 `RULE-SET` / `DOMAIN-SET` 行上追加 `hidden=true` 或 `hidden=false`，作为 AtlasRouter 对所引用策略组的显示设置。生成时会移除规则行的该参数，将其应用到对应 `[Proxy Group]` 定义，再转换为 Clash 的 `hidden` 属性；规则、策略引用和匹配顺序保持有效。`hidden=false` 会移除组上的隐藏参数，使用默认可见行为。Dev 的统一显示开关优先于这些逐组设置，只改变策略组显示，不改变节点配置、成员、权重和分流规则。此写法不是 Surge 原生规则参数；原生 `hidden` 属于[策略组参数](https://manual.nssurge.com/policy-groups/parameters.html#hidden)。同一组被多条规则引用时，未标记的规则不覆盖显式设置，多个显式设置必须一致；不能用于 `DIRECT`、`REJECT` 或不存在的组。

`WeChat`、`Telegram` 和 `X` 是可见的独立策略组，分别接收 WeChat、Telegram 和 Twitter 规则集的流量。WeChat 按 `DIRECT` → IDC → WARP → ISP 排列，默认直连。Telegram 按 IDC → WARP → ISP → `Proxy` → `DIRECT` 排列，默认选择首个可用的 IDC 组，缺少某类节点时跳过。X、AIProxy、GlobalMedia 按 ISP → WARP → IDC → `Proxy` → `DIRECT` 排列，默认选择首个可用的 ISP 组。上述地区/IP 类型选项先按 IP 类型、再按美国 → 香港 → 新加坡 → 日本 → 其他地区排序；其他地区按两位地区代码的字母升序排列。`Proxy` 自身不包含自引用，选项采用 ISP → WARP → IDC → `Auto` → `DIRECT` 顺序。所有可选策略组均不提供 `REJECT` 选项。`💎 Select` 已移除。

`YouTube` 是可见的独立策略组，选项按 WARP → IDC → ISP 排列，仅列出可用的地区/IP 类型组，默认选择首个 WARP 组；没有 WARP 时依次选择首个 IDC 或 ISP 组。它使用 MagicRule 的原生 Surge / Mihomo YouTube 完整规则，放在 GlobalMedia 之前。这是手动选择项顺序；地区/IP 类型组内，Surge / Clash 使用同顺序的 `fallback`。

业务策略组使用纯文字名称，图标来自 [Koolson/Qure Color](https://github.com/Koolson/Qure/tree/master/IconSet/Color)，通过 jsDelivr 公共链接加载。WeChat、Telegram、X、YouTube、Apple、iCloud 使用对应服务 Logo；Auto 使用 `Auto.png` 自动选择图标；DoH Proxy 使用 `Server.png` 服务器图标；Proxy、AIProxy、GlobalMedia 分别使用通用代理、AI、影音图标。首次从带 emoji 的旧组名更新后，客户端已保存的手动选择可能需要重新设置。Surge 使用 [`icon-url`](https://manual.nssurge.com/policy-groups/parameters.html)（Mac 6.5.0+），转换为 Clash 时映射为 [`icon`](https://wiki.metacubex.one/en/config/proxy-groups/#icon)，显示效果取决于客户端面板支持。策略组可见性遵循上述环境设置：Dev 统一显示全部组，生产按模板设置。

WeChat 使用指定的 [blackmatrix7 WeChat 规则（jsDelivr）](https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Surge/WeChat/WeChat.list)：Surge 直接引用这个公共链接，不附加个人 token；Clash 通过受 token 保护的 Worker 入口转换为 classical 文本规则，跳过不支持的 `USER-AGENT` 条目。客户端更新间隔为 24 小时。

其他外部规则使用 [MagicRule](https://magicrule.pages.dev/)；上游 [迁移公告](https://github.com/blackmatrix7/ios_rule_script/issues/1747) 说明旧仓库在 2026 年底停止自动更新。`surge/magicrule.json` 保存 Surge / Mihomo 清单标识，模板中的 `{{RULESET_<name>}}` 渲染为带个人 token 的固定 Worker 地址。每次下载读取对应 `manifest.json`，选择 `role=full` 的当前产物，避免固定引用带哈希的产物文件；不依赖额外客户端脚本或模块。清单与产物的上游缓存均为一小时，客户端规则更新间隔为 24 小时。上游清单路径本身如有调整，仍需更新映射并重新部署。国内直连名单是例外，见下文。

国内直连名单使用 MagicRule `China` 列表的固定产物 `https://magicrule.pages.dev/data/_shared/artifacts/China_rules_25adbc0394103807.list`（2026-10-30 版本，约 6,300 条域名后缀和 3,900 条 IP 段，含整段 `.cn`），在 `[Rule]` 中位于 LAN 解析规则和 `GEOIP,CN` 之前直连，并通过 `[Host]` 的 `RULE-SET:` 为其中的域名指定国内 DNS。Surge 直接从 MagicRule 下载，不经 Worker、不携带 token；Clash 通过受 token 保护的 Worker 入口转换为 classical 文本规则，跳过 30 条 `USER-AGENT`。这里固定引用带哈希的产物，因为 `[Host]` 的键在第一个 `=` 处切分，不能使用带 `token=` 的 Worker 地址，两处又需引用同一地址；上游更新后该文件不会随之变化，需要从 China 清单（Surge `11af2559235209b8783239b3`）取 `role=full` 的当前产物，同时替换模板中的两处地址。名单含 `DOMAIN-SUFFIX,ms`，所有 `.ms` 域名（如 `aka.ms`）直连。

不引用 MagicRule 的 Google 规则集：其当前 Surge / Mihomo 产物含 `hk`、`tw`、`sg`、`co` 等 28 个国家/地区顶级域的整段 `DOMAIN-SUFFIX`，会先于国内直连名单和 `GEOIP,CN` 把这些顶级域下的全部域名送往 `Proxy`。Google 自有域名改由后续的国内直连名单、`GEOIP,CN` 和 `FINAL,Proxy,dns-failed` 判断，通常仍经代理访问，首次访问会多一次本地 DNS 查询；YouTube、Gemini 等仍由各自规则集处理。

Apple 规则按 AppleTV → AppleIntelligence → iCloud → AppleDirect → Apple 完整规则的顺序匹配，均位于通用 Direct 之前。MagicRule 的 AppleTV 列表（`tv.apple.com` 及 Apple TV+ 的播放接口）进入 `GlobalMedia`，AppleIntelligence 列表（私密云计算中继及 `siri.apple.com`）进入 `AIProxy`；两者必须先于覆盖整个 `apple.com` 的直连列表。其余 Apple 服务由 iCloud（可手动切换，默认直连）、AppleDirect 和 Apple 完整规则直连，包括 App Store、软件更新和 Apple Music。MagicRule 的 AppleProxy 是“整个 Apple 走代理”的宽列表，与 AppleDirect 互斥，已不再引用，AppleProxy 策略组随之移除。Surge 内置的 SYSTEM 规则仍最先直连 `*.ls.apple.com` 等系统服务。原 Claude 规则由新站的 Anthropic 接替；GlobalMedia 使用完整产物，包含域名规则。所有外部规则引用附带 `no-resolve`，避免 IP/ASN 规则主动提前解析 DNS，末尾 `GEOIP,CN,DIRECT` 保留原行为。`GEOIP,CN,DIRECT` 前另有一条不带 `no-resolve` 的 `RULE-SET,LAN,DIRECT`，解析到私有或保留地址的域名（如自建 NAS、内网服务）因此直连，不再落入 `FINAL,Proxy`；Surge 每个请求最多解析一次，`GEOIP` 本就需要这次解析。规则区前部的 `RULE-SET,LAN,DIRECT,no-resolve` 保留，只匹配 `.local` 和直接以 IP 访问的请求。Clash 同样把这条规则展开为不带 `no-resolve` 的本地网段规则。

运行时使用 D1 的 `users`、`nodes`、`assignments`、`store_versions`，不读取历史手动订阅表。

## Clash 兼容输出

本节适用于 master 的稳定转换器；develop 的权重扩展单独试验。分支基线、生产/预览对照和验证边界见 [兼容性核对](client-compatibility.md)。

Surge 是唯一配置源：先按原逻辑生成完整 Surge 配置，再解析为结构化对象并用 YAML 序列化器输出 Clash。没有另一份需要同步维护的 Clash 分流模板。已支持的配置值、节点和规则变动会自动进入两种订阅。

- 支持 VMess AEAD（TCP / WebSocket）、Trojan、常用 Shadowsocks、HTTP / HTTPS、SOCKS5 / SOCKS5-TLS。保留可映射的认证、TLS 校验、证书指纹、ALPN、WebSocket、UDP 和 TCP Fast Open 参数；未知连接参数或不支持的协议会移除整个节点，并清理无效成员、空组和相关规则。`sni=off` 无等价映射时移除节点，不能把 `off` 当成服务器名称。
- VMess、Trojan 按 [Surge 的协议默认能力](https://manual.nssurge.com/policies/udp.html)输出 `udp: true`；转换器将显式 `udp-relay=false` 保留为关闭，但不能依赖该开关在 Surge 的 VMess / Trojan 上禁用 UDP；Surge 官方将它列为其他协议的可选能力。Shadowsocks、SOCKS5 / SOCKS5-TLS 仍需显式启用。缺少 UDP 支持会使 [Mihomo 跳过指向该代理的 UDP 规则](https://wiki.metacubex.one/config/rules/#%E4%BC%98%E5%85%88%E7%BA%A7)，即使 Claude 的域名和 IP 已在 AI 规则中，也可能最终直连。
- 保留节点与策略组的排列、用户主备顺序、`select` / `fallback` / `url-test`。生产地区组使用原生 `fallback`；不带权重的 `smart`（如 `Auto`）近似为仅含代理节点的 `url-test`，不复现真实连接评分。master 转换器不支持 `policy-priority`，相关组会省略并产生不含节点信息的警告。`FINAL` 转为 `MATCH`，省略 Surge 专有的 `dns-failed`；缺少可用兜底策略时不生成配置。
- 映射普通 / 加密 DNS、系统 hosts、IPv6、GeoIP 数据库、全局代理测试地址和测试超时。DNS 劫持配置放入 `tun.dns-hijack`，TUN 是否启用由客户端决定。
- 两种 DNS 模式都显式设置 `dns.proxy-server-nameserver`；DoH 跟随出站规则时，节点域名仍使用普通 DNS 引导，只有加密上游追加 `#RULES`。`[Host]` 中精确域名、`*.` 子域名，以及已在分流规则中声明的 `DOMAIN-SET`，支持将 IPv4 DNS 或 HTTPS DoH 映射为 `dns.nameserver-policy`；域名集复用对应的规则提供器。Surge 的 `*.zslab.ai` 转为 Mihomo 的 `.zslab.ai`，覆盖所有层级子域名且不匹配根域名。其他 Host 写法暂不支持。iOS [Clash 的远程配置识别逻辑](https://github.com/ProjectClash/Clash-Client/blob/main/apple/ClashClientKit/Sources/ClashClientKit/ConfigurationImport.swift)依赖显式的节点解析服务器，缺失时可能把完整订阅当成节点来源并另选规则方案。此前已套用客户端默认方案、只显示 `AUTO` / `PROXY` 的配置，需要重新导入完整订阅并选中使用，确认出现 `AIProxy`、`Telegram`、`YouTube` 等业务组。
- `block-quic` 的 `all-proxy`、`all`、`always-allow` 映射为同名 ProjectClash 扩展 `x-clash-block-quic`，`per-policy` 映射为 `all-proxy`。develop 模板使用 `block-quic = per-policy`（master 为 `all-proxy`）：Surge 中 DIRECT 放行 QUIC，代理默认阻止 QUIC；Surge iOS 6.0.0+ / Mac 6.11.0+ 对支持 UDP 转发的代理改用[自适应模式](https://manual.nssurge.com/policies/parameters.html)，先阻止，客户端不回退 TCP 时再放行。两分支的 Clash 都输出 `x-clash-block-quic: all-proxy`：识别为 QUIC 且最终走代理时阻止，直连 QUIC 放行；策略组手动选为 `DIRECT` 也放行，其他 UDP 仍按规则处理。该判断由 [ProjectClash 内核](https://github.com/ProjectClash/Clash/blob/4b7d5f53cff448f01cd5012b5e3f7eddc7d43e33/tunnel/clash_block_quic.go)在解析最终出口后执行，不添加全局 UDP 443 拦截规则，也不关闭节点 UDP。更新订阅并重连后加载；客户端需使用支持该扩展的版本。 `atlasrouter.zslab.ai` 和 `develop.atlasrouter.zslab.ai` 另有优先的精确域名 `DIRECT` 规则，让订阅及管理入口不依赖代理可用性，也不受 `all-proxy` 的 QUIC 拦截影响；不扩大为整个 `zslab.ai` 直连。
- `skip-proxy`、Surge 模块、脚本、MitM 等不兼容设置被省略，不擅自转换成语义不同的直连或拦截规则。其他未知设置、规则类型也跳过。YAML 注释记录跳过的字段或条目序号，不记录凭据及配置值。
- MagicRule 的固定 Surge 入口映射为同名的 Mihomo 入口，使用 `classical` / `yaml`，由上游原生 Mihomo 完整产物提供规则内容；保留 `no-resolve` 和更新间隔。只有本站已登记且 token 与订阅一致的地址采用此映射。
- 其他远程 `RULE-SET` / `DOMAIN-SET` 通过受 token 保护的 Worker 规则入口转换；保留支持的域名、IP、端口及进程规则。仅已部署模板中的来源可用。`LAN` 按 [Surge 当前公开列表](https://manual.nssurge.com/rules/ruleset.html#lan)展开 `.local`、本地及特殊用途 IPv4/IPv6 网段，仅在源规则指定时添加 `no-resolve`；内置列表随 Surge 版本变化时需重新核对。`SYSTEM` 仍省略。

### 默认值与语义差异

转换需要保留 Surge 的默认行为，不能直接采用 Mihomo 示例中的值。当前核对结果如下；显式配置优先于表中的默认值。

| 项目 | Surge 默认或语义 | Clash 输出 |
| --- | --- | --- |
| VMess / Trojan UDP | 自动支持 UDP | 显式 `udp: true`；显式关闭的跨客户端限制见上文 |
| Shadowsocks / SOCKS5 UDP | 需 `udp-relay=true` | 仅显式启用时开启 |
| VMess 握手 / 加密 | `vmess-aead=false`、`aes-128-gcm` | 仅转换显式 AEAD；不推测旧握手的 `alterId`，加密保持 AES-128-GCM |
| VMess TLS / WebSocket | 都默认关闭；WS 路径 `/` | 保留相同默认值；Trojan / HTTPS / SOCKS5-TLS 强制 TLS |
| TLS 证书校验 / TFO | 校验开启；TFO 默认关闭 | 保持校验，映射显式 `tfo=true/false` |
| `fallback` / `url-test` 间隔 | 省略时 600 秒 | 显式输出 600；由 Smart 转换的组使用 300 |
| 地区/IP 类型组 | master 使用同顺序 fallback，显式间隔 300 秒 | 同顺序 fallback，显式间隔 300 秒 |
| `url-test` 容差 | 省略时 100 毫秒 | 显式输出 100，保留显式 0 |
| 代理测速 URL / 超时 | `proxy-test-url` / `test-timeout`；缺省 `http://bing.com/` / 5 秒 | 用于组级健康检查；超时转换为毫秒 |
| IPv6 / 系统 hosts | IPv6 默认关闭；系统 hosts 默认启用 | 保持对应默认值及显式设置 |

默认值依据 [VMess](https://manual.nssurge.com/policies/vmess.html)、[代理公共参数](https://manual.nssurge.com/policies/parameters.html)、[自动测速组](https://manual.nssurge.com/policy-groups/url-test.html)、[回退组](https://manual.nssurge.com/policy-groups/fallback.html)和 [General](https://manual.nssurge.com/profile/general.html)；目标字段参照 [Mihomo 代理参数](https://wiki.metacubex.one/config/proxies/)及[代理组参数](https://wiki.metacubex.one/config/proxy-groups/)。

仍有以下行为不能等价转换，不能据此认为两个客户端的行为完全相同：

- Surge 组级 `timeout` 是测速结果的延迟筛选阈值，Mihomo 同名字段是健康检查请求的超时。转换只使用全局 `test-timeout`，省略延迟筛选并写入警告。节点级 `test-url` / `test-timeout` 覆盖也会警告；DIRECT 的独立测速参数及两端测速调度方式尚未对齐。当前 Surge 已不使用组级旧 `url`，转换遵循 `proxy-test-url`，旧值冲突时警告。
- QUIC 拦截映射依赖 ProjectClash 扩展，通用 Mihomo 或不支持该字段的旧客户端可能忽略它；输出会注明这一兼容性要求。`per-policy` 的自适应行为无法在 ProjectClash 复现，转换为 `all-proxy` 并写入警告，不会变成关闭拦截；只用 QUIC、不回退 TCP 的应用在新版 Surge 中可经代理使用，在 Clash 中仍被阻止。转换后的节点不带逐节点 `block-quic`（带未知参数的节点会被移除），因此按 Surge 默认值近似。两端对 QUIC 版本的识别范围仍由各自内核决定。
- 节点不支持 UDP 时，Mihomo 会继续匹配后续规则；这与 Surge 的 `udp-policy-not-supported-behaviour` 不等价。修复 VMess / Trojan 的默认开关并不保证服务端 UDP 实际可用。
- 健康检查调度不能等价：Surge Smart 固定每 5 分钟重测，Clash 未显式设置 `lazy`，按 Mihomo 默认 `true`，未选中的组不测试。Surge 原生 fallback / url-test 的 `interval` 是结果有效期，并非固定轮询时钟。Mihomo 的 `max-failed-times` 默认 5 是触发强制健康检查的失败阈值，不是“健康检查连续失败 5 次才换节点”，当前没有配置可保证单次测速失败后保持原 IP。
- MagicRule 使用各客户端各自的完整产物，规则名与引用顺序一致不代表条目逐条相同；其他远程规则中的不支持条目会被省略。客户端图标、隐藏属性和保存的手动选择也取决于客户端版本及本地状态。
- DNS 当前使用 `redir-host`，不是 Surge VIF 的 fake-IP 机制；`SYSTEM`、`FINAL,dns-failed`、`skip-proxy`、模块、脚本和 MitM 等仍按上述限制处理。

Mihomo 检测默认值见 [代理组公共参数](https://wiki.metacubex.one/en/config/proxy-groups/)。测速语义参见 [Surge 公共组参数](https://manual.nssurge.com/policy-groups/parameters.html)；QUIC 与 UDP 回退语义参见 [Surge General](https://manual.nssurge.com/profile/general.html)及 [Mihomo 规则优先级](https://wiki.metacubex.one/config/rules/#%E4%BC%98%E5%85%88%E7%BA%A7)。

Worker 规则入口只允许已部署模板 / 规则清单中的来源，不接受用户传入任意下载地址。MagicRule 入口还校验清单的客户端、规则名称、产物角色与格式，产物仅允许 `magicrule.pages.dev/data/_shared/artifacts/` 下的对应规则文件。清单最多 256 KiB、规则最多 4 MiB，整次获取限时 10 秒。不转发用户 Cookie、token 或 Access Header，不跟随上游跳转；上游公共内容可缓存一小时。重置 token 或停用用户会同时撤销两种订阅、模块和 Worker 规则入口；上游公共规则本身不需要鉴权。

新增 MagicRule 规则集时，在 `surge/magicrule.json` 登记站点索引中同名 Surge / Mihomo 规则的清单标识，在主模板加入 `RULE-SET,{{RULESET_<name>}},<策略>,no-resolve,update-interval=86400`，并验证两种完整产物可用。无需维护第二套规则内容或提交上游规则快照。

新增无法转换的功能可以继续只服务 Surge；需要 Clash 支持时，再补转换映射与测试。格式参考 [Mihomo 规则](https://wiki.metacubex.one/en/config/rules/)、[规则提供器](https://wiki.metacubex.one/en/config/rule-providers/)、[DNS](https://wiki.metacubex.one/en/config/dns/)。
