# Repository Guidelines

## 项目结构与模块组织

本项目是 Chrome Manifest V3 翻译扩展，使用原生 JavaScript、HTML 和 CSS，通过 Python Native Messaging 桥接调用本机 Codex App Server。没有前端构建步骤、HTTP 后端或数据库。

- `extension/manifest.json`：扩展入口、权限、快捷键与侧边栏声明。
- `extension/background.js`：Service Worker，负责消息路由、Native Messaging 连接、任务状态、截图裁剪与会话缓存。
- `extension/hover.js`：网页悬停翻译、总结、Shadow DOM 浮卡及段落标记。
- `extension/content.js`：划词、元素选择与截图框选。
- `extension/sidepanel.html`、`extension/sidepanel.js`、`extension/sidepanel.css`：侧边栏结构、交互、翻译偏好和样式。
- `native/host.py`：Chrome 消息封装、Codex 子进程通信、输入校验与翻译调度；只依赖 Python 标准库。
- `scripts/install_host.py`：macOS 本地桥接注册；`scripts/doctor.py`：连接与模型诊断；`scripts/smoke_test.py`：真实模型请求检查。
- `tests/`：Python 单元测试和基于 Playwright 的 JavaScript 浏览器测试。
- `docs/`：架构与协议、排错说明和测试记录；`README.md`：安装、使用与开发入口。
- `extension-id.txt`：开发版扩展 ID；`test-artifacts/`：测试生成的截图等产物，已被 Git 忽略。

## 安装、测试与开发命令

运行扩展需要 Chrome 116+、Python 3.9+ 和可用且已登录的 Codex。浏览器自动化测试需要 Node.js、npm 和 Playwright；本地桥接安装脚本目前仅支持 macOS。

- 在 `chrome://extensions` 开启开发者模式，加载 `extension/` 目录，无需构建。
- `npm install`：安装浏览器测试依赖。
- `npx playwright install chromium`：安装 Playwright 测试浏览器。
- `npm test`：运行 Python 单元测试，等价于 `python3 -B -m unittest discover -s tests -v`，不调用真实模型。
- `npm run test:ui`：依次执行 `tests/ui.cjs`、`tests/background.cjs`、`tests/hover.cjs`，使用模拟 Chrome 桥接验证侧边栏、后台路由和悬停交互。
- `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:ui`：改用本机 Chrome 运行浏览器测试。
- `python3 -B scripts/doctor.py`：检查本机 Codex 握手、登录与模型列表。
- `python3 scripts/install_host.py <扩展ID> --codex <Codex可执行文件绝对路径>`：注册 Native Messaging host，生成本机启动脚本和配置。
- `python3 -B scripts/smoke_test.py`：发送真实模型请求，会使用当前账号额度；可用 `--model MODEL_ID` 或 `--image <PNG路径>` 指定模型或截图。

修改扩展后，在 `chrome://extensions` 刷新扩展，再刷新目标网页并重新打开侧边栏。修改 Python host 后，刷新扩展以断开旧连接。当前没有 `dev`、`build`、`typecheck` 或数据库迁移命令。

## 开发规范

### 代码风格与职责边界

- 问完信息后设计方案，并等待人类确认后再开发。
- 尽量采用强类型设计：在现有 JavaScript 中用清晰的消息契约、必要的 JSDoc 和边界校验表达类型约束；Python 按需补充类型标注。
- 除非特别要求，不做兼容，不保留历史包袱，面向长期干净整洁，减少复杂度。
- 存在架构问题则按职责、层次、领域边界合理拆分。
- 开发功能呢和修复Bug时禁止过度兜底和，要定位根因，并用正确的逻辑解决问题。
- 方法遵守单一抽象层次原则，一个函数里的代码应处在同一个抽象层级。
- 超过 30 行的方法，要增加简短直观的中文注释。
- 增加工具方法时考虑复用性,优先使用已有的工具方法 ；优先使用平台或标准库能力，确需第三方依赖时再选成熟库. 


## 测试规范

- Python 测试使用 `unittest`，命名为 `tests/test_*.py`；浏览器测试使用 `tests/*.cjs`、Playwright 和 Node.js 断言。
- 修改消息来源校验、任务路由、取消、缓存隔离或协议行为时，补充有针对性的回归测试。
- 修改界面时运行相关浏览器测试，并检查 `test-artifacts/` 中的截图，关注窄侧边栏、溢出和浮卡定位。
- 自动化浏览器测试使用模拟桥接和独立浏览器环境，不依赖个人浏览器配置或真实模型；其中本地测试 HTTP 服务需要本机端口访问权限。
- 真实 Native Messaging 注册、浏览器权限和模型调用需按 `docs/TESTING.md` 补充验证；模拟测试不能替代真实链路验证。
- 按改动范围运行测试并说明未验证项；目前没有数值化覆盖率门槛。

## 提交与拉取请求规范

- 提交使用 `feat:`、`fix:`、`docs:` 等前缀，摘要简短，优先中文，每次提交聚焦单一改动。
- PR 应说明行为变化、按需关联问题，并列出验证命令；界面改动附截图，权限或本机配置变更说明影响。
- 不提交 `node_modules/`、`test-artifacts/`、Python 缓存及本机生成的配置和启动脚本。

## 安全与配置

- `native/config.json`、`native/launch.sh` 由安装脚本生成且已被 Git 忽略；移动项目或更换 Python 后需重新注册本地桥接。
- Native Messaging 注册清单位于当前用户的 Chrome `NativeMessagingHosts` 目录，`allowed_origins` 仅允许指定扩展 ID。
- `extension/manifest.json` 中的 key 是固定开发版扩展身份的公开密钥，不是 API 密钥。
- Codex 登录由现有客户端管理，不读取、复制或保存登录令牌，不把密钥、原文或截图写入日志。
- 保持 `activeTab` 用户授权边界，不随意扩大为全站读取权限；后台校验消息发送方、标签、文档和请求 ID，防止跨页面数据泄露及旧请求覆盖结果。
- 偏好使用 `chrome.storage.local`；悬停结果使用按标签与 URL 隔离的 `chrome.storage.session`，不默认增加长期翻译历史。
- 网页内容和模型输出均视为不可信数据，使用 `textContent` 显示，不执行返回的 HTML 或脚本。
- 保持 Codex 翻译会话的只读与工具限制，维持单个进行中模型请求的约束；不将 Native Messaging 转发为无鉴权网络服务。
