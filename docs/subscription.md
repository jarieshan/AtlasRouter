# Subscription

AtlasRouter 提供基于多用户节点池的订阅，不再兼容旧手动配置。

Dev 开关在当前页面切换环境，不跳转或整页刷新。关闭时生成正式 `/AtlasRouter` 订阅；开启时生成同域名 `/AtlasRouter-Dev`，使用独立测试节点和开发版配置，不生成环境查询参数。两套凭据独立，切换后需要更新客户端订阅链接。Client 与 DoH 选择会保留，模块、规则和自动更新地址跟随对应路径。订阅和节点池全部加载成功后才切换；失败时保留原环境，未完成的保存会阻止切换，未保存编辑会先提示确认。已发出的 `dev=1` 订阅保留兼容，更新后使用新路径；独立测试域名保持关闭。

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
| `/api/AtlasRouter-Dev/...` | 同正式接口 | 使用相同 Access 与管理员校验，读写独立测试库 |
| `/AtlasRouter?token=<token>` | GET | 用户专属 token；输出完整 Surge 配置 |
| `/AtlasRouter-Dev?token=<token>` | GET | 测试库用户 token；输出开发版配置，模块和规则使用同一路径前缀 |
| `/AtlasRouter?token=<token>&client=clash` | GET | 同一 token；输出从 Surge 配置转换的 Clash / Mihomo YAML |
| `/AtlasRouter/modules/<name>.sgmodule?token=<token>` | GET | 用户专属 token；输出模块 |
| `/AtlasRouter/rules/rule-<hash>.txt?token=<token>` | GET | 用户专属 token；输出已过滤不兼容规则的 Clash 规则集 |
| `/AtlasRouter/rules/magicrule/<client>/<name>.<ext>` | GET | 无需 token；`<client>/<ext>` 为 `surge/list` 或 `mihomo/yaml`，只接受已登记的 MagicRule 规则，输出校验后的列表与 ETag |

`<slug>` 来自 Worker Secret `ADMIN_API_SLUG`，为 128 位随机值的 32 位小写十六进制表示。管理路径只在管理员验证后的页面中注入，不包含在普通用户页面中。每次 master 构建发布会轮换该 Secret，已打开的管理页面需刷新，配置方式见 [env.md](env.md)。即使知道路径，也必须通过 Access JWT 和 `ADMIN_EMAILS` 校验。

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

`[Host]` 通过 `RULE-SET:` 引用本仓库的固定直连规则集 [`CustomDirect.list`](../surge/rule-sets/CustomDirect.list)、MagicRule 的 IBKR、Direct、Apple 列表和国内直连名单 MagicRule `China`（均经 Worker 中转，见“订阅内容”），为这五份名单中的域名分配 DNS：`doh=0` 使用 `223.5.5.5, 119.29.29.29`，`doh=1` 使用 `https://dns.alidns.com/dns-query, https://doh.pub/dns-query`。名单中的 IP 规则不参与 DNS 映射。开关由订阅生成器渲染为具体的 `server:` 值；这两个国内 DoH 上游经 `DIRECT` 出站。该映射位于 `zslab.ai` 和国内 DoH 上游的专用映射之后，专用映射优先；名单外域名沿用默认 DNS。MagicRule Direct 和 Apple 列表在 `[Rule]` 中同样直连，但绝大部分域名不在 China 名单内（如 `download.windowsupdate.com`、`apple.com`）；不做映射时，开启 DoH 后这些直连域名经 `DoH Proxy` 由境外 DoH 解析，可能得到按境外位置调度的 CDN 地址，IDC 节点全部不可用时直连也会因解析失败而中断。Apple 列表同时覆盖进入 `GlobalMedia`、`AIProxy` 的 Apple TV+ 和 Apple Intelligence 域名；这些请求由代理端远程解析，不受该映射影响。

