# 生产基线与发布边界

master 使用引入 Smart 节点权重之前的稳定订阅行为，并补齐生产页面的 Dev 入口。develop 独立保留 Smart 权重试验。

## 基线来源

原 master 的 `ac91a54` 是旧 KV 版本，不能作为当前线上 D1 服务的发布源码。develop 首次提交 `691483e` 将此前多项本地改动合并入库，其中已经包含 Smart 权重，所以 Git 中不存在可直接切换的独立“权重前”提交。

本次用权重改动前保留的源文件恢复地区组渲染和 Clash 转换，并与实际线上版本核对。核对时生产部署为 `7e038d21-13f9-4624-8ef6-3019c620ffa2`，Worker 版本为 `49808d4b-9303-4886-ac55-dcfb6683b50f`；该版本有顺序 fallback，无 `policy-priority`，也没有 Dev 按钮。开发侧其余代码基线为 `c82ee4a`。

本地用同一组合成节点、用户和独立 D1 分别运行原生产 bundle 与候选代码，比较默认 Surge、DoH、Tencent OA、两者组合、默认 Clash、Clash + DoH 六种输出，结果逐字一致；401/404 检查也通过。真实节点、用户 token、下载的生产 bundle 和私有备份不进入仓库。

## 保留的生产行为

- 地区/IP 类型组使用顺序 fallback，保留个人主备顺序、300 秒间隔和隐藏属性；Surge 与 Clash 均不生成地区组权重。
- Auto 仍是原有的全节点 Smart 组，Clash 近似为 url-test；“权重前”不等于删除所有 Smart 组。
- 保留 D1 多用户节点池、Clash 完整配置识别、UDP 默认值、ProjectClash QUIC 映射、DoH/Tencent OA 开关、Proxy/Auto 顺序及 AppleDirect 优先顺序。
- master 不读取 `SMART_PRIORITY_SCHEME`，生产遗留变量不会意外打开权重试验。

## 新增的生产入口

生产页面绑定 `DB` 与独立的 `DEV_DB`，通过 Dev 按钮切换测试数据，生成 `DEV_SUBSCRIPTION_ORIGIN` 下的 `/AtlasRouter-Dev` 订阅。生成的 URL 由 develop Preview 直接处理；生产不转发订阅请求。生产与开发的 token、节点和归属保持独立。

Dev 按钮是否出现取决于**生产版本**及其 bindings；仅发布 develop Preview 不会改变生产页面。master 的 Cloudflare 构建实际发布成功后，刷新生产页面即可看到入口。

## 自动发布

生产分支为 master，Preview 分支为 develop。Build command 为 `npm ci && npm test`，生产 Deploy command 为 `npm run deploy`，Preview command 为 `npm run deploy:preview`。

master 的发布脚本只接受 Cloudflare Workers Builds 的 master 构建上下文。它先迁移生产 D1 和生产 UI 使用的测试 D1，再生成新的管理路径 Secret 并发布；迁移失败不上传。GitHub Actions 只验证代码，本机只验证，不手工部署。

旧的生产 dry-run 设置需要在 Cloudflare Builds 中改为 `npm run deploy`，否则即使测试全绿也不会更新 UI。部署状态必须以 Cloudflare 的实际发布记录和线上验证为准，不能只看 Git push 成功。
