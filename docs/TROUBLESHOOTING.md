# 排错

| 现象 | 检查方法 |
|---|---|
| 加载扩展提示缺少 background.js | 不要加载静态资源目录 extension；先 npm ci、npm run build，再加载 dist |
| Specified native messaging host not found | 检查安装命令是否成功，注册清单文件名必须为 com.local.codex_translator.json；Chrome 与 Chromium/其他浏览器的注册目录不同 |
| Access to the specified native messaging host is forbidden | 核对 chrome://extensions 的扩展 ID 和清单 allowed_origins；重新运行安装脚本 |
| Native host has exited | 运行 scripts/doctor.py，检查 Python、Codex 路径和版本；移动项目后需要重装桥接 |
| codex 报 ENOENT | 当前 CLI 包缺少原生可执行文件，可用 --codex 指定桌面应用附带版本，或重新安装官方 CLI |
| 连接成功但未登录 | 使用 doctor 输出的 Codex 可执行文件执行 login，再刷新扩展重连 |
| 模型不可用 / 额度不足 | 刷新模型目录，选择账号有权使用的模型；检查 Codex 使用额度。会员并不意味着无限使用 |
| 元素按钮无法选区 | 在当前标签点击扩展图标授予 activeTab；Chrome 内部页/商店/跨域 iframe 不支持，换普通网页或粘贴文字 |
| 截图与内容不一致 | 框选后不要切标签、滚动或改变缩放；先打开侧边栏再框选；初版仅捕获当前视口 |
| 文本/图片过大 | 缩小区域；上限 30,000 字符 / 8 MB PNG |
| 修改代码后还是旧版本 | 先运行 npm run build 或保持 npm run dev；确认 Chrome 加载 dist，在 chrome://extensions 刷新扩展、刷新网页并重开侧栏 |

浏览器侧：chrome://extensions → 本扩展 → Service Worker 检查视图。页面选区异常可检查网页控制台。host 的 stdout 专供 Chrome 帧协议使用，不能添加 print 调试日志；如需临时日志，只写 stderr，并避免记录原文、截图和登录信息。

开发测试与实际安装有区别：UI 自动化使用模拟 Chrome 通信接口；真实 Native Messaging 端到端还需在 Chrome 手工加载扩展并检查。详见 TESTING.md。


## 悬停模式

- 升级后必须刷新扩展和网页；旧内容脚本在已打开网页中不会自动替换。
- 点击工具栏图标启用当前页。出现右下角提示条才表示启用成功。普通鼠标经过只显示按钮，按 Option/Alt 悬停或点击“译”才发送。
- 输入框和可编辑区域不参与悬停；超过 12,000 字符的容器不作为单个段落发送。
- 没有登录/桥接未安装时，浮卡显示错误，可从“设置”打开侧边栏排错后重试。
- 单任务运行期间，其他段落/标签会提示已有翻译；先关闭或停止原浮卡。
- Esc 或右下角 × 退出本页翻译模式，并取消进行中的请求。浮卡右上角 × 仅关闭结果，关闭进行中的结果也会发送取消请求。
- 点击“总”可总结当前段落；完成后段落旁的“已译 / 已总 / 译·总”可点击回看。刷新后需重新启用悬停模式才能显示当前会话的标记；页面改版或文字变化会使旧标记不匹配。
- 默认没有快捷键。通过侧栏「设置快捷键」或 `chrome://extensions/shortcuts` 为「进入当前网页的翻译模式」绑定按键。


## 回传诊断日志

刷新扩展、关闭再打开侧栏，以启动新版 host。日志自动写入本项目 `log/bridge-<进程ID>.log`，与启动时的工作目录无关。每个进程单独记录，单文件达到 2 MiB 后轮转，保留 `.1`、`.2` 两份备份；旧进程日志可手动删除。`log/` 已加入 Git 忽略。

在项目目录查看最近启动进程的日志：

```bash
ls -lt log/
tail -f log/bridge-<进程ID>.log
```

日志记录时间、请求 ID、协议调用 ID、回传事件名称、字符数、取消状态、错误类型/数值错误码及阶段耗时，不保存原文、译文、截图、登录信息或完整错误描述。Codex 原始 stderr 仍不保存，避免其中包含敏感内容。

- `chrome.received`：host 收到扩展请求。
- `rpc.sent` / `rpc.completed` / `rpc.failed`：调用 Codex 的方法及耗时；用 `rpc_id` 对应 `codex.received` 回传。
- `translation.event`：当前翻译期间收到的事件及累计耗时；事件是否属于当前会话由后续路由判断。
- `chrome.sent`：已向 Chrome 写出回传帧（不代表页面已渲染），`chars` 为正文字符数。
- `translation.timeout` / `translation.failed` / `translation.finished`：超时、异常和任务结束。

长时间无结果时，先按 `request_id` 找到请求，再看最后停在哪个协议方法。没有 `chrome.received` 说明需要继续检查扩展后台；已有 `chrome.sent` 的 `delta` 但页面无结果，需要检查浏览器回传路由与内容脚本。
