# 原生 Worker Preview 下线记录

原生预览与独立测试域名保持停用。Dev 已恢复为正式页面自定义选项中的开关：关闭使用正式节点，开启使用独立测试节点与开发版配置。

- 关闭 Cloudflare Builds 的预览发布，删除已有 Preview 和专用测试域名、DNS 与 Access Bypass。
- 正式页面通过 `DEV_DB` 管理独立测试数据，通过 `DEV_SUBSCRIPTION_SERVICE` 调用私有开发 Worker；不使用 `DEV_SUBSCRIPTION_ORIGIN` 或 `previews`。
- Dev 使用与 DoH 一致的开关样式，在当前页面加载对应环境的数据，生成同域名 `/AtlasRouter-Dev` 链接；模块与规则沿用此路径，旧测试域名不恢复。
- 香港管理及上游订阅继续直接使用 Access + Tunnel，相关 DNS、证书和转发规则独立保留。

`PREVIEW_EMAIL_HASHES` 是正式站内的只读演示身份，不能获取有效订阅，与已停用的原生部署预览不同。其权限保护保持不变。

当前发布和验证流程以 [部署说明](deployment-cloudflare.md) 为准；历史分支差异见 [兼容性核对](client-compatibility.md)，不代表存在可用的测试环境。