`[Host]` 固定为 `zslab.ai` 和 `*.zslab.ai` 指定 `server:223.5.5.5, 119.29.29.29`，覆盖根域名及所有层级子域名，不受 DoH 开关影响；这是 DNS 服务器分配，不是把域名绑定到这两个 IP。按 [Surge Host 语法](https://manual.nssurge.com/dns/local-dns-mapping.html)，多 DNS 服务器需要 Surge Mac 6.8.0+ / iOS 5.21.0+。节点使用域名时，需要普通 DNS 映射或 IP 地址完成引导解析，避免“连接代理前先通过该代理解析节点”的循环；`zslab.ai` 下的节点由上述映射覆盖，其他节点域名需另配映射。相关行为见 [Surge Mac 版本说明](https://kb.nssurge.com/surge-knowledge-base/release-notes/surge-mac-legacy#version-5.6.0)。

`[Host]` 还固定包含以下两条映射，为国内 DoH 上游自身的域名使用普通 DNS 引导解析；两条均放在直连名单映射之前，不受 DoH 开关影响：

```ini
dns.alidns.com = server:223.5.5.5, 119.29.29.29
doh.pub = server:223.5.5.5, 119.29.29.29
```

Clash 将默认和 Host 指定的 DoH 地址追加 `#RULES`，使用相同的上游域名规则：Cloudflare、Google 走 `DoH Proxy`，阿里、腾讯走 `DIRECT`；节点域名使用普通 `proxy-server-nameserver`。`[Host]` 的 DNS 映射转换为 `nameserver-policy`，包括上述两个上游域名的普通 DNS 映射；五份直连名单复用 `[Rule]` 中对应的规则提供器，生成 `rule-set:<提供器名>` 项；IBKR、Direct、Apple 和 China 名单使用 Worker 中转的 MagicRule Mihomo 产物，CustomDirect 使用 jsDelivr 地址，均不携带订阅 token。普通 DNS 仍用于关闭 DoH 时的解析、上游域名引导解析和连通性测试，这不表示明文查询被完全禁用。

DNS 劫持固定为以下两个目标，不随 DoH 开关或 Tencent OA 模块变化；DoH 开关只控制加密 DNS 上游：

```ini
hijack-dns = 8.8.8.8:53, 8.8.4.4:53
```

该字段只处理经过 Surge 虚拟网卡、发往上述地址的 53 端口 DNS 查询，不拦截其他 DNS 地址或应用自行发起的 DoH/DoT；仅使用系统代理、关闭增强模式时，不会因此接管系统 DNS。参见 [Surge DNS 劫持说明](https://manual.nssurge.com/dns/advanced.html#hijack-dns)。Surge 增强模式本身把系统 DNS 指向自己的应答器，上述两个目标只是额外截获写死这些地址的应用。Mihomo TUN 只能截获进入虚拟网卡的 DNS 数据包，因此 Clash 输出 `tun.dns-hijack: [any:53, tcp://any:53]`，所有进入 TUN 的 53 端口查询（含发往路由器或运营商 DNS 的系统查询）都由 Mihomo 应答；Surge 中非 53 端口的劫持目标原样追加。是否启用 TUN、系统 DNS 查询是否经过 TUN 由客户端和平台决定。

### 腾讯公司内网兼容

适用于腾讯公司内网或公司 VPN 环境下，仅开启 Surge Mac 的“设置为系统代理”、关闭增强模式的用法。兼容配置以 Surge 模块 `tencent-oa.sgmodule` 提供：在页面“Tencent OA Compatibility”处点击“安装到 Surge”（调用 `surge:///install-module`），或复制模块链接后在 Surge 的模块列表中通过 URL 安装；之后在 Surge 中启用或停用模块即可切换，不需要更换订阅链接，启用状态也不会同步到其他设备。模块地址为 `/AtlasRouter/modules/tencent-oa.sgmodule?token=<token>`，与订阅使用同一 token，重置 token 后需重新安装；生成配置开头的“Available modules”注释同样列出该地址。模块声明 `#!system=mac`，Surge iOS 不加载。参见 [Surge 模块](https://manual.nssurge.com/profile/module.html)。

旧链接中的 `tencent_oa=1` 仍被接受：生成配置时用模块中的同一份列表替换 `skip-proxy`，托管更新地址也继续保留该参数，但页面不再生成它。改用模块时从页面重新复制订阅链接，避免模块停用后旧参数仍让例外生效。手动请求 `client=clash&tencent_oa=1` 仍返回 400，避免静默忽略系统代理例外。

默认 `skip-proxy` 包含 `127.0.0.1`、`localhost`、`*.local`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`，以及建行、农行、邮储和上海银行的 4 项域名例外，共 11 项。名单维护在 `modules/tencent-oa.sgmodule` 的 `skip-proxy = …` 一行，由 Worker 打包提供，不依赖外部规则站点。模块不使用 `%APPEND%`，而是整行替换主配置的 `skip-proxy`：先列出默认的 11 项（`10.0.0.0/8` 由模块的 `10.0.0.0/7` 覆盖），再加 6 项公司 IP 网段和 16 项域名匹配，共 33 项。修改默认 `skip-proxy` 时须同步修改模块，测试会检查模块覆盖了默认的每一项。`oa.com` 和 `woa.com` 各自保留根域名与 `*.` 子域名两项，其余 12 个域名使用 `*域名`，例如 `*tencentyun.com`、`*workbuddy.cn`；这种形式也会匹配其他以该字符串结尾的域名。`*qcloud.com` 已覆盖 `myqcloud.com` 及其子域名，因此不另列 `*myqcloud.com`。IP 清单将 `10.0.0.0/8` 与 `11.0.0.0/8` 等价合并为 `10.0.0.0/7`，将 `28.0.0.0/8` 与 `29.0.0.0/8` 等价合并为 `28.0.0.0/7`，其余条目保持原样，IP 整体覆盖范围不变。这些域名包含公网服务，并非全部为内网域名。现有 `exclude-simple-hostnames = true` 仍保留，不含点的简单主机名继续适用该设置。

模块和旧参数都只替换 `skip-proxy` 这一行，保留上述两个目标的 DNS 劫持配置，不追加 `[Host]`、域名或 IP 直连规则；DoH 是否开启仍由独立开关决定，原有 DNS 上游、SYSTEM、LAN、业务规则和最终兜底保持不变。腾讯专用的规则集和 Host 订阅入口已移除，请求返回 404。原 `skip-proxy-lists.sgmodule` 与默认 `skip-proxy` 内容完全相同，已删除。启用模块或旧参数都不会改变 D1 中的用户、节点和分配关系。

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

生成内容中的 `#!MANAGED-CONFIG` 和模块 URL 使用正式域名及 `/AtlasRouter` 路径。它们只接受订阅 `token`，不能用浏览器登录身份代替。修改模板不会改变个人 token；用户重置后，旧 token 同时失去订阅和模块访问权。

master 按地区/IP 类型生成顺序 `fallback` 组，成员依照每位用户的主节点、备用节点排列，间隔为 300 秒，不生成 `policy-priority`。develop 独立试验 Smart 权重，生产源码不读取 `SMART_PRIORITY_SCHEME`，遗留变量不会启用实验。节点不足时允许共享主节点；规则见 [multi-user.md](multi-user.md)。`surge/template.conf` 提供通用设置和规则区，`surge/pool-groups.conf` 提供动态策略组，`surge/rules.list` 放零散规则；最终保留 `FINAL` 兜底规则。不生成 `[MITM]` 段。

develop 的兜底规则指向独立可见的手动选择组：`FINAL,FINAL,dns-failed`。`FINAL` 组选项按 Auto → Proxy → IDC → WARP → ISP → DIRECT 排列，地区/IP 类型分组内部保持现有地区顺序，缺少的类型跳过；不单独加入 `Tailnet Test`。首次使用默认 `Auto`。这里是手动选项顺序，不是故障自动回退顺序；客户端会保留仍有效的手动选择。Clash 对应可见的 `select` 组和 `MATCH,FINAL`。master 的 `FINAL,Proxy,dns-failed` 保持原样。

可见的 `Auto` 使用 `smart, include-all-proxies=true`，包含当前订阅 `[Proxy]` 中的代理节点，不包含 `DIRECT` 或其他策略组；develop 使用 `policy-regex-filter=^(?!Tailnet$).*` 排除仅用于访问 tailnet 的 `Tailnet` 策略；在 `Proxy` 中排在所有地区/IP 类型组之后、`DIRECT` 之前。`Proxy` 默认选择排在首项的地区/IP 类型组，已有且仍有效的客户端手动选择可能被保留；从旧名称 `auto` 更新后，如需继续自动选择，可重新选中 `Auto`。Surge [smart 组](https://manual.nssurge.com/policy-groups/smart.html)结合测速延迟、真实连接响应和丢包择优，并自动重试；它不是始终固定选择单次测速最低的节点。Clash 无等价 smart 类型，转换为每 300 秒测速、容差 50 毫秒的 `url-test`，输出注释说明差异：其他节点比当前节点快 50 毫秒以上才切换，避免延迟相近的节点随测速波动来回切换；当前节点测速失败时不受容差限制。地区/IP 类型组的主备顺序保持原样。

develop 默认提供 `Tailnet = tailscale, section-name=tailnet` 和 `[Tailscale tailnet]`，要求 Surge Mac 6.8.0+ / iOS 5.21.0+。另有可见策略组 `Tailscale = select, Tailnet`，方便在策略组列表找到 Tailnet；它不加入普通上网策略组。使用 Dev 订阅时，在策略组列表找到 Tailscale，展开查看 Tailnet，再打开 Tailnet 的策略编辑器完成交互登录。`interactive-login = true` 只引用当前设备的登录状态，不会自动打开浏览器，也不会继承服务器或其他设备的认证；登录状态按 `tailnet` 段名保存在本机。参见 [Surge Tailscale 官方说明](https://manual.nssurge.com/policies/tailscale.html)。

该策略启用 `auto-add-magic-dns-rule = true`，自动路由控制面下发的可见节点 IPv4/IPv6 地址及 MagicDNS 后缀，无需在仓库硬编码服务器 Tailscale IP、tailnet 域名或登录凭据；未设置子网路由。`exit-node = none`，并从 `Auto` 中排除，避免普通上网流量误选 Tailnet。默认配置及 Tencent OA 模块都不再将 `100.64.0.0/10` 放进 `skip-proxy`，让这些请求有机会交给 Surge；这不等于把整个网段都路由到 Tailnet。

Dev 订阅的所有代理节点使用 `TAILNET_ENDPOINTS` Secret 中的 `.ts.net` 地址，节点名称、地区/IP 类型组和出口保持原样；Surge 通过 `underlying-proxy=Tailnet` 连接，并按该域名严格校验证书。不再另加 `Tailnet Test` 节点或公网备用节点，缺少映射会返回 503。`Auto`、各地区组和 `DoH Proxy` 因而都使用 Tailscale 通道。客户端需要先在同一 tailnet 登录，并获准访问对应节点端口；这项切换只影响 Dev 订阅节点，网页和管理面板的 Cloudflare 入口不变。

为避免启动循环，Dev 中 `controlplane.tailscale.com`、`login.tailscale.com` 使用 `DIRECT`，并通过 `[Host]` 指定独立的国内 DNS；开启 DoH 后也不依赖 Tailnet 节点解析这两个域名。当前网络必须能直接访问控制服务。Tailscale 自身的加密隧道仍会通过互联网直连或 DERP 中继；这里的“仅 Tailscale”指代理节点连接不再访问服务器的公网入口。参见 [Surge 控制连接说明](https://manual.nssurge.com/policies/tailscale.html#control-url)。

Mac 终端 SSH 不使用系统 HTTP 代理，需开启 Surge 增强模式，或为 SSH 单独配置经过 Surge 的 SOCKS 连接，再用服务器的 Tailscale IPv4 或完整 MagicDNS 域名连接。关闭服务器公网管理端口前，应先从 Mac 验证 SSH 登录成功。

Clash 将 Tailnet 和 `[Tailscale tailnet]` 转换为 Mihomo 的 `type: tailscale` 节点，保留 `Tailscale` 策略组和上述 tailnet 域名规则，`Auto` 同样排除 Tailnet。这需要 Mihomo 1.19.25+ 且编译时包含 Tailscale 的内核（ProjectClash 的 macOS 和 iOS 版本均包含）；更早或不含 Tailscale 的内核无法识别该节点，会拒绝整份配置。订阅不含登录凭据：首次访问 tailnet 或对 Tailnet 测速时，内核在 info 级别日志输出 `To start this tsnet server, restart with TS_AUTHKEY set, or go to: <授权链接>`，在浏览器打开该链接完成授权即可。生成配置的 `log-level` 为 `warning`，但 ProjectClash 日志页默认按 info 显示实时日志。登录状态保存在客户端本地，ProjectClash 按配置和节点名区分，重新导入配置或 Tailnet 改名后需重新登录；设备在 tailnet 中默认以内核进程名注册，可在 Tailscale 管理后台改名。

Mihomo 不能像 `auto-add-magic-dns-rule` 那样按控制面下发的节点逐个添加规则，转换时在所有规则之前加入 `IP-CIDR,100.64.0.0/10,Tailnet,no-resolve` 和 `IP-CIDR6,fd7a:115c:a1e0::/48,Tailnet,no-resolve`，使 Tailscale IP 先于 LAN 直连规则匹配。代价是不属于 tailnet 的 `100.64.0.0/10` 地址也会进入 Tailnet 并连接失败，而 Surge 中这些地址按 LAN 规则直连。Tailscale 控制面、DERP 和点对点连接由内核直接发出，不经过规则，上面的 `controlplane.tailscale.com`、`login.tailscale.com` 规则只影响浏览器等其他流量。Tailnet 未设置出口节点，客户端按 `proxy-test-url` 对它测速会显示失败，不影响访问 tailnet。Dev 中各节点的 `underlying-proxy=Tailnet` 转换为 `dialer-proxy: Tailnet`，Bootstrap DNS 对应独立的 `nameserver-policy`。

develop 的 `DoH Proxy` 组仅列出当前订阅中已启用的 IDC 节点，跨地区汇集，不包含 ISP、WARP、`DIRECT`、`REJECT` 或其他策略组。Surge 使用不带权重的 `smart`，Clash 使用 `url-test`（间隔 300 秒、容差 50 毫秒）。没有 IDC 节点时不输出空组，将原本指向该组的国外 DoH 规则改为 `REJECT`，国内 DNS 和其余订阅照常生成，避免 [Surge 空组自动替换为直连](https://manual.nssurge.com/policy-groups/overview.html)。Clash 过滤掉全部不兼容 IDC 节点时同样保留这些拒绝规则；只过滤部分节点时继续使用剩余 IDC。

香港银行与政府等固定直连域名维护在本仓库的 [`surge/rule-sets/CustomDirect.list`](../surge/rule-sets/CustomDirect.list)，与 WeChat 规则集一样经 jsDelivr 以 `RULE-SET,…,DIRECT` 引用，位于 `rules.list` 的零散规则之后、其他外部规则集之前；Surge 和 Clash 均直接读取该地址，不携带订阅 token。`[Host]` 引用同一地址为这些域名指定国内 DNS，开启 DoH 时不再经境外 DoH 解析。订阅入口和 DoH 上游的直连规则仍留在 `rules.list`，不依赖任何规则集下载；规则集尚未下载成功时，其中的域名会落到后续规则。不创建可选策略组，因此客户端策略面板没有对应项目。当前银行与政府范围如下，域名后缀包含根域名及其子域名：

| 服务 | 直连范围 |
| --- | --- |
| [汇丰香港](https://www.hsbc.com.hk/) / [HSBCnet](https://www.hsbcnet.com/) | `hsbc.com.hk`、`hsbc.com`、`hsbcnet.com` |
| [渣打香港](https://www.sc.com/hk/) | `sc.com`、`standardchartered.com`、`standardchartered.com.hk` |
| [中银香港](https://www.bochk.com/) | `bochk.com` |
| [工银亚洲](https://www.icbcasia.com/) | `icbcasia.com`；精确匹配网银域名 `myebankasia.icbc.com.cn`、`corpebankasia.icbc.com.cn` |
| [众安银行](https://bank.za.group/) | `za.group`，包含银行及其共用服务域名 |
| [恒生银行](https://www.hangseng.com/) | `hangseng.com` |
| [香港政府](https://www.gov.hk/) | `gov.hk` |

列表另含 `cdn.kineticbloom.org`，以及两个国内域名：字节跳动国内接口 `snssdk.com`和安居客图片 `ajkimg.com`（开启 DoH 时境外上游会把它解析到海外 CDN 节点）。`hsbc.com`、`hsbcnet.com`、`sc.com`、`standardchartered.com` 等为银行共用域名，其下的其他地区服务也会直连。这里控制的是规则模式下的分流，不修改 `skip-proxy`，也不启用 MitM。

需要拒绝的域名维护在 [`surge/rule-sets/CustomReject.list`](../surge/rule-sets/CustomReject.list)（目前为 `msmp.abchina.com.cn`），同样经 jsDelivr 引用，排在 CustomDirect 之前，因此先于国内直连名单中的 `.cn` 等规则生效；它不参与 `[Host]` 映射。`rules.list` 现在只保留订阅入口和 DoH 上游的规则。

RedPocket 使用本仓库的 [`RedPocket.list`](../surge/rule-sets/RedPocket.list)，位于 CustomReject 之后、CustomDirect 和其他通用名单之前，直接指向当前订阅的 `🇺🇸USA-ISP` 组，不受 `FINAL` 手动选择影响；没有美国 ISP 组时使用 `REJECT`，Clash 过滤掉全部不兼容的美国 ISP 节点时同样拒绝。规则按 2026-11-11 的[官网](https://www.redpocket.com/)、[账户入口](https://goredpocket.com/)、[帮助中心](https://help.redpocket.com/)和[官方 eSIM 设置文档](https://www.redpocket.com/configure)采集，覆盖网站与账户、两处页面静态资源，以及 GSMA/GSMT/CDMA 的三个 SM-DP+ 端点；共享 CDN 与 eSIM 服务只匹配具体主机，不匹配整个平台。Surge 和 Clash 均通过 jsDelivr 直接读取规则集。此范围来自公开页面，未采集登录后的 App 请求，也不表示 Wi-Fi Calling 的运营商隧道已被覆盖。

券商使用 MagicRule 的独立规则，紧随 CustomDirect：IBKR（盈透证券，含 `ibkr.com`、`interactivebrokers.com`、`ibllc.com` 等各地区域名）走 `DIRECT`，`[Host]` 也为其指定国内 DNS；LongBridge（长桥证券，含 `lbkrs.com`、`lbctrl.com`、`longbridgeapp.com`、`longbridge.global`、`longbridge.cn` 等）进入 `Proxy`。两者都必须排在国内直连名单之前：后者含整段 `.cn`，其 IP 段也覆盖长桥 App 的国内服务器。

券商规则之后、WeChat 之前是 MagicRule 的 `Direct` 列表。它是 MagicRule 的直连白名单，收录 PT 站、路由器与 NAS 管理域名、私有网段的反向解析域名、学术数据库和 Windows 更新等，另含 36 条 `PROCESS-NAME`（BT 下载工具、其他代理客户端、`cloudflared`、`tailscaled`、远程桌面等，仅在支持进程规则的客户端上生效）。它排在 AI、Apple 等规则集之前，因此这些进程的流量一律直连，例如 `cloudflared` 连接 Cloudflare 时不再按 Cloudflare 列表进入 AIProxy。

master 的地区/IP 类型组设置 `hidden=true`，隐藏客户端主面板中的独立分组，仍可作为其他策略组的选项。私有开发服务启用 `SHOW_ALL_PROXY_GROUPS`，Dev 订阅显示全部策略组；正式订阅未启用。账户网页和管理员节点清单继续展示分配信息。Apple 只保留 `iCloud` 一个可见分组，首项为 `DIRECT`，其余选项先按 IDC → WARP → ISP，再按地区顺序排列；其余 Apple 服务由 Apple 完整规则直接走 `DIRECT`。这里的顺序是手动选择项顺序，不是 DIRECT 失败后的自动切换顺序；客户端已有且仍有效的手动选择可能被保留。

模板支持在 `[Rule]` 的 `RULE-SET` / `DOMAIN-SET` 行上追加 `hidden=true` 或 `hidden=false`，作为 AtlasRouter 对所引用策略组的显示设置。生成时会移除规则行的该参数，将其应用到对应 `[Proxy Group]` 定义，再转换为 Clash 的 `hidden` 属性；规则、策略引用和匹配顺序保持有效。`hidden=false` 会移除组上的隐藏参数，使用默认可见行为。源码中的 `SHOW_ALL_PROXY_GROUPS` 可覆盖逐组显示设置，但正式部署未启用此选项。此写法不是 Surge 原生规则参数；原生 `hidden` 属于[策略组参数](https://manual.nssurge.com/policy-groups/parameters.html#hidden)。同一组被多条规则引用时，未标记的规则不覆盖显式设置，多个显式设置必须一致；不能用于 `DIRECT`、`REJECT` 或不存在的组。

`WeChat`、`Telegram` 和 `X` 是可见的独立策略组，分别接收 WeChat、Telegram 和 Twitter 规则集的流量。WeChat 按 `DIRECT` → IDC → WARP → ISP 排列，默认直连。Telegram 按 IDC → WARP → ISP → `Proxy` → `DIRECT` 排列，默认选择首个可用的 IDC 组，缺少某类节点时跳过。X、AIProxy 按 ISP → WARP → IDC → `Proxy` → `DIRECT` 排列，默认选择首个可用的 ISP 组。GlobalMedia（含 Apple TV+）按 WARP → IDC → ISP → `Proxy` → `DIRECT` 排列，默认选择首个可用的 WARP 组；部分流媒体可能限制 WARP 或机房出口，此时可手动切换到 ISP 组。上述地区/IP 类型选项先按 IP 类型、再按美国 → 香港 → 新加坡 → 日本 → 其他地区排序；其他地区按两位地区代码的字母升序排列。`Proxy` 自身不包含自引用，选项采用 ISP → WARP → IDC → `Auto` → `DIRECT` 顺序。所有可选策略组均不提供 `REJECT` 选项。`💎 Select` 已移除。

`YouTube` 是可见的独立策略组，选项按 WARP → IDC → ISP 排列，仅列出可用的地区/IP 类型组，默认选择首个 WARP 组；没有 WARP 时依次选择首个 IDC 或 ISP 组。它使用 MagicRule 的原生 Surge / Mihomo YouTube 完整规则，放在 Netflix 等影音规则之前。这是手动选择项顺序；地区/IP 类型组内，Surge / Clash 使用同顺序的 `fallback`。

`OverseasFinance`（原 `Coin`）是可见的独立策略组，接收 Binance、OKX、Coinbase、Bybit、Bitget 以及 PayPal、eBay、Stripe、Wise 的流量，选项按 ISP → WARP → IDC → `DIRECT` 排列，默认选择首个可用的 ISP 组；客户端为原 `Coin` 组保存的手动选择不会沿用。除 Coinbase、Bitget 外均使用 MagicRule 的独立规则；MagicRule 没有这两家的独立规则，其域名维护在本仓库的 [`surge/rule-sets/Coin.list`](../surge/rule-sets/Coin.list)，经 jsDelivr 引用，文件名不随组名改变。这些规则排在 Telegram、X、Discord、YouTube 之后、Netflix 等影音规则之前，也先于国内直连名单，因此 PayPal 列表中的 `paypal.com.cn`、贝宝等 `.cn` 域名和 eBay 列表中的 `ebay.cn` 等 `.cn` 域名同样进入 OverseasFinance；PayPal 列表另含 `DOMAIN-KEYWORD,paypal`。排在前面的 OpenAI 列表也收录了 `stripe.com`，所以 `stripe.com` 及其子域名仍进入 `AIProxy`，OverseasFinance 只接收 Stripe 的 `stripe.network`、`stripecdn.com`、`link.com` 等其余域名。`[Host]` 不为这些域名单独指定 DNS，按默认 DNS 设置解析。

`ISP First` 是可见的独立策略组，选项只有 ISP → WARP → IDC 的地区/IP 类型组，不含 `Proxy` 和 `DIRECT`，默认选择首个可用的 ISP 组。它接收 MagicRule 的 Facebook、Threads、Reddit 和 Line 规则，排在 OverseasFinance 之后、Netflix 等影音规则之前。Facebook 列表覆盖整个 Meta 平台：除 Facebook 外还含 Instagram、WhatsApp、Messenger、`meta.com`、`fbcdn.net`，以及 `facebook`、`fbcdn` 两条 `DOMAIN-KEYWORD`、Meta 的 IP 段和 `IP-ASN,32934`；CustomAI 中 `ai.meta.com` 等 Meta AI 主机排在前面，仍进入 `AIProxy`。Line 列表含 LINE 的域名和 IP 段。IP 类规则带 `no-resolve`，只匹配直接以 IP 访问的请求。

业务策略组使用纯文字名称，图标来自 [Koolson/Qure Color](https://github.com/Koolson/Qure/tree/master/IconSet/Color)，通过 jsDelivr 公共链接加载。WeChat、Telegram、X、YouTube、Apple、iCloud 使用对应服务 Logo；Auto 使用 `Auto.png` 自动选择图标；DoH Proxy 使用 `Server.png` 服务器图标；Proxy、AIProxy、GlobalMedia、OverseasFinance、ISP First 分别使用通用代理、AI、影音、加密货币、地球图标。首次从带 emoji 的旧组名更新后，客户端已保存的手动选择可能需要重新设置。Surge 使用 [`icon-url`](https://manual.nssurge.com/policy-groups/parameters.html)（Mac 6.5.0+），转换为 Clash 时映射为 [`icon`](https://wiki.metacubex.one/en/config/proxy-groups/#icon)，显示效果取决于客户端面板支持。正式订阅的策略组可见性按模板设置。

WeChat 使用本仓库维护的 [`surge/rule-sets/WeChat.list`](../surge/rule-sets/WeChat.list)。Surge 通过 jsDelivr 读取当前分支的文件（develop 为 `https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/WeChat.list`，移植到 master 时改为 `@master`），不附加个人 token；Clash 也直接读取同一地址（classical 文本格式），不经 Worker，不支持的 `USER-AGENT` 行由 Mihomo / ProjectClash 跳过并记录警告。初始内容来自 blackmatrix7 的 WeChat 规则（2025-06-06 版本，GPL-2.0，文件头保留来源与改动说明），该仓库将于 2026 年底停止自动更新。原列表把 233 个 IPv4 /24 前缀写成 `DOMAIN-KEYWORD`，Clash 不会用域名关键字匹配直接以 IP 发起的连接；这里改为覆盖相同地址的 `IP-CIDR` 并合并相邻网段，其余条目不变。jsDelivr 对分支文件最多缓存 12 小时，修改后可访问 `https://purge.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/WeChat.list` 刷新。客户端更新间隔为 24 小时。

其他外部规则使用 [MagicRule](https://magicrule.pages.dev/)；上游 [迁移公告](https://github.com/blackmatrix7/ios_rule_script/issues/1747) 说明旧仓库在 2026 年底停止自动更新。`surge/magicrule.json` 为每条规则登记 MagicRule 官方索引（`/data/index/Surge.json`、`/data/index/Mihomo.json`）给出的 Surge 与 Mihomo `manifest.json` 地址。清单分布在 `magicrule.pages.dev` 和 `rule-26r.pages.dev` 两个站点（例如 OKX、Bybit、IBKR、LongBridge 位于后者）。MagicRule 调整分组时会更换产物文件名，旧产物地址随即返回 HTTP 200 的网站首页，客户端会把它当作空规则集；清单地址按规则 ID 固定，不随产物改名。

模板中的 `{{RULESET_<name>}}` 渲染为本部署的 `<订阅路径>/rules/magicrule/surge/<name>.list`，转换为 Clash 时换成同一规则的 `.../mihomo/<name>.yaml`；地址不含订阅 token，也不需要鉴权。Worker 收到请求时读取清单，只取同一站点下以规则名开头、`role=full` 的非空文本产物，并逐行校验：Surge 列表的每条非注释行、Mihomo 文件 `payload:` 下的每一项都必须是 `类型,值` 形式的规则，且至少有一条。通过校验的内容写入 D1，作为最后有效副本；清单或产物不可用、超出大小限制或未通过校验时返回该副本，没有副本时返回 502，不会把网页或空列表当作规则下发。Mihomo 遇到非 2xx 响应时保留原有规则（v1.19.33 实测）；Surge 的外部规则集也有本地缓存，下载失败时的表现尚未在设备上验证。

模板为 MagicRule 规则设置 `update-interval=21600`，客户端每 6 小时检查一次，转换为 Clash 时对应规则提供器的 `interval: 21600`；本仓库规则集沿用默认的 24 小时。中转响应带内容 SHA-256 的 ETag 和 `cache-control: no-cache`，客户端用 `If-None-Match` 检查，内容未变时得到 304，不重新下载。Surge 自 iOS 5.14.0 / Mac 5.8.1 起支持；Mihomo 与 ProjectClash 的 `etag-support` 默认开启。Worker 读取的清单和产物在 Cloudflare 边缘最多缓存一小时，上游更新最多约一小时后出现在中转结果中，客户端在下次更新规则时取得。某条规则在 MagicRule 改名或下线时，从官方索引取新的清单地址更新 `surge/magicrule.json` 并重新部署。

生产 Worker 的 Cron Trigger（`*/5 * * * *`）每 5 分钟按登记顺序检查一个列表，当前登记的 76 个列表约 6 小时 20 分钟轮完一遍；每次只下载一份清单和产物，以符合 Workers 免费计划每次 10 ms CPU 的限制。检查使用与中转相同的校验，通过的内容同时更新 D1 中的最后有效副本。同一列表连续 2 次检查失败时，通过 [Bark](https://bark.day.app/) 推送一次提醒，恢复后再推送一次；推送失败时，下一次运行会重试。检查状态记在 D1 `magic_rule_checks` 表，设置见 [环境与存储](env.md)。Cron Trigger 只在生产环境运行，因此只检查 master 的登记，私有开发订阅服务不运行定时任务。定时检查不读取官方索引（每份约 860 KB，超出免费计划的 CPU 限制）；修改登记时在 `worker/` 运行 `npm run check:magic-rules`，它会对照索引检查全部清单，并列出应改用的清单地址。

国内直连名单使用 MagicRule `China` 列表（2026-10-30 更新时约 6,300 条域名后缀和 3,900 条 IP 段，含整段 `.cn`），与其他 MagicRule 规则一样登记在 `surge/magicrule.json`。模板的 `[Rule]` 和 `[Host]` 都引用 `{{RULESET_China}}`：前者排在 LAN 解析规则之后、`GEOIP,CN` 之前直连，后者为其中的域名指定国内 DNS。Clash 使用 China 的 Mihomo 原生产物，并以同一规则提供器生成 `nameserver-policy`。名单含 `DOMAIN-SUFFIX,ms`，所有 `.ms` 域名（如 `aka.ms`）直连；还含 `microsoft`、`-cn` 等宽泛的 `DOMAIN-KEYWORD`，含这些字样的域名一律直连，排在其前的规则集已收录的除外。淘宝、百度、支付宝、阿里云在名单中只有关键字规则。

不引用 MagicRule 的 Google 规则集：其当前 Surge / Mihomo 产物含 `hk`、`tw`、`sg`、`co` 等 28 个国家/地区顶级域的整段 `DOMAIN-SUFFIX`，会先于国内直连名单和 `GEOIP,CN` 把这些顶级域下的全部域名送往 `Proxy`。Google 自有域名改用 MagicRule 的 Alphabet 列表，它不含国家/地区顶级域，只有 `.google`、`.android`、`.youtube` 等 Google 自有顶级域的整段后缀。Alphabet、GitHub 和 Wikimedia（维基百科及 `wikidata.org`、`wiktionary.org` 等姊妹项目）三份列表排在影音规则之后、LAN 解析规则和国内直连名单之前，进入 `Auto`，不受 `FINAL` 手动选择影响；它们位于第一条需要解析的 LAN 规则之前，匹配时不做本地 DNS 查询。由于先于国内直连名单，Google 的 `-cn` 域名（如 `admob-cn.com`、`gstatic-cn.com`）、`google.cn` 和 `gstatic.cn` 等 `.cn` 域名，以及 GitHub Actions 结果存储等 `*.blob.core.windows.net` 主机也进入 `Auto`，不再因名单的 `-cn` 关键字、`windows.net` 后缀或 IP 段（如 Google 国内缓存的 `203.208.32.0/19`）直连。YouTube、Gemini 等仍由排在前面的各自规则集处理。

AI 规则紧随本仓库的 WeChat 规则集：Cloudflare、OpenAI、Anthropic、Gemini、Grok、Cursor、Perplexity、本仓库的 [`CustomAI.list`](../surge/rule-sets/CustomAI.list) 和 AppleIntelligence 均进入 `AIProxy`。它们必须排在 Apple 和 Twitter 之前，因为覆盖整个 `apple.com` 的 Apple 列表以及 Twitter 列表也收录了 Apple Intelligence、`grok.com` 等 AI 域名。Grok 列表含 `grok.com`、`grok.x.com`、`grokipedia.com` 和 `x.ai`（含 xAI API）；Cursor 列表含 `cursor.com`、`cursor.sh`、`cursorapi.com`、`cursor-cdn.com` 和 `cursorvm.com`，覆盖 Grok Bot 官方网络说明列出的全部域名。Perplexity 列表含 `perplexity.ai`、`perplexity.com`、`pplx.ai`，以及 `ppl-ai-file-upload.s3.amazonaws.com`、`pplx-res.cloudinary.com` 两个具体主机，不匹配整个 S3 或 Cloudinary。MagicRule 没有 Meta AI、Muse 和 Grok Bot 的独立规则，CustomAI 收录 `meta.ai`（含 Meta Model API 的 `api.meta.ai`）、`muse.ai`、`metaaiusercontent.com`、`metaaivm.com`、`llama.com` 等 Meta AI 域名，以及 Grok 的 `grokusercontent.com` 和 `grokbot.com`；Meta 网页共用的 Facebook CDN（`fbcdn.net`、`fbsbx.com`）不进入 AIProxy，由 Facebook 列表送入 `ISP First`。Cloudflare 列表除 Cloudflare 自身服务外，还含 `pages.dev`、`workers.dev`、`r2.dev` 等托管域名（包括 MagicRule 站点）和 Cloudflare IP 段；IP 规则只匹配直接以 IP 访问的请求。列表未收录的 Cloudflare Mirrors（`cloudflaremirrors.com`，提供 Arch Linux 和 Debian 镜像）由 CustomAI 补上，否则它虽解析到列表 IP 段内的地址，仍会落到 `FINAL`。不引用 MagicRule 的 Bing 和 Copilot 规则集。Copilot 列表名为 Microsoft Copilot，实际收录 Cursor、GitHub Copilot、Groq、Meta AI、Grok 等多种 AI 工具；其中 Grok、Cursor、Meta AI 已由上述规则接管，其余域名（如 `api.githubcopilot.com`、`api.groq.com`、`copilot.microsoft.com`、`bing.com`、`ampcode.com`）交由后续的国内直连名单、`GEOIP,CN` 和 `FINAL,FINAL` 判断，不再由 GlobalMedia 聚合列表接管。

AppleIntelligence 列表放在 AI 规则末尾；其余 Apple 规则位于 AI 规则之后、Telegram 之前，按 AppleTV → iCloud → Apple 完整规则的顺序匹配。MagicRule 的 AppleTV 列表（`tv.apple.com` 及 Apple TV+ 的播放接口）进入 `GlobalMedia`，AppleIntelligence 列表（私密云计算中继及 `siri.apple.com`）进入 `AIProxy`；两者都必须先于覆盖整个 `apple.com` 的直连列表。iCloud 列表（可手动切换，默认直连）完全包含在 Apple 完整规则中，因此同样排在它之前；其余 Apple 服务由 Apple 完整规则直接走 `DIRECT`，包括 App Store、软件更新和 Apple Music。MagicRule 的 AppleDirect 列表也完全包含在 Apple 完整规则中，已不再引用，只有 `DIRECT` 一个选项的 AppleDirect 策略组随之移除。MagicRule 的 AppleProxy 是“整个 Apple 走代理”的宽列表，与 Apple 直连互斥，同样不再引用，AppleProxy 策略组已移除。Surge 内置的 SYSTEM 规则仍最先直连 `*.ls.apple.com` 等系统服务。原 Claude 规则由新站的 Anthropic 接替；影音规则使用各服务的独立完整产物。所有外部规则引用附带 `no-resolve`，避免 IP/ASN 规则主动提前解析 DNS，末尾 `GEOIP,CN,DIRECT` 保留原行为。国内直连名单前另有一条不带 `no-resolve` 的 `RULE-SET,LAN,DIRECT`，解析到私有或保留地址的域名（如自建 NAS、内网服务）因此直连，不再落入 `FINAL,FINAL`。到达这里的域名都会在本地解析一次：国内直连名单中的域名本就直连，连接时同样要解析，不增加查询；Surge 每个请求最多解析一次，随后国内直连名单的 IP 段和 `GEOIP,CN` 都用这次的结果判断。本地解析失败时，`FINAL` 的 `dns-failed` 让请求交给 `FINAL` 组；选中代理时由代理端远程解析。规则区前部的 `RULE-SET,LAN,DIRECT,no-resolve` 保留，只匹配 `.local` 和直接以 IP 访问的请求。Clash 同样把这条规则展开为不带 `no-resolve` 的本地网段规则。

### 影音、音乐和直播规则（develop）

`GlobalMedia` 策略组只接收以下 6 份 MagicRule 独立服务规则；YouTube 保持独立策略组。清单地址分别取自官方 [Surge 索引](https://magicrule.pages.dev/data/index/Surge.json)和 [Mihomo 索引](https://magicrule.pages.dev/data/index/Mihomo.json)，登记在 `surge/magicrule.json`，使用各客户端的完整产物。

| 分类 | MagicRule 规则名 |
| --- | --- |
| 影视 | AppleTV、Netflix、Disney |
| 音乐 | Spotify、TIDAL |
| 视频 | TikTok |

不再引用或中转名为 `GlobalMedia` 的聚合规则集。该列表曾混入 `DOMAIN-KEYWORD,claude` 等 AI 关键词，会把 `fuck-claude.vercel.app` 这类无关域名送入影音组；现在它不再因这条关键词匹配到 GlobalMedia，而是继续按其他规则和最终兜底判断，通常走 `Proxy`。AI 仍由现有 AI 规则处理；没有新增整个 `vercel.app` 的后缀规则或单站例外。

Hulu、IMDB 及其他未保留的影音服务不再单独登记，继续匹配通用规则。平台清单可能包含同品牌其他业务，规则内容由上游维护。

AppleTV 仍在 Apple 完整规则之前，其余 5 项位于 ISP First 之后、LAN / China / GEOIP / FINAL 之前，全部引用仍带 `no-resolve`，每 6 小时更新。develop 现共登记 38 种规则、76 份客户端产物；私有开发 Worker 不运行 Cron。

运行时使用 D1 的 `users`、`nodes`、`assignments`、`store_versions`，不读取历史手动订阅表。

## Clash 兼容输出

本节适用于 master 的稳定转换器；develop 的权重扩展单独试验。分支基线、历史分支对照和验证边界见 [兼容性核对](client-compatibility.md)。

Surge 是唯一配置源：先按原逻辑生成完整 Surge 配置，再解析为结构化对象并用 YAML 序列化器输出 Clash。没有另一份需要同步维护的 Clash 分流模板。已支持的配置值、节点和规则变动会自动进入两种订阅。

- 支持 VMess AEAD（TCP / WebSocket）、Trojan、常用 Shadowsocks、HTTP / HTTPS、SOCKS5 / SOCKS5-TLS。保留可映射的认证、TLS 校验、证书指纹、ALPN、WebSocket、UDP 和 TCP Fast Open 参数；未知连接参数或不支持的协议会移除整个节点，并清理无效成员、空组和相关规则。`sni=off` 无等价映射时移除节点，不能把 `off` 当成服务器名称。
- VMess、Trojan 按 [Surge 的协议默认能力](https://manual.nssurge.com/policies/udp.html)输出 `udp: true`；转换器将显式 `udp-relay=false` 保留为关闭，但不能依赖该开关在 Surge 的 VMess / Trojan 上禁用 UDP；Surge 官方将它列为其他协议的可选能力。Shadowsocks、SOCKS5 / SOCKS5-TLS 仍需显式启用。缺少 UDP 支持时，[Mihomo 跳过指向该代理的 UDP 规则](https://wiki.metacubex.one/config/rules/#%E4%BC%98%E5%85%88%E7%BA%A7)继续匹配，没有规则可用时直连；Surge 按 [`udp-policy-not-supported-behaviour`](https://manual.nssurge.com/policies/udp.html) 处理，默认 REJECT。因此规则的策略可能选中不支持 UDP 的节点时（含经策略组间接选中），转换器在该规则后追加只匹配 UDP 的 `AND,((NETWORK,UDP),(<原条件>)),REJECT`，`MATCH` 后追加 `NETWORK,UDP,REJECT`。只有当前选中节点不支持 UDP、原规则被跳过时才会命中，TCP 和支持 UDP 的选择不受影响；条件含括号时改用同条件的普通规则，效果相同。Surge 显式设为 `DIRECT` 时改用 DIRECT。全部节点支持 UDP 时不追加；YAML 注释记录追加数量。
- 保留节点与策略组的排列、用户主备顺序、`select` / `fallback` / `url-test`。生产地区组使用原生 `fallback`；不带权重的 `smart`（如 `Auto`）近似为仅含代理节点的 `url-test`，不复现真实连接评分。master 转换器不支持 `policy-priority`，相关组会省略并产生不含节点信息的警告。`FINAL` 转为 `MATCH`，省略 Surge 专有的 `dns-failed`；缺少可用兜底策略时不生成配置。
- 映射普通 / 加密 DNS、系统 hosts、IPv6、GeoIP 数据库、全局代理测试地址和测试超时。`tun.dns-hijack` 劫持全部 53 端口 DNS，对应 Surge 接管系统 DNS，并追加 `hijack-dns` 中非 53 端口的目标；TUN 是否启用由客户端决定。
- GeoIP 库的自动更新沿用 Surge 设置：Surge 默认定期更新，`disable-geoip-db-auto-update = true` 时停止；Mihomo 默认不自动更新，开启后的默认间隔为 24 小时。转换默认输出 `geo-auto-update: true` 和 `geo-update-interval: 168`，Surge 关闭更新时两项均省略。168 小时对应 Loyalsoldier GeoIP 每周一次的定时构建。Mihomo 只更新规则实际使用的数据库；ProjectClash 由 App 按该间隔重新完整下载 `geox-url` 中的全部 4 个文件，不发条件请求，任一文件失败时下次整组重试。Surge 的 IP-ASN 规则使用 App 内置、随版本更新的 ASN 库，没有对应配置（见 [Surge IP 规则](https://manual.nssurge.com/rules/ip.html)）；Mihomo 遇到 OpenAI、Anthropic、Telegram 列表中的 `IP-ASN` 规则时需另行下载，因此 `geox-url.asn` 指向 jsDelivr 上的 Loyalsoldier `GeoLite2-ASN.mmdb`，与模板的 GeoIP 库同源。规则不读取 `GeoIP.dat` 和 `GeoSite.dat`，`geox-url.geoip` / `geosite` 指向 jsDelivr 上 MetaCubeX 的精简版文件（合计约 0.4 MB），ProjectClash 每次同步约 18 MB，且不依赖 GitHub。
- 组级健康检查的测试地址路径为 `/generate_204` 时输出 `expected-status: 204`。Mihomo 默认把任何 HTTP 响应都算作可用，返回认证页、跳转或错误页的节点也会显示为正常；其他测试地址（如返回 200 的页面）保持默认。`unified-delay: true` 让测速结果去掉握手等额外耗时，TLS 与非 TLS 节点按同一标准比较；ProjectClash 本身强制开启，此项让其他 Mihomo 客户端得到一致的结果。
- `tcp-concurrent: true` 对应 Surge 对多地址域名的[并发握手](https://community.nssurge.com/d/2207-surge)：域名解析出多个 IP 时，同时向全部地址发起 TCP 连接，使用最先建立的一个；直连和连接节点服务器都适用。Mihomo 默认按顺序逐个尝试，全部地址共用一个 5 秒期限，首个地址不响应就会耗尽期限，后面可用的地址来不及尝试，日志中每个地址都记为 `i/o timeout`。Surge 会记住最快的地址，后续连接优先使用；Mihomo 每次连接都重新同时尝试全部地址。
- DNS 使用 `fake-ip`，对应 [Surge 增强模式的 DNS 应答](https://manual.nssurge.com/dns/advanced.html)：应用立即得到假 IP，不等待上游 DNS；连接时还原为域名再匹配规则，因此带 `no-resolve` 的 IP 规则只匹配直接以 IP 访问的请求。`profile.store-fake-ip` 让映射在重启后保留。HTTPS / SVCB 查询得到空应答，客户端改查 A 记录，效果对应 Surge 默认的 `allow-dns-svcb = false`。`use-application-dns.net` 经 `nameserver-policy` 返回 NXDOMAIN，与 Surge 相同，使 Firefox 停用自带 DoH；`fake-ip-filter` 让 Windows 联网检测域名（`msftconnecttest.com`、`msftncsi.com`）取得真实地址。
- 两种 DNS 模式都显式设置 `dns.proxy-server-nameserver`；DoH 跟随出站规则时，节点域名仍使用普通 DNS 引导，只有加密上游追加 `#RULES`。`[Host]` 中精确域名、`*.` 子域名，以及已在分流规则中声明的 `DOMAIN-SET` / `RULE-SET`，支持将 IPv4 DNS 或 HTTPS DoH 映射为 `dns.nameserver-policy`；域名集和规则集复用对应的规则提供器，Mihomo 只用其中的域名类规则。Surge 的 `*.zslab.ai` 转为 Mihomo 的 `.zslab.ai`，覆盖所有层级子域名且不匹配根域名。其他 Host 写法暂不支持。iOS [Clash 的远程配置识别逻辑](https://github.com/ProjectClash/Clash-Client/blob/main/apple/ClashClientKit/Sources/ClashClientKit/ConfigurationImport.swift)依赖显式的节点解析服务器，缺失时可能把完整订阅当成节点来源并另选规则方案。此前已套用客户端默认方案、只显示 `AUTO` / `PROXY` 的配置，需要重新导入完整订阅并选中使用，确认出现 `AIProxy`、`Telegram`、`YouTube` 等业务组。
- `block-quic` 的 `all-proxy`、`all`、`always-allow` 映射为同名 ProjectClash 扩展 `x-clash-block-quic`，`per-policy` 映射为 `all-proxy`。develop 模板使用 `block-quic = per-policy`（master 为 `all-proxy`）：Surge 中 DIRECT 放行 QUIC，代理默认阻止 QUIC；Surge iOS 6.0.0+ / Mac 6.11.0+ 对支持 UDP 转发的代理改用[自适应模式](https://manual.nssurge.com/policies/parameters.html)，先阻止，客户端不回退 TCP 时再放行。两分支的 Clash 都输出 `x-clash-block-quic: all-proxy`：识别为 QUIC 且最终走代理时阻止，直连 QUIC 放行；策略组手动选为 `DIRECT` 也放行，其他 UDP 仍按规则处理。该判断由 [ProjectClash 内核](https://github.com/ProjectClash/Clash/blob/4b7d5f53cff448f01cd5012b5e3f7eddc7d43e33/tunnel/clash_block_quic.go)在解析最终出口后执行，不添加全局 UDP 443 拦截规则，也不关闭节点 UDP。更新订阅并重连后加载；客户端需使用支持该扩展的版本。 `atlasrouter.zslab.ai` 保留优先的精确域名 `DIRECT` 规则，让订阅及管理入口不依赖代理可用性，也不受 `all-proxy` 的 QUIC 拦截影响；不扩大为整个 `zslab.ai` 直连。
- `skip-proxy`、Surge 模块、脚本、MitM 等不兼容设置被省略，不擅自转换成语义不同的直连或拦截规则。其他未知设置、规则类型也跳过。YAML 注释记录跳过的字段或条目序号，不记录凭据及配置值。
- MagicRule 的 Surge 中转地址映射为同名规则的 Mihomo 中转地址（`.../rules/magicrule/mihomo/<name>.yaml`，`classical` / `yaml`）；保留 `no-resolve` 和更新间隔。只有本部署已登记规则的 Surge 中转地址以 `RULE-SET` 引用时采用此映射。
- 本仓库 `surge/rule-sets/` 下的规则集由 Clash 直接读取。其他远程 `RULE-SET` / `DOMAIN-SET` 通过受 token 保护的 Worker 规则入口转换；保留支持的域名、IP、端口及进程规则。仅已部署模板中的来源可用。`LAN` 按 [Surge 当前公开列表](https://manual.nssurge.com/rules/ruleset.html#lan)展开 `.local`、本地及特殊用途 IPv4/IPv6 网段，仅在源规则指定时添加 `no-resolve`；内置列表随 Surge 版本变化时需重新核对。`SYSTEM` 仍省略。

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
| `url-test` 容差 | 省略时 100 毫秒 | 显式输出 100，保留显式 0；由 Smart 转换的组使用 50 |
| 代理测速 URL / 超时 | `proxy-test-url` / `test-timeout`；缺省 `http://bing.com/` / 5 秒 | 用于组级健康检查；超时转换为毫秒 |
| 多地址域名的 TCP 连接 | 同时向全部地址握手，后续优先使用最快的地址 | `tcp-concurrent: true`，每次连接同时尝试全部地址 |
| GeoIP 库更新 | 默认定期更新；`disable-geoip-db-auto-update = true` 时停止 | `geo-auto-update: true`、`geo-update-interval: 168`；关闭时省略 |
| ASN 库 | 内置于 App，随版本更新，无配置项 | `geox-url.asn` 指向 jsDelivr 上的 Loyalsoldier `GeoLite2-ASN.mmdb` |
| IPv6 / 系统 hosts | IPv6 默认关闭；系统 hosts 默认启用 | 保持对应默认值及显式设置 |

默认值依据 [VMess](https://manual.nssurge.com/policies/vmess.html)、[代理公共参数](https://manual.nssurge.com/policies/parameters.html)、[自动测速组](https://manual.nssurge.com/policy-groups/url-test.html)、[回退组](https://manual.nssurge.com/policy-groups/fallback.html)、[General](https://manual.nssurge.com/profile/general.html)和 [IP 规则](https://manual.nssurge.com/rules/ip.html)；目标字段参照 [Mihomo 通用配置](https://wiki.metacubex.one/config/general/)、[代理参数](https://wiki.metacubex.one/config/proxies/)及[代理组参数](https://wiki.metacubex.one/config/proxy-groups/)。

仍有以下行为不能等价转换，不能据此认为两个客户端的行为完全相同：

- Surge 组级 `timeout` 是测速结果的延迟筛选阈值，Mihomo 同名字段是健康检查请求的超时。转换只使用全局 `test-timeout`，省略延迟筛选并写入警告。节点级 `test-url` / `test-timeout` 覆盖也会警告；DIRECT 的独立测速参数及两端测速调度方式尚未对齐。当前 Surge 已不使用组级旧 `url`，转换遵循 `proxy-test-url`，旧值冲突时警告。
- QUIC 拦截映射依赖 ProjectClash 扩展，通用 Mihomo 或不支持该字段的旧客户端可能忽略它；输出会注明这一兼容性要求。`per-policy` 的自适应行为无法在 ProjectClash 复现，转换为 `all-proxy` 并写入警告，不会变成关闭拦截；只用 QUIC、不回退 TCP 的应用在新版 Surge 中可经代理使用，在 Clash 中仍被阻止。转换后的节点不带逐节点 `block-quic`（带未知参数的节点会被移除），因此按 Surge 默认值近似。两端对 QUIC 版本的识别范围仍由各自内核决定。
- Surge 的 `adaptive` 只属于[节点参数](https://manual.nssurge.com/policies/parameters.html)，不是合法的 [General 值](https://manual.nssurge.com/profile/general.html)。develop 当前的全局 `per-policy` 加节点默认 `auto`，在 Surge iOS 6.0.0+ / Mac 6.11.0+ 已对支持 UDP 的代理启用自适应；不支持 UDP 的代理仍阻止 QUIC，DIRECT 放行。无需给所有节点追加 `block-quic=adaptive`；当前 Clash 转换器会将带该未支持参数的节点移除。
- ProjectClash 的[配置解析器](https://github.com/ProjectClash/Clash/blob/main/config/clash_modules_parse.go)不接受 `x-clash-block-quic: adaptive`。若需要放行只用 QUIC 的应用，可在 Clash 客户端的最终配置中覆盖为 `x-clash-block-quic: always-allow`；这会关闭该扩展的 QUIC 拦截，不提供先阻止、再按 TCP 回退情况放行的自适应行为，且仍需节点与服务端支持 UDP。客户端覆盖应在订阅更新后继续生效；仓库默认仍为 `all-proxy`。
- 不支持 UDP 的节点按上文追加规则，对齐 Surge 的 `udp-policy-not-supported-behaviour`；转换只能依据节点声明的 UDP 能力，VMess / Trojan 默认开启也不保证服务端 UDP 实际可用。
- 健康检查调度不能等价：Surge Smart 固定每 5 分钟重测，Clash 未显式设置 `lazy`，按 Mihomo 默认 `true`，未选中的组不测试。Surge 原生 fallback / url-test 的 `interval` 是结果有效期，并非固定轮询时钟。Mihomo 的 `max-failed-times` 默认 5 是触发强制健康检查的失败阈值，不是“健康检查连续失败 5 次才换节点”，当前没有配置可保证单次测速失败后保持原 IP。
- MagicRule 使用各客户端各自的完整产物，规则名与引用顺序一致不代表条目逐条相同；其他远程规则中的不支持条目会被省略。客户端图标、隐藏属性和保存的手动选择也取决于客户端版本及本地状态。
- 规则匹配中本地解析失败时，Mihomo 跳过 IP 条件继续向下匹配，通常落到 `MATCH`；Surge 的 `FINAL,dns-failed` 直接改走 `FINAL`，因此解析失败后仍可能命中不同的域名规则。`SYSTEM`、`skip-proxy`、模块、脚本和 MitM 等仍按上述限制处理。

Mihomo 检测默认值见 [代理组公共参数](https://wiki.metacubex.one/en/config/proxy-groups/)。测速语义参见 [Surge 公共组参数](https://manual.nssurge.com/policy-groups/parameters.html)；QUIC 与 UDP 回退语义参见 [Surge General](https://manual.nssurge.com/profile/general.html)及 [Mihomo 规则优先级](https://wiki.metacubex.one/config/rules/#%E4%BC%98%E5%85%88%E7%BA%A7)。

Worker 规则入口只允许已部署模板 / 规则清单中的来源，不接受用户传入任意下载地址。规则最多 4 MiB（MagicRule 清单最多 256 KiB），整次获取限时 10 秒。不转发用户 Cookie、token 或 Access Header，不跟随上游跳转；上游公共内容可缓存一小时。重置 token 或停用用户会同时撤销两种订阅、模块和受 token 保护的 Worker 规则入口。MagicRule 中转入口只提供已登记的公开规则，不需要 token，也不读取用户数据；本仓库规则集由客户端直接从公开地址下载。

新增 MagicRule 规则集时，在 `surge/magicrule.json` 登记同名规则在官方索引中的 Surge 与 Mihomo `manifest.json` 地址，在主模板加入 `RULE-SET,{{RULESET_<name>}},<策略>,no-resolve,update-interval=21600`，并运行 `npm run check:magic-rules` 验证两种产物可用。无需维护第二套规则内容或提交上游规则快照。

新增无法转换的功能可以继续只服务 Surge；需要 Clash 支持时，再补转换映射与测试。格式参考 [Mihomo 规则](https://wiki.metacubex.one/en/config/rules/)、[规则提供器](https://wiki.metacubex.one/en/config/rule-providers/)、[DNS](https://wiki.metacubex.one/en/config/dns/)。
