# 分支与客户端兼容性核对

master 与 develop 维护同一套订阅实现和模板，环境差异由各自的部署配置表达。新功能先在 develop 验证，再整体合入 master。策略和规则基线见 [生产基线](production-baseline.md)。

## master 与 develop 的部署差异

| 项目 | master / 正式订阅 | develop / Dev 订阅 |
| --- | --- | --- |
| 订阅与数据 | `/AtlasRouter`，正式 D1 token | `/AtlasRouter-Dev`，独立测试 D1 token |
| 地区组主备 | Surge / Clash 的 ISP、WARP、IDC 组均为同顺序 fallback，interval=300 | 同左 |
| 策略组显示 | 业务组和 ISP 地区组可见，WARP / IDC 地区组和 DoH Proxy 隐藏 | `SHOW_ALL_PROXY_GROUPS=true`，所有组可见 |
| 仓库规则资源 | `REPOSITORY_RULES_REF=master`，生成 jsDelivr `@master` | `REPOSITORY_RULES_REF=develop`，生成 jsDelivr `@develop` |
| MagicRule | 40 类、80 份客户端产物；启用定时检查 | 同一规则基线，不运行 Cron |
| 发布 | Cloudflare master 构建，`npm run deploy` | Cloudflare develop 构建，`npm run deploy:development` |

两分支使用相同的 FINAL、Speedtest、OverseasFinance、ISP First、GeneralSite、Apple/AI/影音规则和客户端适配。节点来自各自节点池，实际出口由各客户端的健康检查结果和个人主备顺序共同决定。

## Surge 与 Clash：已对齐和无法等价的行为

配置来源为 [主模板](../surge/template.conf)、[动态策略组](../surge/pool-groups.conf)、[自定义规则](../surge/rules.list)和[仓库规则集](../surge/rule-sets/)。运行时会用动态策略组替换主模板的整个 `[Proxy Group]`；审查静态模板里的旧占位组不能代表实际订阅。

