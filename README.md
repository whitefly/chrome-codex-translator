# Codex Translate · Chrome 0.3.0

在 Chrome 中悬停段落，交给本机 Codex 翻译或总结，结果在原文旁的浮卡逐步显示。侧边栏保留模型设置、划词和截图功能。

- Chrome Manifest V3，TypeScript / 原生 HTML / CSS，使用 esbuild 打包。
- Python 3.9+ 标准库桥接，无 pip 依赖。
- Native Messaging 通信，不开放本地 HTTP 端口。
- 从 Codex 动态读取可用模型、图片能力和思考强度。
- 支持中文、英文、日文、韩文目标语言；停止、重试、复制。
- 普通悬停显示“译 / 总”按钮；点击相应按钮处理，或按住 Option/Alt 悬停 450ms 直接翻译。

本地运行的是 Codex 进程，模型推理通常仍在云端。ChatGPT 登录使用相应 Codex 权益；API Key 登录使用 API 计费。扩展不读取或保存登录令牌。

## 安装（macOS）

本项目的路径：`/Users/zhouang/IdeaProjects/chrome-codex-translator`。

### 1. 检查 Codex

```bash
cd /Users/zhouang/IdeaProjects/chrome-codex-translator
python3 -B scripts/doctor.py
```

应显示 `handshake OK`、登录方式与模型列表。若未登录，用 doctor 输出的可执行文件运行 `login`。例如这台机器可使用：

```bash
"/Applications/ChatGPT.app/Contents/Resources/codex" login
```

桥接会寻找 PATH、Homebrew 和桌面应用附带的 Codex，并先验证可执行性。也可以在安装时用 `--codex` 固定路径。桌面应用更新可能改变内置 CLI，应在升级后复验；长期使用可安装独立的官方 Codex CLI。

### 2. 构建并在 Chrome 加载扩展

开发需要 Node.js 20+。首次安装依赖并构建：

```bash
npm ci
npm run build
```

1. 打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `dist` 文件夹（不要加载只包含静态资源的 `extension`）。
5. 将扩展固定到工具栏。

仓库附带公开的 manifest key，使开发版扩展 ID 固定：

```text
dkphlioelbflcdppiljpajdgffmlccck
```

这是开发版身份公钥，不是 API 密钥。首次加载后请核对 Chrome 显示的 ID；发布商店版本时使用商店分配的身份并重新注册本地桥接。

### 3. 注册本地桥接

```bash
python3 scripts/install_host.py dkphlioelbflcdppiljpajdgffmlccck \
  --codex "/Applications/ChatGPT.app/Contents/Resources/codex"
```

安装脚本在当前用户的 Chrome `NativeMessagingHosts` 目录写入一个清单，并在 `native/` 生成启动脚本和本机配置。只允许上面的扩展 ID 连接。再次安装会备份已有清单为 `.json.bak`。移动项目或更换 Python 后要重新运行安装脚本。

### 4. 网页内悬停翻译（推荐）

1. 打开普通网页，点击工具栏扩展图标，启用当前页面的悬停翻译，不再自动打开侧边栏。
2. 鼠标停在段落上约 450ms，段落高亮并出现“译 / 总”按钮；点击后原文旁显示流式译文或摘要。浮卡顶部也能切换操作。
3. 也可以按住 **Option/Alt** 悬停 450ms，直接翻译。普通鼠标经过不会发送请求。
4. 首次请求会自动连接本地 Codex，使用保存的模型、思考强度和语言；未保存模型时使用可用默认模型。
5. 浮卡支持复制、停止、重试；右上角 × 关闭结果，Esc 退出翻译模式。关闭仍在翻译的浮卡会取消请求。
6. 点击浮卡或右下角提示条的“设置”，打开侧边栏调整模型、思考强度与目标语言。
7. 完成的段落旁会出现“已译”“已总”或“译·总”标记；点击即可查看暂存结果。相同段落再次点击已有操作会直接显示缓存；点“重试”才重新调用 Codex。
8. 按 Esc 或点击右下角提示条的 × 退出翻译模式，并取消正在进行的悬停请求。页面刷新或导航后需要重新点击扩展图标或使用快捷键启用。

