# 分支与客户端兼容性核对

master 使用 Smart 节点权重之前的稳定订阅实现；Dev 开关选择独立测试节点与 develop 配置，由私有开发 Worker 执行。基线见 [生产基线](production-baseline.md)。原生公开预览保持关闭。

## master 与 develop 的源码差异

| 项目 | master / 正式订阅 | develop / Dev 订阅 |
| --- | --- | --- |
| 地区/IP 类型组 | Surge 和 Clash 都是顺序 fallback，300 秒 | Surge 为 Smart，系数 1、10、100、1000…；Clash 为同顺序 fallback |
| 策略组显示 | 按模板设置，地区组与 AppleProxy / AppleDirect 隐藏 | `SHOW_ALL_PROXY_GROUPS=true`，所有策略组统一可见；已移除 AppleProxy 和 AppleDirect |
| Apple | iCloud → AppleDirect → AppleProxy，几乎全部直连，含 Apple TV+ | AppleTV → `GlobalMedia`、AppleIntelligence → `AIProxy` 先匹配；iCloud 可切换，默认直连；其余 Apple 服务直接 `DIRECT`（`[Host]` 指定国内 DNS） |
| GlobalMedia 默认出口 | ISP → WARP → IDC，默认首个 ISP 组 | WARP → IDC → ISP，默认首个 WARP 组；仅接收 AppleTV、Netflix、Disney、Spotify、TIDAL、TikTok 6 份独立规则，已移除 GlobalMedia 聚合列表 |
| 加密货币交易所与海外支付 | Binance 固定直连；OKX、Coinbase、Bybit、Bitget 无专门规则 | 五家交易所及 PayPal、eBay、Stripe、Wise 均进入 `OverseasFinance`，ISP → WARP → IDC → DIRECT，默认首个 ISP 组；`stripe.com` 先由 OpenAI 列表送入 `AIProxy` |
| 券商 | `longbridge.global`、`ibkr.com` 固定直连 | MagicRule IBKR → `DIRECT`（`[Host]` 指定国内 DNS），LongBridge → `Proxy`，均紧随 CustomDirect |
| AI 规则 | OpenAI、Bing、Copilot、Anthropic、Gemini → `AIProxy`（Copilot 列表含 Cursor、Grok、Meta AI 等）；Cloudflare → `Proxy` | Cloudflare、OpenAI、Anthropic、Gemini、Grok、Cursor、Perplexity、本仓库 CustomAI（Meta AI、Muse、Grok Bot、Cloudflare Mirrors）和 AppleIntelligence → `AIProxy`，紧随 WeChat；不引用 Bing、Copilot |
| Auto | Surge Smart；Clash url-test，容差 0 | Surge Smart；Clash url-test，容差 50 ms |
| UI | 默认管理正式数据 | 同一页面通过 Dev 开关管理独立测试数据 |
| 订阅 | `/AtlasRouter`，正式 D1 token | `/AtlasRouter-Dev`，独立测试 D1 token |
| 权重变量 | 不读取，遗留变量不改变生产行为 | `SMART_PRIORITY_SCHEME=geometric-10`；ISP 组的备用节点从 100 起：1、100、1000、10000…，WARP、IDC 组为 1、10、100… |
| Surge QUIC | `block-quic = all-proxy`，代理一律阻止 QUIC | 全局 `block-quic = per-policy`，节点默认 `auto`：Surge iOS 6.0.0+ / Mac 6.11.0+ 对支持 UDP 的代理使用 `adaptive`，不支持 UDP 的代理阻止，DIRECT 放行；`adaptive` 不能写在 `[General]` |
| Clash 测速与 GEO 数据 | 健康检查接受任意状态码；未设置 `unified-delay`；不自动更新 GEO 数据；ASN 库使用 Mihomo 默认的 GitHub 地址 | `/generate_204` 测试地址要求 HTTP 204；`unified-delay: true`；GEO 数据每 168 小时更新，全部 GEO 文件从 jsDelivr 下载 |
| Clash 多地址连接 | 未设置 `tcp-concurrent`，逐个尝试各地址，共用 5 秒期限 | `tcp-concurrent: true`，同时尝试全部地址 |
| 发布 | Cloudflare master 构建，`npm run deploy` | 私有开发 Worker，`npm run deploy:development` |

两分支保留相同的 Proxy / Auto 选项顺序，以及可映射的 UDP 参数；Apple 规则顺序见上表；Clash 两端都输出 `x-clash-block-quic: all-proxy`，Surge 的 QUIC 策略见上表。develop 的 DoH 分流使用 IDC 专用组，国内上游直连，详见下表。主备分配逻辑一致，正式与测试数据库独立。Smart 的选择语义并不等于 fallback；不能要求两分支始终使用同一出口。

