# 排错

| 现象 | 检查方法 |
|---|---|
| Specified native messaging host not found | 检查安装命令是否成功，注册清单文件名必须为 com.local.codex_translator.json；Chrome 与 Chromium/其他浏览器的注册目录不同 |
| Access to the specified native messaging host is forbidden | 核对 chrome://extensions 的扩展 ID 和清单 allowed_origins；重新运行安装脚本 |
| Native host has exited | 运行 scripts/doctor.py，检查 Python、Codex 路径和版本；移动项目后需要重装桥接 |
| codex 报 ENOENT | 当前 CLI 包缺少原生可执行文件，可用 --codex 指定桌面应用附带版本，或重新安装官方 CLI |
| 连接成功但未登录 | 使用 doctor 输出的 Codex 可执行文件执行 login，再刷新扩展重连 |
| 模型不可用 / 额度不足 | 刷新模型目录，选择账号有权使用的模型；检查 Codex 使用额度。会员并不意味着无限使用 |
| 元素按钮无法选区 | 在当前标签点击扩展图标授予 activeTab；Chrome 内部页/商店/跨域 iframe 不支持，换普通网页或粘贴文字 |
| 截图与内容不一致 | 框选后不要切标签、滚动或改变缩放；先打开侧边栏再框选；初版仅捕获当前视口 |
| 文本/图片过大 | 缩小区域；上限 30,000 字符 / 8 MB PNG |
| 修改代码后还是旧版本 | 在 chrome://extensions 刷新扩展；关闭再打开面板，使旧 Native Messaging 连接退出 |

浏览器侧：chrome://extensions → 本扩展 → Service Worker 检查视图。页面选区异常可检查网页控制台。host 的 stdout 专供 Chrome 帧协议使用，不能添加 print 调试日志；如需临时日志，只写 stderr，并避免记录原文、截图和登录信息。

开发测试与实际安装有区别：UI 自动化使用模拟 Chrome 通信接口；真实 Native Messaging 端到端还需在 Chrome 手工加载扩展并检查。详见 TESTING.md。


## 悬停模式

- 升级后必须刷新扩展和网页；旧内容脚本在已打开网页中不会自动替换。
- 点击工具栏图标启用当前页。出现右下角提示条才表示启用成功。普通鼠标经过只显示按钮，按 Option/Alt 悬停或点击“译”才发送。
- 输入框和可编辑区域不参与悬停；超过 12,000 字符的容器不作为单个段落发送。
- 没有登录/桥接未安装时，浮卡显示错误，可从“设置”打开侧边栏排错后重试。
- 单任务运行期间，其他段落/标签会提示已有翻译；先关闭或停止原浮卡。
- Esc 关闭结果；关闭进行中的结果会发送取消请求。点击右下角 × 则停用本页悬停。
- 点击“总”可总结当前段落；完成后段落旁的“已译 / 已总 / 译·总”可点击回看。刷新后需重新启用悬停模式才能显示当前会话的标记；页面改版或文字变化会使旧标记不匹配。
- 默认使用 `Control+Shift+Y`（macOS）或 `Alt+Shift+Y`（其他平台）切换悬停模式。若无反应，在 `chrome://extensions/shortcuts` 查看是否被 Chrome 或其他扩展占用。
