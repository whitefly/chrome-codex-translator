# Codex Translate · Chrome 0.3.0

在 Chrome 中悬停段落，交给本机 Codex 翻译或总结，结果在原文旁的浮卡逐步显示。侧边栏保留模型设置、划词和截图功能。

- Chrome Manifest V3，原生 JavaScript / CSS，无构建步骤。
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

### 2. 在 Chrome 加载扩展

1. 打开 `chrome://extensions`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `extension` 文件夹。
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
5. 浮卡支持复制、停止、重试；Esc 或右上角关闭。关闭仍在翻译的浮卡会取消请求。
6. 点击浮卡或右下角提示条的“设置”，打开侧边栏调整模型、思考强度与目标语言。
7. 完成的段落旁会出现“已译”“已总”或“译·总”标记；点击即可查看暂存结果。相同段落再次点击已有操作会直接显示缓存；点“重试”才重新调用 Codex。
8. 点击右下角提示条的 × 停用当前页。页面刷新或导航后需要重新点击扩展图标或使用快捷键启用。

悬停模式快捷键：macOS 默认 `Control+Shift+Y`，其他平台 `Alt+Shift+Y`，在当前标签启用或停用。可到 `chrome://extensions/shortcuts` 修改。译文和摘要只保存在当前浏览器会话的扩展临时存储中，按标签与网页 URL 隔离；同一网页刷新后重新启用模式，内容一致的段落会恢复标记。浏览器会话结束后清除，不写入项目文件或长期历史。页面结构或文字变化时，旧结果不会贴到不匹配的段落。

浮卡宽度跟随段落（窄段落至少 240px，并限制在视口内），译文字体、字号、行高及颜色跟随原文，背景按原文及祖先元素底色合成；高度随译文内容变化，超出视口时可滚动。浮卡跟随段落滚动定位；原文离开视口时浮卡暂时隐藏，再滚回时恢复。不替换网页文本，不监听输入框的文字。单次悬停段落上限 12,000 字符。

升级旧版后，在 chrome://extensions **刷新扩展，再刷新网页**，重新点击工具栏图标。原有 Native Messaging 注册不需要重装。

### 5. 侧边栏与截图

在网页右下角“设置”打开侧边栏后，原有功能保留：

- **划词**：选中文字后点击“划词”，或使用右键菜单/快捷键。
- **选择元素**：悬停高亮，点击选定，↑/↓ 调整范围。
- **截图**：拖出矩形并查看裁剪预览。
- **粘贴**：直接输入原文，点击“开始翻译”。

这些入口仍在侧边栏显示结果。使用旧式元素/截图选择器时会暂时停用悬停模式；点击“在当前网页启用悬停翻译”可恢复。

划词快捷键：macOS 默认 `Control+Shift+T`，其他平台 `Alt+Shift+T`，只提取原文并打开侧边栏，不自动发送。若快捷键冲突，在 `chrome://extensions/shortcuts` 修改。

## 范围与限制

- 初版支持 Chrome 116+，本地安装脚本仅支持 macOS。
- 当前只在顶层页面选择元素；跨域 iframe、封闭 Shadow DOM、Chrome 内部页面、扩展商店与部分内置 PDF 页面不支持直接提取。
- 截图仅包含当前视口，支持反向拖选与高 DPI 裁剪；不支持滚动长截图。打开侧边栏可能改变网页布局，应打开后再框选。
- 侧边栏一次最多 30,000 个字符或 8 MB PNG；悬停段落最多 12,000 字符。翻译和总结共用一个进行中的请求。
- 完成前约 150 秒超时；连接或启动阶段另有超时。停止请求需要等待 Codex 响应，不保证瞬时停止。
- 截图模型只从支持 image 的模型中选择。模型目录由账号和本机客户端决定。
- 侧边栏不保存翻译历史；其原文/截图/译文保存在扩展进程内存，点击“清空”释放。悬停结果按上文所述临时保存在 `chrome.storage.session`，最多保留每页 60 个段落。
- App Server 协议会随版本变化。已针对本机 `codex-cli 0.155.0-alpha.9.2` 验证；升级后请运行 doctor 和 smoke test。

## 开发与验证

后端单元测试不访问网络、不调用真实模型：

```bash
python3 -B -m unittest discover -s tests -v
```

浏览器自动化测试使用模拟 Chrome 桥接，在独立浏览器环境中检查侧边栏和页面选择：

```bash
npm install
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

测试详情与未覆盖项目见 [测试记录](docs/TESTING.md)。修改扩展后需要到 `chrome://extensions` 点刷新，并重新打开侧边栏；修改 host 后应断开旧连接（刷新扩展即可）。

## 目录

```text
extension/       Manifest、后台任务、选区脚本、侧边栏
native/host.py   Chrome 消息封装、Codex 客户端、翻译调度
scripts/         安装、诊断、真实翻译检查
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
