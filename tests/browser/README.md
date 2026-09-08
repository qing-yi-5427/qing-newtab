# 设置页浏览器回归

`node tests/browser/settings.mjs` 在临时 Edge 配置中加载扩展，拦截所有远程请求，不操作个人浏览器配置。需要可用的 Playwright 和 Edge；测试结束后删除临时配置，截图保留在输出目录。

可选环境变量：

- `PLAYWRIGHT_MODULE`：Playwright 的模块路径；默认加载已安装的 `playwright`。
- `BROWSER_EXECUTABLE`：Edge 可执行文件路径；默认使用 Playwright 的 `msedge` 通道。
- `BROWSER_ARTIFACTS`：截图保存目录；默认创建临时目录。

测试真实键盘、点击、下拉菜单与滑块操作，覆盖保存/取消、立即保存、失败后重试、间距实际像素、末行居中、重载持久化、输入校验、跨标签页修改、后台消息不可用，以及窄窗口下操作按钮可达性。常规单元和 DOM 回归仍使用 `npm test`。
