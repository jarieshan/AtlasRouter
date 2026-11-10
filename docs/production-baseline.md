# 生产基线与发布边界

master 使用引入 Smart 节点权重之前的稳定订阅行为。Dev 开关调用私有开发服务，使用独立测试库和 develop 版配置；原生公开预览保持关闭。

## 基线来源

原 master 的 `ac91a54` 是旧 KV 版本，不能作为当前线上 D1 服务的发布源码。develop 首次提交 `691483e` 将此前多项本地改动合并入库，其中已经包含 Smart 权重，所以 Git 中不存在可直接切换的独立“权重前”提交。

本次用权重改动前保留的源文件恢复地区组渲染和 Clash 转换，并与实际线上版本核对。核对时生产部署为 `7e038d21-13f9-4624-8ef6-3019c620ffa2`，Worker 版本为 `49808d4b-9303-4886-ac55-dcfb6683b50f`；该版本有顺序 fallback，无 `policy-priority`，也没有 Dev 按钮。开发侧其余代码基线为 `c82ee4a`。

本地用同一组合成节点、用户和独立 D1 分别运行原生产 bundle 与候选代码，比较默认 Surge、DoH、Tencent OA、两者组合、默认 Clash、Clash + DoH 六种输出，结果逐字一致；401/404 检查也通过。真实节点、用户 token、下载的生产 bundle 和私有备份不进入仓库。 该逐字比较针对恢复提交 `f957447`。随后为修复开启 Surge 后无法访问订阅入口的问题，两分支补充了生产与开发订阅域名的精确 `DIRECT` 规则；这两条入口规则是相对于原生产输出的有意差异，全局 QUIC 策略与节点分组方式保持不变。

## 保留的生产行为

- 地区/IP 类型组使用顺序 fallback，保留个人主备顺序、300 秒间隔和隐藏属性；Surge 与 Clash 均不生成地区组权重。
- Auto 仍是原有的全节点 Smart 组，Clash 近似为 url-test；“权重前”不等于删除所有 Smart 组。
- 保留 D1 多用户节点池、Clash 完整配置识别、UDP 默认值、ProjectClash QUIC 映射、DoH/Tencent OA 开关、Proxy/Auto 顺序及 AppleDirect 优先顺序。
- master 不读取 `SMART_PRIORITY_SCHEME`，生产遗留变量不会意外打开权重试验。

## 正式入口

正式页面默认管理生产 `DB`，Dev 开关开启时管理独立 `DEV_DB`。正式与开发订阅共用 `/AtlasRouter` 路径，开发链接携带 `dev=1` 并由私有开发 Worker 处理；旧独立测试域名不恢复。

本次清理保持既有生产分流行为，只从订阅中删除已退役测试域名的精确 `DIRECT` 规则。香港 Access + Tunnel 配置保持独立。

## 自动发布

生产分支为 master，Build command 为 `npm ci && npm test`，Deploy command 为 `npm run deploy`；Preview Builds 关闭，不再配置预览发布命令。

生产发布脚本校验 Cloudflare Builds 的 master 上下文，迁移两库，再轮换管理路径 Secret 并发布正式页面。开发服务使用独立配置，只迁移测试库。GitHub Actions 只验证代码；部署结果需以云端记录和线上请求核验。
