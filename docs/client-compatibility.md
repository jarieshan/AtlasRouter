# 分支与客户端兼容性核对

核对日期：2026-10-31。Git 基线为 `master` 的 [`ac91a54`](https://github.com/jarieshan/AtlasRouter/commit/ac91a547fe3f0dd8afac1573194c477e27278fe0) 与 `develop` 的 [`29ecf40`](https://github.com/jarieshan/AtlasRouter/commit/29ecf40353fd332f2fc8195ac9b5e5395c492af6)，以及本次随文档提交的验证和部署入口整理。开发分支实际名称是 `develop`，不是 `dev`。

结论：**两个 Git 分支的功能尚不一致；当前 develop 的生产/预览参数可以对照验证；Surge 与 Clash 只在已映射的行为上对齐。** 本次没有更新 master，也没有恢复生产发布。Git 分支名不能证明线上正在运行哪份代码，线上版本及 Dashboard 变量需另行核对。

## master 与 develop 的实际差异

以下对照来自各分支的实现，不使用 `references/` 样例作为依据。

| 功能 | master 基线 | develop 当前实现 | 状态 |
| --- | --- | --- | --- |
| 数据与身份 | `ATLAS_ROUTER` KV、手动 profiles 与 token | Access 登录、D1 用户/节点/分配表、个人 token | 架构不同，不能直接互换绑定或数据 |
| Clash | 无转换器；带 `client=clash` 仍返回 Surge 文本 | 完整 Surge 配置转换为 Clash / Mihomo YAML | master 缺功能，不能称为两端对齐 |
| 地区策略 | 固定三个旧地区组，Smart 无顺序权重 | 动态地区/IP 类型组，个人主备顺序赋权 | 节点选择行为不同 |
| Proxy 与 Auto | 带 emoji 的旧策略名；US、JP、US ISP；Auto 为 url-test，还有 Select | ISP → WARP → IDC → Auto → DIRECT；Auto 为 Smart | 名称与默认选项不同，旧的手动选择可能失效 |
| Apple / 通信 / 视频 | 单个 Apple 组默认 DIRECT；部分服务共用 Proxy/GlobalMedia | 拆分 iCloud、AppleDirect、AppleProxy、WeChat、Telegram、X、YouTube | 分流策略有意变化 |
| 外部规则 | blackmatrix7 公共 Surge 列表，Claude 旧列表 | 主要使用 MagicRule 各客户端完整产物，Anthropic 替代 Claude；WeChat 保留原来源 | 来源及覆盖范围不同 |
| DoH 与 DNS 劫持 | 无 DoH URL 开关；劫持 Google 和 Cloudflare 四个 DNS 地址 | `doh=1`；Google 两个 DNS 地址；节点引导 DNS、Host 映射 | 参数及 DNS 行为不同 |
| QUIC | Surge `block-quic=all-proxy` | Surge 同值；Clash 映射 ProjectClash 扩展 | 仅 Surge 配置值一致；Clash 依赖客户端支持 |
| 系统代理例外 / MitM | 较宽的固定 skip-proxy；可保存、生成 MitM CA | 默认四项域名例外；Surge 可选 Tencent OA；MitM 固定关闭 | 不能按旧版使用方式推断 |
| 开发环境 | 无当前原生 Preview / Dev UI | 独立域名、路径、D1，生产页面管理测试数据 | 需在核对生产源码后再合入生产 |

恢复生产发布前，需要决定采用哪份经验证的 D1 源码基线，再将必要功能合入 master、检查数据迁移及运行时配置。不能只修改 Production branch 或将旧 master 直接部署到现有 D1 服务上。

## 当前源码：生产配置与 Preview 配置

本节比较同一份当前源码在 [wrangler.jsonc](../worker/wrangler.jsonc) 两套参数下的结果，**不是**用 develop 的生产参数模拟旧 master。

| 项目 | 生产配置 | develop Preview |
| --- | --- | --- |
| 页面 | 开启，Dev 按钮管理测试库 | 关闭，根页面 404 |
| 订阅路径 | `/AtlasRouter` | `/AtlasRouter-Dev` |
| 节点、用户、token | 正式 D1 | 独立测试 D1，不接受正式 token |
| Surge 地区组系数 | 缺省 linear：1、2、3… | geometric-3：1、3、9… |
| Clash 地区组 | 同个人主备顺序的 fallback | 同个人主备顺序的 fallback，无权重算法 |
| 其他输出 | 相同节点和选项下，规则、DNS、UDP、QUIC、策略顺序一致 | 仅地址、token、Surge 权重与左侧不同 |

生产的 `keep_vars=true` 会保留 Dashboard 配置，实际 `SMART_PRIORITY_SCHEME` 必须以运行时变量为准。真实两库的数据本就独立，因此不会保证下载文件逐字相同。更新地址、模块和规则集始终使用所属环境的域名与路径。

## Surge 与 Clash：已对齐和无法等价的行为

配置来源为 [主模板](../surge/template.conf)、[动态策略组](../surge/pool-groups.conf)和[自定义规则](../surge/rules.list)。运行时会用动态策略组替换主模板的整个 `[Proxy Group]`；审查静态模板里的旧占位组不能代表实际订阅。

| 项目 | 当前结果 | 边界 |
| --- | --- | --- |
| 规则、业务组顺序 | AppleDirect 在 AppleProxy 前；YouTube 在 Google/GlobalMedia 前；Proxy 的 Auto 在 IDC 后；保留最终兜底 | `select` 是手动选择，组之间不按健康状态自动回退；已有选择取决于客户端本地状态 |
| 节点主备 | 个人主备次序相同 | Surge Smart 按质量和权重评分，Clash fallback 按可用状态取前面的成员；不保证相同出口 |
| Auto | 两端都包含本订阅的可转换代理节点 | Surge 是 Smart；Clash 是 300 秒、容差 0 的 url-test。不能复现真实连接评分、站点记忆或重试顺序 |
| UDP | VMess / Trojan 显式输出 `udp: true`；SS / SOCKS5 需显式开启 | VMess / Trojan 的显式 `udp-relay=false` 在转换器中保留为关闭；Surge 官方将此开关列为其他协议的可选能力，不能依赖它在这两类 Surge 节点上关闭 UDP。服务器可用性另需实测 |
| UDP 不受支持时 | 不伪造等价行为 | Mihomo 可能跳过指向不支持 UDP 节点的规则继续匹配；Surge 由 `udp-policy-not-supported-behaviour` 决定，当前文档默认 REJECT；存在最终走不同出口的可能 |
| QUIC | Surge `all-proxy` → `x-clash-block-quic: all-proxy` | 仅支持该扩展的 ProjectClash 可按最终代理出口拦截；普通 Mihomo 可能忽略。DIRECT 的 QUIC 放行，不等于拦截所有 UDP/443；`per-policy` 无等价映射 |
| 节点传输默认值 | VMess AES-128-GCM；TLS/WS 默认关闭；TLS 校验开启；TFO 默认关闭；保留显式值 | VMess 仅转换显式 AEAD；不支持的协议、连接选项或 `sni=off` 会删去节点，并清理空组/失效规则；所有节点不可转换时返回 422 |
| 测速参数 | 全局测试 URL 与 5 秒超时映射；fallback/url-test 省略间隔时 600 秒；url-test 默认容差 100 ms | Surge 组级 timeout 是结果延迟筛选，不能映射为 Mihomo 请求超时；节点测速覆盖、DIRECT 独立测速不等价 |
| 调度与失败次数 | Smart 转换后的组输出间隔 300 秒 | Surge Smart 固定五分钟重测；Clash 保留 Mihomo 的 lazy 默认 true，未选中组不测。max-failed-times 默认 5 触发强制健康检查，不表示容忍五次测速失败后才切换；当前无固定失败次数/固定 IP 保证 |
| DNS | 普通 DNS、两组 DoH、节点引导 DNS、系统 hosts、IPv6 关闭、两项 DNS 劫持目标已映射 | Clash 使用 redir-host；TUN 是否开启由客户端控制。Surge `PROTOCOL,DOH` 省略，以已知上游域名规则和 `#RULES` 近似；不能泛化为所有应用 DoH 一致 |
| 规则内容 | 同名 MagicRule 列表分别获取 Surge / Mihomo 完整产物，保留引用顺序及 no-resolve | 上游两种产物不保证逐条相同；其他远程列表过滤不支持类型，如 WeChat 的 USER-AGENT。上游更新后仍可能出现覆盖差异 |
| 专用功能 | 可映射项保留；YAML 注释列出省略或近似项 | SYSTEM、FINAL 的 dns-failed、skip-proxy、脚本、模块、MitM 等不能等价转换。Tencent OA 与 Clash 组合明确返回 400；图标/隐藏属性由面板支持决定 |

默认值与近似行为的依据：[Surge VMess](https://manual.nssurge.com/policies/vmess.html)、[UDP](https://manual.nssurge.com/policies/udp.html)、[Smart](https://manual.nssurge.com/policy-groups/smart.html)、[url-test](https://manual.nssurge.com/policy-groups/url-test.html)、[fallback](https://manual.nssurge.com/policy-groups/fallback.html)、[General](https://manual.nssurge.com/profile/general.html)、[Mihomo 代理组](https://wiki.metacubex.one/en/config/proxy-groups/)、[DNS](https://wiki.metacubex.one/en/config/dns/)、[规则匹配](https://wiki.metacubex.one/config/rules/)及 [ProjectClash QUIC 实现](https://github.com/ProjectClash/Clash/blob/4b7d5f53cff448f01cd5012b5e3f7eddc7d43e33/tunnel/clash_block_quic.go)。详细映射和使用方式见 [订阅说明](subscription.md)。

## 验证范围

- master：从固定基线导出到临时目录，运行其 47 项测试；用合成节点验证正常订阅、401、404，并确认 `client=clash` 仍返回 Surge 文本。
- develop：`npm test` 通过 132 项单元测试和 23 项运行时测试，共 155 项；[转换测试](../worker/test/clash.test.js)覆盖默认参数、排序、权重、过滤、警告脱敏；新增对照覆盖 DoH 开/关、Surge 的 Tencent OA 开/关，以及原生生产/预览地址和参数。
- [运行时测试](../worker/test-runtime/subscription.test.js)覆盖独立 D1、跨环境 token 拒绝、开发页面关闭、正常订阅、鉴权失败、404，以及自动更新/规则/模块 URL。
- 发布入口：默认生产命令拒绝运行；Preview dry-run 只验证配置；单元测试验证开发库迁移先于 Preview 上传。

以上是代码、生成结果和本地 workerd 验证。未在真实 Surge/iOS Clash 设备上做故障注入、UDP/QUIC 抓包或长时间固定出口测试，也未逐条比较在线规则产物；不将这些未执行项标为通过。真实客户端版本、保存的选择、Dashboard 变量和上游列表变化都可能影响结果。