**跨元素框选**：在网页上右键选择「框选翻译区域」，直接按住鼠标左键拖出矩形，无需提前启用悬停或移动到工具栏。也可使用右下角「框选」按钮。段落、列表项、标题、代码块等内容块只要与矩形相交，就整块纳入并实时高亮，无须完全框住。松开后点击「译 / 总」，按页面顺序合并处理，结果显示在选区旁的浮卡中。支持反向拖动；点击「重新框选」或再次使用右键菜单可更换范围，拖动中或选定但尚未处理时按 Esc 取消选区并回到悬停模式。结果浮卡打开后，Esc 仍退出翻译模式。

框选只处理当前视口内的正文块，嵌套内容去重，不因命中布局容器而扩展为整页；表单、可编辑内容及隐藏元素不纳入。单次最多 200 个内容块、合计 12,000 字符，超过后会提示缩小范围，不会截断发送。拖动中滚动、改变窗口大小或失焦会取消本次拖动。多块结果作为整组选区暂存，全部路径和原文一致时才恢复；升级到此版本后旧格式的会话缓存不再恢复。

翻译模式快捷键默认未设置。侧栏显示当前绑定，点击「设置快捷键」进入 `chrome://extensions/shortcuts`，为「进入当前网页的翻译模式」设置组合键。按该键进入模式，重复按下仍保持启用；按 Esc 退出。原有悬停切换与划词快捷键已移除。译文和摘要只保存在当前浏览器会话的扩展临时存储中，按标签与网页 URL 隔离；同一网页刷新后重新启用模式，内容一致的段落会恢复标记。浏览器会话结束后清除，不写入项目文件或长期历史。页面结构或文字变化时，旧结果不会贴到不匹配的段落。

浮卡宽度跟随段落（窄段落至少 240px，并限制在视口内），译文字体、字号、行高及颜色跟随原文，背景按原文及祖先元素底色合成；高度随译文内容变化，超出视口时可滚动。浮卡跟随段落滚动定位；原文离开视口时浮卡暂时隐藏，再滚回时恢复。不替换网页文本，不监听输入框的文字。单次悬停段落上限 12,000 字符。

从原生 JS 版本升级时，先构建，再在 chrome://extensions 移除原来加载的 `extension/`，改为加载 `dist/`。manifest key 保持不变，核对扩展 ID 后即可复用原有 Native Messaging 注册。之后每次更新都需刷新扩展、刷新网页并重新打开侧栏。

### 5. 侧边栏与截图

在网页右下角“设置”打开侧边栏后，原有功能保留：

- **划词**：选中文字后点击“划词”，或使用右键菜单。
- **选择元素**：悬停高亮，点击选定，↑/↓ 调整范围。
- **截图**：拖出矩形并查看裁剪预览。
- **粘贴**：直接输入原文，点击“开始翻译”。

这些入口仍在侧边栏显示结果。使用旧式元素/截图选择器时会暂时停用悬停模式；点击“在当前网页启用悬停翻译”可恢复。

侧栏中的语言、模型与思考强度同排显示，修改后自动保存。

默认开启「Markdown 排版」，翻译保留段落、列表与代码结构，总结先给核心结论，再按主题分层列要点（短内容不强行分章）。侧边栏与网页浮卡支持标题、加粗、嵌套列表、引用、代码块和表格。

浮卡优先跟随选区中主要正文的字号、字重与行高，混合框选时不再把首个标题的样式套到全文。Markdown 标题仅比正文放大约 4%–16%，代码保持等宽且字号贴近正文；单独选择标题时以其父容器作为正文基准。中英文字形不同，视觉大小可能仍有轻微差异。

在侧栏「翻译偏好」关闭开关即可显示普通文本，已有结果和流式结果立即切换，无需重新调用模型；设置会保存到本地并同步到已打开的浮卡。复制遵循当前模式：开启时复制 Markdown 原文，关闭时复制去掉排版标记、保留列表层次与代码内容的普通文本。模型输出与会话缓存始终保留 Markdown。HTML 只作为文字显示，链接和图片只显示说明与地址，不自动打开或加载。

## 范围与限制

