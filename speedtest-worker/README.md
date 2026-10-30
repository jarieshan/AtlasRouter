# Pulse 静态测速外观站

独立的 Cloudflare Worker，根路径 `/` 展示 Speedtest 风格的深色测速界面。采用独立品牌 Pulse，不代表 Ookla 或其 Speedtest 服务。页面使用正常站点文案；实现仍为静态前端动画，读数由固定样本驱动，不进行真实网速测量。

此目录与现有 `worker/` 订阅服务作为两个独立 Worker 运行，通过仓库的统一入口顺序部署。测速站不读写 D1、节点信息或订阅凭据，不更改订阅服务的根路径、Access 策略及订阅入口。

## 本地预览

在仓库根目录执行以下命令，使用现有 Worker 锁定的 Wrangler 版本：

```sh
npm --prefix worker ci
cd speedtest-worker
../worker/node_modules/.bin/wrangler dev --config wrangler.jsonc
```

打开终端显示的本地地址。页面支持开始、停止、重新演示、复制模拟结果，以及测试说明和隐私弹窗；适配手机和减少动态效果设置。禁用 JavaScript 时显示静态界面与提示。页面脚本不发出测速请求、不加载第三方资源、不使用 Cookie 或本地存储。

## 构建检查与部署

在仓库根目录检查两个 Worker，不执行远程迁移或发布：

```sh
npm --prefix worker run deploy -- --dry-run
```

部署目标为 [https://speedtest.hosts.zslab.ai/](https://speedtest.hosts.zslab.ai/)，对应独立 Worker `pulse-speedtest`。`wrangler.jsonc` 已配置该 Custom Domain，并关闭 `workers.dev` 和预览地址。

确认登录的是托管 `zslab.ai` 的 Cloudflare 账号后，在仓库根目录统一部署：

```sh
npm --prefix worker run deploy
```

该命令先执行订阅服务的 D1 迁移、管理路径轮换和发布，再发布测速站。如果尚未登录，可先在 `worker/` 目录运行 `npx wrangler login`；使用已配置的 API Token 时无需交互登录。

只更新测速站时，在仓库根目录执行以下命令，不会触发订阅服务的迁移或密钥轮换：

```sh
npm --prefix worker run deploy:speedtest
```

首次部署前确认账号中没有用途不同的同名 Worker。部署完成后访问上述域名的根路径 `/`。Custom Domain 会由 Cloudflare 自动创建 DNS 记录并签发覆盖 `speedtest.hosts.zslab.ai` 的证书，不需要手动添加指向 `workers.dev` 的 CNAME；多级子域名同样受支持。如果该主机名已有其他用途的 CNAME，需先确认其用途，不应直接覆盖或删除。机制见 [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

首次绑定后，DNS 记录和 HTTPS 证书可能不会同时生效。如果域名已解析但暂时出现 TLS 握手失败，可在 `zslab.ai → SSL/TLS → Edge Certificates` 查看该主机名的证书状态，待激活后再访问。

测速站没有使用 Secrets、普通环境变量或数据库绑定。`.github/workflows/worker.yml` 会检查两个 Worker，并在 main 验证成功后通过统一入口发布。两项发布并非原子操作，后一步失败不会回滚前一步；如果仅测速站失败，可用 `deploy:speedtest` 单独重试。

## 文件与响应

- `public/index.html`：根页面、说明和隐私弹窗。
- `public/styles.css`、`public/app.js`、`public/favicon.svg`：本地静态资源。
- `public/404.html`：不存在的路径返回此页面及 HTTP 404。
- `public/_headers`：静态响应头，限制脚本和样式为同源资源，禁止脚本建立网络连接和页面被嵌入。
- `wrangler.jsonc`：仅上传 `public/`，使用 Workers Static Assets 提供 GET / HEAD 静态响应；无需自定义 `fetch` 处理器。

修改站点文字与外观时直接编辑 `public/`，不用额外构建。`public/` 下的文件可被公开访问，不要放入配置、密钥或节点信息。未知路径不会回退为状态码 200 的首页。

实现依据：[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[静态资源响应头](https://developers.cloudflare.com/workers/static-assets/headers/)、[自定义 404](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)。