| 项目 | 当前结果 | 边界 |
| --- | --- | --- |
| 规则、业务组顺序 | 两分支依次为 CustomReject、RedPocket、Speedtest、CustomDirect、IBKR / LongBridge、MagicRule Direct、WeChat、AI（含 Cloudflare、AppleIntelligence）、Apple、Telegram / X / Discord / YouTube、OverseasFinance、ISP First（Facebook / Threads / Reddit / Line）、影音独立规则、GeneralSite（Alphabet / GitHub / Wikimedia）、国内直连名单；AppleIntelligence → AppleTV → iCloud → AppleProxy → Apple 按此顺序匹配，AppleProxy 使用 `ISP First`；YouTube 在 Netflix 等影音规则前；Proxy 的 Auto 在 IDC 后；保留最终兜底 | `select` 是手动选择，组之间不按健康状态自动回退；已有选择取决于客户端本地状态 |
| 节点主备 | Surge / Clash 均为同顺序 fallback，interval=300 | 各客户端的测速时机和结果可能不同，实际选择由客户端决定 |
| Auto | 两端均为 url-test，interval=300、容差 50 ms | Surge 包含本订阅的全部代理节点，Clash 会过滤不兼容的节点 |
| DoH Proxy | 正式按模板隐藏，开发两端均可见，仅含 IDC 节点；Surge Smart，Clash url-test；Cloudflare / Google 使用该组，阿里 / 腾讯直连 | 无 IDC 或 Clash 过滤后无兼容 IDC 时省略该组，国外 DoH 规则改为 REJECT，其他订阅内容保留 |
| UDP | VMess / Trojan 显式输出 `udp: true`；SS / SOCKS5 需显式开启 | VMess / Trojan 的显式 `udp-relay=false` 在转换器中保留为关闭；Surge 官方将此开关列为其他协议的可选能力，不能依赖它在这两类 Surge 节点上关闭 UDP。服务器可用性另需实测 |
| UDP 不受支持时 | 规则的策略可能选中不支持 UDP 的节点时，Clash 在其后追加只匹配 UDP 的同条件 REJECT 规则（`MATCH` 后为 `NETWORK,UDP,REJECT`），对应 Surge `udp-policy-not-supported-behaviour` 的默认 REJECT；全部节点支持 UDP 时不追加 | 只依据节点声明的 UDP 能力，服务端 UDP 是否实际可用需实测；Surge 显式设为 DIRECT 时 Clash 同样改用 DIRECT |
| QUIC | Surge `per-policy`→ `x-clash-block-quic: all-proxy` | 仅支持该扩展的 ProjectClash 可按最终代理出口拦截；普通 Mihomo 可能忽略。DIRECT 的 QUIC 放行，不等于拦截所有 UDP/443；ProjectClash 没有自适应模式，只用 QUIC、不回退 TCP 的应用在 Clash 中仍被阻止 |
| 节点传输默认值 | VMess AES-128-GCM；TLS/WS 默认关闭；TLS 校验开启；TFO 默认关闭；保留显式值 | VMess 仅转换显式 AEAD；不支持的协议、连接选项或 `sni=off` 会删去节点，并清理空组/失效规则；所有节点不可转换时返回 422 |
| 测速参数 | Surge 直连使用 `http://bing.com/`，代理使用 `http://cp.cloudflare.com/generate_204`，超时 10 秒。Clash 代理组使用相同代理地址与 10 秒超时。地区组与 Auto 显式设置 interval=300，Auto 容差为 50 ms。省略参数时按 Surge 的 600 秒间隔、100 ms 容差转换。Smart 转换的 url-test 使用 300 秒间隔、50 ms 容差。`/generate_204` 测试地址要求 HTTP 204，`unified-delay` 开启，测速不计握手耗时 | Surge 组级 timeout 是结果延迟筛选，转换采用全局 test-timeout。Clash 界面的 DIRECT 单节点测速地址与超时由客户端请求传入 |
| Wi-Fi Assist | 默认关闭，Surge iOS 使用 wifi-assist。Clash 开启时输出 network-strategy=fallback、fallback-network-type=[cellular] | Clash 侧要求支持网络策略扩展的 ProjectClash，优先系统默认接口。TCP 建连慢或失败时尝试蜂窝，UDP 依次尝试接口，调度由客户端实现 |
| 多地址连接 | Clash 输出 `tcp-concurrent: true`，对应 Surge 对多条 A / AAAA 记录同时握手；直连和节点服务器域名都适用 | Surge 记住最快的地址，后续连接优先使用；Mihomo 每次连接都重新同时尝试全部地址 |
| 调度与失败次数 | 地区组与 Auto 配置 interval=300，DoH Proxy 的 Smart 转换后间隔为 300 秒 | Surge fallback/url-test 将 interval 作为测速结果有效期，Smart 固定五分钟重测。Clash 使用 Mihomo 默认的 lazy=true，按组的使用状态调度测试，max-failed-times 默认 5，用于触发强制健康检查 |
| DNS | 普通 DNS、默认 DoH 和国内 DoH 名单（CustomDirect、WeChat、MagicRule IBKR / Direct / iCloud / Apple / China）、上游及节点引导 DNS、系统 hosts、IPv6 关闭已映射；Clash TUN 劫持全部 53 端口 DNS，对应 Surge 接管系统 DNS；Clash 使用 fake-ip 并持久保存映射，对应 Surge 增强模式；HTTPS / SVCB 不返回 IP 提示，`use-application-dns.net` 返回 NXDOMAIN | 应用不等待 DoH；IP 规则只在不带 no-resolve 时才解析，解析失败后 Mihomo 继续匹配，Surge 的 dns-failed 直接走 FINAL。Windows 联网检测域名保留真实地址。域名集 DNS 复用规则提供器；TUN 是否开启由客户端控制。DoH 按已知上游域名分流，Clash 通过 `#RULES` 使用这些规则；阿里和腾讯 DoH 域名固定使用普通 DNS 解析。Surge 的非 IDC 节点域名由 DNS 脚本解析，Clash 订阅不生成该脚本，节点域名仍使用普通 `proxy-server-nameserver` |
| GEO 数据 | Surge 的 GeoIP 自动更新映射为每 168 小时更新；ASN 库和其余 GEO 文件均指向 jsDelivr | Surge 的 ASN 库随 App 更新，Mihomo 需另行下载；Mihomo 只更新实际使用的数据库，ProjectClash 每次同步完整下载全部 4 个文件（约 18 MB），任一失败时整组重试 |
| 规则内容 | 同名 MagicRule 列表（含 China）经 Worker 按 manifest 中转 Surge / Mihomo 完整产物，不带 token，保留引用顺序及 no-resolve；Surge 省略 update-interval，Clash 规则提供器显式设置 interval=86400，两端均每 24 小时检查一次。内容未变时凭 ETag 得到 304，不重新下载 | 上游两种产物不保证逐条相同；上游不可用或内容无效时返回最后有效副本，无副本时返回 502；仓库规则集（`surge/rule-sets/`）由客户端直接读取，不支持的类型（如 WeChat 的 USER-AGENT）由 Mihomo / ProjectClash 跳过并记录警告；其他远程列表经 Worker 过滤不支持类型。MagicRule 规则改名或下线时需更新登记 |
| 专用功能 | 可映射项保留；YAML 注释列出省略或近似项 | SYSTEM、FINAL 的 dns-failed、skip-proxy、脚本、模块、MitM 等不能等价转换。Tencent OA 例外仅在 Surge 订阅带 `tencent_oa=1` 时写入 `skip-proxy`，页面选择 Clash 时禁用该开关，`tencent_oa=1` 与 Clash 组合明确返回 400；图标/隐藏属性由面板支持决定 |

默认值与近似行为的依据：[Surge VMess](https://manual.nssurge.com/policies/vmess.html)、[UDP](https://manual.nssurge.com/policies/udp.html)、[Smart](https://manual.nssurge.com/policy-groups/smart.html)、[url-test](https://manual.nssurge.com/policy-groups/url-test.html)、[fallback](https://manual.nssurge.com/policy-groups/fallback.html)、[General](https://manual.nssurge.com/profile/general.html)、[IP 规则](https://manual.nssurge.com/rules/ip.html)、[Mihomo 通用配置](https://wiki.metacubex.one/en/config/general/)、[代理组](https://wiki.metacubex.one/en/config/proxy-groups/)、[DNS](https://wiki.metacubex.one/en/config/dns/)、[规则匹配](https://wiki.metacubex.one/config/rules/)及 [ProjectClash QUIC 实现](https://github.com/ProjectClash/Clash/blob/4b7d5f53cff448f01cd5012b5e3f7eddc7d43e33/tunnel/clash_block_quic.go)。详细映射和使用方式见 [订阅说明](subscription.md)。

## 验证范围

测试覆盖地区组 fallback、Auto url-test、旧格式 Smart 转换、默认参数、排序、过滤、警告脱敏、Dev 开关与两库隔离、URL 归属、401/404、正常订阅，以及 Cloudflare 发布前的两库迁移和本地发布拒绝。测试分别构建两种部署配置，并验证正式规则引用 `@master`、开发规则引用 `@develop` 及各自的规则来源登记。

正式与开发配置共用地区组与 Auto 的类型及参数，并分别执行转换测试。上游规则内容、真实 Surge / iOS Clash 故障切换、UDP/QUIC 抓包和客户端固定出口行为仍需设备侧验收。
