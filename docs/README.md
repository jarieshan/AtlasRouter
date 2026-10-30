# Docs

本目录用于沉淀 AtlasRouter 的长期文档，避免根目录 `README.md` 变成实现细节集合。

建议放在这里的内容：

- 架构设计：订阅生成流程、目录职责、数据流。
- 部署说明：Cloudflare Workers Builds、Git 分支隔离、Cloudflare Access、D1 配置和数据库迁移。
- 运维手册：订阅地址、鉴权方式、常见故障排查。
- 决策记录：规则组织、策略组命名、Worker 数据格式等需要长期保留的取舍。

当前文档：

- [生产基线](production-baseline.md)：权重实验前的稳定行为、Dev UI 回移与 Cloudflare 自动发布。

- [部署说明](deployment-cloudflare.md)：Cloudflare Builds、原生 Preview 接入与分支发布边界。
- [原生预览方案](native-previews.md)：生产 UI、开发域名、两库隔离与 URL 生成。
- [环境与存储](env.md)：运行时变量、Secrets、D1 表和本地排除文件。
- [订阅说明](subscription.md)：Surge / Clash 路由、选项、默认值与兼容范围。
- [兼容性核对](client-compatibility.md)：master / develop 基线、客户端差异及验证边界。
- [多用户与节点池](multi-user.md)：邮箱身份、主备分配、共享容量和均衡回退。
- [安全验证](security-pentest.md)：本地测试和线上人工验收。

不建议放在这里的内容：

- 真实节点、Token、上游订阅链接或其他密钥。
- 分散的小规则文件；当前零散自定义规则维护在 `surge/rules.list`。
- Worker 运行时代码。
- `references/` 中未经核实的样例结论。