master 源码不因设置旧实验变量而生成节点权重。真正的开发权重来自 develop 分支代码，不能只靠设置 master 的环境变量打开它。

## Surge 与 Clash：已对齐和无法等价的行为

配置来源为 [主模板](../surge/template.conf)、[动态策略组](../surge/pool-groups.conf)、[自定义规则](../surge/rules.list)和[仓库规则集](../surge/rule-sets/)。运行时会用动态策略组替换主模板的整个 `[Proxy Group]`；审查静态模板里的旧占位组不能代表实际订阅。

| 项目 | 当前结果 | 边界 |
| --- | --- | --- |
| 规则、业务组顺序 | develop 依次为 CustomReject、CustomDirect、IBKR / LongBridge、MagicRule Direct、WeChat、AI（含 Cloudflare、AppleIntelligence）、Apple、Telegram / X / Discord / YouTube、OverseasFinance、ISP First（Facebook / Threads / Reddit / Line）、影音独立规则、Alphabet / GitHub / Wikimedia（`Auto`）、国内直连名单；AppleTV、AppleIntelligence、iCloud 在 Apple 完整规则前；YouTube 在 Netflix 等影音规则前；Proxy 的 Auto 在 IDC 后；保留最终兜底 | `select` 是手动选择，组之间不按健康状态自动回退；已有选择取决于客户端本地状态 |
| 节点主备 | master 两端均为同顺序 fallback、300 秒间隔 | 各客户端的测速时机和结果可能不同，不保证同一时刻选中同一节点；develop 单独试验 Smart 权重 |
| Auto | 两端都包含本订阅的可转换代理节点 | Surge 是 Smart；Clash 是 300 秒、容差 50 ms 的 url-test。不能复现真实连接评分、站点记忆或重试顺序 |
| DoH Proxy（develop） | 两端均可见，仅含 IDC 节点；Surge Smart，Clash url-test；Cloudflare / Google 使用该组，阿里 / 腾讯直连 | 无 IDC 或 Clash 过滤后无兼容 IDC 时省略该组，国外 DoH 规则改为 REJECT，其他订阅内容保留 |
| UDP | VMess / Trojan 显式输出 `udp: true`；SS / SOCKS5 需显式开启 | VMess / Trojan 的显式 `udp-relay=false` 在转换器中保留为关闭；Surge 官方将此开关列为其他协议的可选能力，不能依赖它在这两类 Surge 节点上关闭 UDP。服务器可用性另需实测 |
| UDP 不受支持时 | 规则的策略可能选中不支持 UDP 的节点时，Clash 在其后追加只匹配 UDP 的同条件 REJECT 规则（`MATCH` 后为 `NETWORK,UDP,REJECT`），对应 Surge `udp-policy-not-supported-behaviour` 的默认 REJECT；全部节点支持 UDP 时不追加 | 只依据节点声明的 UDP 能力，服务端 UDP 是否实际可用需实测；Surge 显式设为 DIRECT 时 Clash 同样改用 DIRECT |
| QUIC | Surge `all-proxy`（master）或 `per-policy`（develop）→ `x-clash-block-quic: all-proxy` | 仅支持该扩展的 ProjectClash 可按最终代理出口拦截；普通 Mihomo 可能忽略。DIRECT 的 QUIC 放行，不等于拦截所有 UDP/443；ProjectClash 没有自适应模式，只用 QUIC、不回退 TCP 的应用在 Clash 中仍被阻止 |
| 节点传输默认值 | VMess AES-128-GCM；TLS/WS 默认关闭；TLS 校验开启；TFO 默认关闭；保留显式值 | VMess 仅转换显式 AEAD；不支持的协议、连接选项或 `sni=off` 会删去节点，并清理空组/失效规则；所有节点不可转换时返回 422 |
| 测速参数 | 全局测试 URL 与 5 秒超时映射；fallback/url-test 省略间隔时 600 秒；url-test 默认容差 100 ms，Smart 转换的组为 50 ms；`/generate_204` 测试地址要求 HTTP 204；`unified-delay` 开启，测速不计握手耗时 | Surge 组级 timeout 是结果延迟筛选，不能映射为 Mihomo 请求超时；节点测速覆盖、DIRECT 独立测速不等价 |
| 多地址连接 | Clash 输出 `tcp-concurrent: true`，对应 Surge 对多条 A / AAAA 记录同时握手；直连和节点服务器域名都适用 | Surge 记住最快的地址，后续连接优先使用；Mihomo 每次连接都重新同时尝试全部地址 |
| 调度与失败次数 | Smart 转换后的组输出间隔 300 秒 | Surge Smart 固定五分钟重测；Clash 保留 Mihomo 的 lazy 默认 true，未选中组不测。max-failed-times 默认 5 触发强制健康检查，不表示容忍五次测速失败后才切换；当前无固定失败次数/固定 IP 保证 |
| DNS | 普通 DNS、默认与直连名单（CustomDirect、MagicRule IBKR / Direct / Apple / China）的 DoH、上游及节点引导 DNS、系统 hosts、IPv6 关闭已映射；Clash TUN 劫持全部 53 端口 DNS，对应 Surge 接管系统 DNS；Clash 使用 fake-ip 并持久保存映射，对应 Surge 增强模式；HTTPS / SVCB 不返回 IP 提示，`use-application-dns.net` 返回 NXDOMAIN | 应用不等待 DoH；IP 规则只在不带 no-resolve 时才解析，解析失败后 Mihomo 继续匹配，Surge 的 dns-failed 直接走 FINAL。Windows 联网检测域名保留真实地址。域名集 DNS 复用规则提供器；TUN 是否开启由客户端控制。DoH 按已知上游域名分流，Clash 通过 `#RULES` 使用这些规则；阿里和腾讯 DoH 域名固定使用普通 DNS 解析 |
| GEO 数据 | Surge 的 GeoIP 自动更新映射为每 168 小时更新；ASN 库和其余 GEO 文件均指向 jsDelivr | Surge 的 ASN 库随 App 更新，Mihomo 需另行下载；Mihomo 只更新实际使用的数据库，ProjectClash 每次同步完整下载全部 4 个文件（约 18 MB），任一失败时整组重试 |
| 规则内容 | 同名 MagicRule 列表（含 China）经 Worker 按 manifest 中转 Surge / Mihomo 完整产物，不带 token，保留引用顺序及 no-resolve；客户端每 6 小时检查一次，内容未变时凭 ETag 得到 304，不重新下载 | 上游两种产物不保证逐条相同；上游不可用或内容无效时返回最后有效副本，无副本时返回 502；仓库规则集（`surge/rule-sets/`）由客户端直接读取，不支持的类型（如 WeChat 的 USER-AGENT）由 Mihomo / ProjectClash 跳过并记录警告；其他远程列表经 Worker 过滤不支持类型。MagicRule 规则改名或下线时需更新登记 |
| 专用功能 | 可映射项保留；YAML 注释列出省略或近似项 | SYSTEM、FINAL 的 dns-failed、skip-proxy、脚本、模块、MitM 等不能等价转换。Tencent OA 为 Surge Mac 模块，旧链接的 `tencent_oa=1` 与 Clash 组合明确返回 400；图标/隐藏属性由面板支持决定 |

