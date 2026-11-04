# 分支与客户端兼容性核对

master 已恢复 Smart 节点权重之前的稳定订阅实现，并补上 Dev 页面入口；develop 保留权重实验。基线来源及与原生产 bundle 的比较见 [生产基线](production-baseline.md)。旧 KV master 的审计结论仅适用于历史提交 `ac91a54`，不再代表当前 master。

## master 与 develop

| 项目 | master / 生产 | develop / 原生 Preview |
| --- | --- | --- |
| 地区/IP 类型组 | Surge 和 Clash 都是顺序 fallback，300 秒 | Surge 为 Smart，系数 1、10、100、1000…，ISP 组为 1、100、1000、10000…；Clash 为同顺序 fallback |
| 策略组显示 | 按模板设置，地区组与 AppleProxy / AppleDirect 隐藏 | `SHOW_ALL_PROXY_GROUPS=true`，所有策略组统一可见；已移除 AppleProxy |
| Apple | iCloud → AppleDirect → AppleProxy，几乎全部直连，含 Apple TV+ | AppleTV → `GlobalMedia`、AppleIntelligence → `AIProxy` 先匹配，其余经 iCloud / AppleDirect 直连 |
| GlobalMedia 默认出口 | ISP → WARP → IDC，默认首个 ISP 组 | WARP → IDC → ISP，默认首个 WARP 组 |
| 加密货币交易所 | Binance 固定直连；OKX、Coinbase、Bybit、Bitget 无专门规则 | 五家均进入 `Coin`，DIRECT → ISP → WARP → IDC，默认直连 |
| AI 规则 | OpenAI、Bing、Copilot、Anthropic、Gemini → `AIProxy`（Copilot 列表含 Cursor、Grok、Meta AI 等）；Cloudflare → `Proxy` | Cloudflare、OpenAI、Anthropic、Gemini、Grok、Cursor、本仓库 CustomAI（Meta AI、Muse、Grok Bot）和 AppleIntelligence → `AIProxy`，紧随 WeChat；不引用 Bing、Copilot |
| Auto | Surge Smart；Clash url-test | 同左 |
| UI | 开启，Dev 按钮可管理测试数据 | 关闭 |
| 订阅 | `/AtlasRouter`，生产 D1 token | `/AtlasRouter-Dev`，独立测试 D1 token |
| 权重变量 | 不读取，遗留变量不改变生产行为 | `SMART_PRIORITY_SCHEME=geometric-10` |
| Surge QUIC | `block-quic = all-proxy`，代理一律阻止 QUIC | `block-quic = per-policy`：DIRECT 放行，代理默认阻止；Surge iOS 6.0.0+ / Mac 6.11.0+ 对支持 UDP 的代理自适应 |
| 发布 | Cloudflare master 构建，`npm run deploy` | Cloudflare develop 构建，`npm run deploy:preview` |

两分支保留相同的 Proxy / Auto 选项顺序，以及可映射的 UDP 参数；Apple 规则顺序见上表；Clash 两端都输出 `x-clash-block-quic: all-proxy`，Surge 的 QUIC 策略见上表。develop 的 DoH 分流使用 IDC 专用组，国内上游直连，详见下表。主备分配逻辑一致，但数据库独立，实际节点和 token 不同。Smart 的选择语义并不等于 fallback；不能要求两分支始终使用同一出口。

master 同一份源码在生产/Preview 参数下均不生成节点权重。真正的开发权重来自 develop 分支代码，不能只靠设置 master 的环境变量打开它。

## Surge 与 Clash：已对齐和无法等价的行为

配置来源为 [主模板](../surge/template.conf)、[动态策略组](../surge/pool-groups.conf)、[自定义规则](../surge/rules.list)和[仓库规则集](../surge/rule-sets/)。运行时会用动态策略组替换主模板的整个 `[Proxy Group]`；审查静态模板里的旧占位组不能代表实际订阅。