- 初版支持 Chrome 116+，本地安装脚本仅支持 macOS。
- 当前只在顶层页面选择元素；跨域 iframe、封闭 Shadow DOM、Chrome 内部页面、扩展商店与部分内置 PDF 页面不支持直接提取。
- 截图仅包含当前视口，支持反向拖选与高 DPI 裁剪；不支持滚动长截图。打开侧边栏可能改变网页布局，应打开后再框选。
- 侧边栏一次最多 30,000 个字符或 8 MB PNG；悬停或框选最多 12,000 字符，框选最多 200 个内容块。翻译和总结共用一个进行中的请求。
- 完成前约 150 秒超时；连接或启动阶段另有超时。停止请求需要等待 Codex 响应，不保证瞬时停止。
- 截图模型只从支持 image 的模型中选择。模型目录由账号和本机客户端决定。
- 侧边栏不保存翻译历史；其原文/截图/译文保存在扩展进程内存，点击“清空”释放。悬停结果按上文所述临时保存在 `chrome.storage.session`，最多保留每页 60 个段落。
- App Server 协议会随版本变化。已针对本机 `codex-cli 0.155.0-alpha.9.2` 验证；升级后请运行 doctor 和 smoke test。

## 开发与验证

源码位于 `src/`，静态资源位于 `extension/`，`dist/` 是生成物，不手工编辑也不提交。开发时运行：

```bash
npm run dev         # 监听 TS 与静态资源，持续报告类型错误
npm run typecheck   # 仅检查类型，包括消息契约的编译期测试
npm run build       # 类型检查通过后构建 dist/
npm run check       # Python、类型、构建和浏览器回归
```

监听编译完成后仍需手动刷新 Chrome 扩展、目标网页和侧栏。正式构建遇到类型错误会失败。后台和侧栏生成 ES Module，网页注入脚本生成自包含 IIFE；所有依赖都打包在扩展内，没有 CDN 或开发 HTTP 服务。

后端单元测试不访问网络、不调用真实模型：

```bash
python3 -B -m unittest discover -s tests -v
```

浏览器自动化测试先构建，再使用模拟 Chrome 桥接，在独立浏览器环境中检查实际产物；Markdown 单元测试通过测试适配器打包同一源码模块：

```bash
npm ci
npx playwright install chromium
npm run test:ui
```

也可使用本机 Chrome：

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:ui
```

实际短句测试（会使用当前账号 Codex 额度）：

```bash
python3 -B scripts/smoke_test.py
# 可指定 model/list 返回的模型：
python3 -B scripts/smoke_test.py --model MODEL_ID
# 将指定 PNG 发给模型：
python3 -B scripts/smoke_test.py --image tests/example.png
```

测试详情与未覆盖项目见 [测试记录](docs/TESTING.md)。修改扩展后先构建（或保持 dev 监听），再到 `chrome://extensions` 点刷新、刷新目标网页，并重新打开侧边栏；修改 host 后应断开旧连接（刷新扩展即可）。

## 目录

```text
src/entries/    后台、侧栏、悬停与内容选择器四个 TS 入口
src/background/ Native Messaging、统一任务调度与页面缓存
src/page/       页面选区算法与浮卡模板、外观
src/shared/     消息契约、边界校验、偏好与 Markdown 渲染
extension/      Manifest、侧栏 HTML 与 CSS
dist/          可加载扩展（自动生成，Git 忽略）
native/host.py   Chrome 消息封装、输入校验、翻译调度
native/translator.py   Translator 接口与请求、结果、能力类型
native/codex_translator.py   Codex 翻译会话、增量结果、临时图片
native/codex_client.py   Codex 子进程与 JSON-RPC 通信
scripts/        构建监听、安装、诊断、真实翻译检查
tests/          Python 单元测试、浏览器交互测试
docs/           架构、开发协议、排错和测试记录
```

详细说明：[架构与协议](docs/ARCHITECTURE.md) · [排错](docs/TROUBLESHOOTING.md)

## 卸载

在 Chrome 中移除扩展，然后删除本地注册清单：

```bash
rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.local.codex_translator.json"
```

项目本身可以保留；本项目不会修改 Codex 全局配置和登录状态。

### 回传日志

刷新扩展后，本地桥接会将脱敏诊断日志写入项目 `log/bridge-<进程ID>.log`。记录协议回传、请求 ID、耗时、字符数及错误类型，不记录原文、译文或截图。单文件 2 MiB，保留两份轮转备份；旧进程文件可手动清理。查看方法见 [排错文档](docs/TROUBLESHOOTING.md#回传诊断日志)。

### 翻译服务接口

`Host(emit, translator=...)` 支持注入实现 `Translator` 协议的服务，默认创建并复用 `CodexTranslator`。接口包含 `connect`、`translate`、`cancel`、`close`；请求与结果使用 dataclass，非流式服务直接返回最终结果。当前仍只启用 Codex，后续有道等服务需要实现接口并接入前端的服务选择与能力展示。Codex 子进程跨请求复用，每次翻译只新建临时会话。