默认值与近似行为的依据：[Surge VMess](https://manual.nssurge.com/policies/vmess.html)、[UDP](https://manual.nssurge.com/policies/udp.html)、[Smart](https://manual.nssurge.com/policy-groups/smart.html)、[url-test](https://manual.nssurge.com/policy-groups/url-test.html)、[fallback](https://manual.nssurge.com/policy-groups/fallback.html)、[General](https://manual.nssurge.com/profile/general.html)、[IP 规则](https://manual.nssurge.com/rules/ip.html)、[Mihomo 通用配置](https://wiki.metacubex.one/en/config/general/)、[代理组](https://wiki.metacubex.one/en/config/proxy-groups/)、[DNS](https://wiki.metacubex.one/en/config/dns/)、[规则匹配](https://wiki.metacubex.one/config/rules/)及 [ProjectClash QUIC 实现](https://github.com/ProjectClash/Clash/blob/4b7d5f53cff448f01cd5012b5e3f7eddc7d43e33/tunnel/clash_block_quic.go)。详细映射和使用方式见 [订阅说明](subscription.md)。

## 验证范围

master 的测试覆盖权重前的 fallback、默认参数、排序、过滤、警告脱敏、Dev 开关与两库隔离、URL 归属、401/404、正常订阅，以及 Cloudflare 发布前的两库迁移和本地发布拒绝。另用合成数据比较原线上代码与候选版本的六种订阅输出。

develop 保留自身的 Smart 系数和转换测试。上游规则内容、真实 Surge / iOS Clash 故障切换、UDP/QUIC 抓包和客户端固定出口行为仍需设备侧验收，不将本地代码测试视为这些项目已通过。
