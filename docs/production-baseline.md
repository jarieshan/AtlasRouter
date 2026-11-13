# 生产基线与发布边界

2026-11-12，master 合入 develop 的 `48c4916`，正式订阅采用已验证的策略、规则和客户端转换实现。Dev 开关继续调用私有开发服务，使用独立测试库和 develop 配置；原生公开预览保持关闭。

## 旧生产基线来源（历史记录）

原 master 的 `ac91a54` 是旧 KV 版本，不能作为当前线上 D1 服务的发布源码。develop 首次提交 `691483e` 将此前多项本地改动合并入库，其中已经包含 Smart 权重，所以 Git 中不存在可直接切换的独立“权重前”提交。

本次用权重改动前保留的源文件恢复地区组渲染和 Clash 转换，并与实际线上版本核对。核对时生产部署为 `7e038d21-13f9-4624-8ef6-3019c620ffa2`，Worker 版本为 `49808d4b-9303-4886-ac55-dcfb6683b50f`；该版本有顺序 fallback，无 `policy-priority`，也没有 Dev 按钮。开发侧其余代码基线为 `c82ee4a`。

本地用同一组合成节点、用户和独立 D1 分别运行原生产 bundle 与候选代码，比较默认 Surge、DoH、Tencent OA、两者组合、默认 Clash、Clash + DoH 六种输出，结果逐字一致；401/404 检查也通过。真实节点、用户 token、下载的生产 bundle 和私有备份不进入仓库。 该逐字比较针对恢复提交 `f957447`。随后为修复开启 Surge 后无法访问订阅入口的问题，两分支补充了生产与开发订阅域名的精确 `DIRECT` 规则；这两条入口规则是相对于原生产输出的有意差异，全局 QUIC 策略与节点分组方式保持不变。

## 当前生产行为

- 地区/IP 类型组在 Surge 中使用 Smart 和 `policy-priority`，保留个人主备次序；Clash 按相同次序转换为 300 秒的 fallback。正式与开发服务均配置 `SMART_PRIORITY_SCHEME=geometric-10-from-100`，ISP、WARP、IDC 组的权重都是 1、100、1000…；每组最多 15 个节点，超过后订阅生成失败。
- Auto 为全节点 Smart，排除 Tailnet；Clash 近似为容差 50 ms 的 url-test。FINAL 为可见的 select：Auto → Proxy → IDC → WARP → ISP → DIRECT。Speedtest 使用 MagicRule，select 顺序为 IDC → WARP → ISP → DIRECT。
- 合入 OverseasFinance、ISP First、RedPocket、Apple/AI/影音独立规则、IDC 专用 DoH 组及 Clash DNS、测速和多地址连接适配。地区与业务组可见；正式部署按模板隐藏 DoH Proxy，开发服务的 `SHOW_ALL_PROXY_GROUPS=true` 显示全部组。
- 正式仓库规则集固定引用 `@master`，开发服务保留 `@develop`；MagicRule 的 39 类规则使用各客户端原生产物及最后有效副本。正式 Cron 每 5 分钟检查一份，共 78 份约 6 小时 30 分钟一轮。
- 使用各自节点池保存的公网节点，Tailnet 用于私网管理。保留两库、个人 token、节点分配和 Access/Tunnel 配置；本次只发布正式 Worker。

## 正式入口

正式页面默认管理生产 `DB`，Dev 开关原地加载独立 `DEV_DB`。正式与开发订阅分别使用 `/AtlasRouter` 和 `/AtlasRouter-Dev`，开发订阅由私有开发 Worker 处理；旧独立测试域名不恢复。

正式页面继续通过 Service binding 转发开发订阅。香港和洛杉矶的 Access + Tunnel 配置保持独立，不参与本次分支合并。

## 自动发布

生产分支为 master，Build command 为 `npm ci && npm test`，Deploy command 为 `npm run deploy`；Preview Builds 关闭，不再配置预览发布命令。

生产发布脚本校验 Cloudflare Builds 的 master 上下文，迁移两库，再轮换管理路径 Secret 并发布正式页面。开发服务使用独立配置，只迁移测试库。GitHub Actions 只验证代码；部署结果需以云端记录和线上请求核验。