| 项目 | 当前结果 | 边界 |
| --- | --- | --- |
| 规则、业务组顺序 | develop 依次为 CustomReject、CustomDirect、MagicRule Direct、WeChat、AI（含 Cloudflare、AppleIntelligence）、Apple、Telegram / X / Discord / YouTube、Coin、GlobalMedia；AppleTV、AppleIntelligence 在 iCloud / AppleDirect 前；YouTube 在 GlobalMedia 前；Proxy 的 Auto 在 IDC 后；保留最终兜底 | `select` 是手动选择，组之间不按健康状态自动回退；已有选择取决于客户端本地状态 |
| 节点主备 | master 两端均为同顺序 fallback、300 秒间隔 | 各客户端的测速时机和结果可能不同，不保证同一时刻选中同一节点；develop 单独试验 Smart 权重 |
| Auto | 两端都包含本订阅的可转换代理节点 | Surge 是 Smart；Clash 是 300 秒、容差 0 的 url-test。不能复现真实连接评分、站点记忆或重试顺序 |
| DoH Proxy（develop） | 两端均可见，仅含 IDC 节点；Surge Smart，Clash url-test；Cloudflare / Google 使用该组，阿里 / 腾讯直连 | 无 IDC 或 Clash 过滤后无兼容 IDC 时省略该组，国外 DoH 规则改为 REJECT，其他订阅内容保留 |
| UDP | VMess / Trojan 显式输出 `udp: true`；SS / SOCKS5 需显式开启 | VMess / Trojan 的显式 `udp-relay=false` 在转换器中保留为关闭；Surge 官方将此开关列为其他协议的可选能力，不能依赖它在这两类 Surge 节点上关闭 UDP。服务器可用性另需实测 |
| UDP 不受支持时 | 不伪造等价行为 | Mihomo 可能跳过指向不支持 UDP 节点的规则继续匹配；Surge 由 `udp-policy-not-supported-behaviour` 决定，当前文档默认 REJECT；存在最终走不同出口的可能 |
| QUIC | Surge `all-proxy`（master）或 `per-policy`（develop）→ `x-clash-block-quic: all-proxy` | 仅支持该扩展的 ProjectClash 可按最终代理出口拦截；普通 Mihomo 可能忽略。DIRECT 的 QUIC 放行，不等于拦截所有 UDP/443；ProjectClash 没有自适应模式，只用 QUIC、不回退 TCP 的应用在 Clash 中仍被阻止 |
| 节点传输默认值 | VMess AES-128-GCM；TLS/WS 默认关闭；TLS 校验开启；TFO 默认关闭；保留显式值 | VMess 仅转换显式 AEAD；不支持的协议、连接选项或 `sni=off` 会删去节点，并清理空组/失效规则；所有节点不可转换时返回 422 |
| 测速参数 | 全局测试 URL 与 5 秒超时映射；fallback/url-test 省略间隔时 600 秒；url-test 默认容差 100 ms | Surge 组级 timeout 是结果延迟筛选，不能映射为 Mihomo 请求超时；节点测速覆盖、DIRECT 独立测速不等价 |
| 调度与失败次数 | Smart 转换后的组输出间隔 300 秒 | Surge Smart 固定五分钟重测；Clash 保留 Mihomo 的 lazy 默认 true，未选中组不测。max-failed-times 默认 5 触发强制健康检查，不表示容忍五次测速失败后才切换；当前无固定失败次数/固定 IP 保证 |
| DNS | 普通 DNS、默认与直连名单（CustomDirect、MagicRule China）的 DoH、上游及节点引导 DNS、系统 hosts、IPv6 关闭、两项 DNS 劫持目标已映射 | Clash 使用 redir-host；域名集 DNS 复用规则提供器；TUN 是否开启由客户端控制。DoH 按已知上游域名分流，Clash 通过 `#RULES` 使用这些规则；阿里和腾讯 DoH 域名固定使用普通 DNS 解析 |
| 规则内容 | 同名 MagicRule 列表（含 China）由客户端直接下载 Surge / Mihomo 完整产物，不带 token，保留引用顺序及 no-resolve；文件未变时凭 ETag 得到 304，不重新下载 | 上游两种产物不保证逐条相同；仓库规则集（`surge/rule-sets/`）由客户端直接读取，不支持的类型（如 WeChat 的 USER-AGENT）由 Mihomo / ProjectClash 跳过并记录警告；其他远程列表经 Worker 过滤不支持类型。MagicRule 更换或停用地址时需更新登记 |
| 专用功能 | 可映射项保留；YAML 注释列出省略或近似项 | SYSTEM、FINAL 的 dns-failed、skip-proxy、脚本、模块、MitM 等不能等价转换。Tencent OA 为 Surge Mac 模块，旧链接的 `tencent_oa=1` 与 Clash 组合明确返回 400；图标/隐藏属性由面板支持决定 |

默认值与近似行为的依据：[Surge VMess](https://manual.nssurge.com/policies/vmess.html)、[UDP](https://manual.nssurge.com/policies/udp.html)、[Smart](https://manual.nssurge.com/policy-groups/smart.html)、[url-test](https://manual.nssurge.com/policy-groups/url-test.html)、[fallback](https://manual.nssurge.com/policy-groups/fallback.html)、[General](https://manual.nssurge.com/profile/general.html)、[Mihomo 代理组](https://wiki.metacubex.one/en/config/proxy-groups/)、[DNS](https://wiki.metacubex.one/en/config/dns/)、[规则匹配](https://wiki.metacubex.one/config/rules/)及 [ProjectClash QUIC 实现](https://github.com/ProjectClash/Clash/blob/4b7d5f53cff448f01cd5012b5e3f7eddc7d43e33/tunnel/clash_block_quic.go)。详细映射和使用方式见 [订阅说明](subscription.md)。

## 验证范围

master 的测试覆盖权重前的 fallback、默认参数、排序、过滤、警告脱敏、Dev 按钮、两库隔离、URL 归属、401/404、正常订阅，以及 Cloudflare 发布前的两库迁移和本地发布拒绝。另用合成数据比较原线上代码与候选版本的六种订阅输出。

develop 保留自身的 Smart 系数和转换测试。上游规则内容、真实 Surge / iOS Clash 故障切换、UDP/QUIC 抓包和客户端固定出口行为仍需设备侧验收，不将本地代码测试视为这些项目已通过。
