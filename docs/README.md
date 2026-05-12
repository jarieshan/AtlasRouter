# Docs

本目录用于沉淀 AtlasRouter 的长期文档，避免根目录 `README.md` 变成实现细节集合。

建议放在这里的内容：

- 架构设计：订阅生成流程、目录职责、数据流。
- 部署说明：Cloudflare Workers、GitHub Actions、环境变量和 Secrets 配置。
- 运维手册：订阅地址、鉴权方式、常见故障排查。
- 决策记录：规则组织、策略组命名、Worker 数据格式等需要长期保留的取舍。

当前文档：

- `deployment-cloudflare.md`：Cloudflare Worker 部署流程。
- `env.md`：Worker 运行时环境变量和节点数据格式。
- `subscription.md`：Surge 订阅地址和路由说明。

不建议放在这里的内容：

- 真实节点、Token、上游订阅链接或其他密钥。
- 可直接被 Surge 加载的大量规则文件；少量自维护规则应优先内联在 `surge/template.conf`。
- Worker 运行时代码。
- `references/` 中未经核实的样例结论。
