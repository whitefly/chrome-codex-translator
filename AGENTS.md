# Repository Guidelines

## 项目结构与模块组织

本项目是 Chrome Manifest V3 翻译扩展，使用 TypeScript、原生 HTML 和 CSS，通过 Python Native Messaging 桥接调用本机 Codex App Server。通过 esbuild 构建，没有 HTTP 后端或数据库。

- `extension/manifest.json`：扩展入口、权限、快捷键与侧边栏声明。
- `src/entries/`：后台、悬停、内容选择器与侧栏四个 TypeScript 入口。
- `src/background/tasks.ts`：统一单任务调度、取消、结果与状态；`native-client.ts`：本地桥接连接；`page-cache.ts`：会话缓存。
- `src/page/`：正文选区算法、浮卡模板与外观。
- `src/shared/`：消息与数据契约、运行时边界校验、消息调用、偏好与安全 Markdown 渲染。
- `extension/sidepanel.html`、`extension/sidepanel.css`：侧边栏静态资源；`scripts/build.mjs`：构建与监听。
- `dist/`：Chrome 实际加载的编译产物，不手工编辑、不提交。
- `native/host.py`：Chrome 消息封装、Codex 子进程通信、输入校验与翻译调度；只依赖 Python 标准库。
- `scripts/install_host.py`：macOS 本地桥接注册；`scripts/doctor.py`：连接与模型诊断；`scripts/smoke_test.py`：真实模型请求检查。
- `tests/`：Python 单元测试和基于 Playwright 的 JavaScript 浏览器测试。
- `docs/`：架构与协议、排错说明和测试记录；`README.md`：安装、使用与开发入口。
- `extension-id.txt`：开发版扩展 ID；`test-artifacts/`：测试生成的截图等产物，已被 Git 忽略。

## 安装、测试与开发命令

运行扩展需要 Chrome 116+、Python 3.9+ 和可用且已登录的 Codex。构建与浏览器自动化测试需要 Node.js 20+、npm 和 Playwright；本地桥接安装脚本目前仅支持 macOS。

- 在 `chrome://extensions` 开启开发者模式，先执行 `npm ci` 和 `npm run build`，再加载 `dist/` 目录。
- `npm ci`：按锁文件安装开发与测试依赖。
- `npm run typecheck`：严格检查源码及消息契约类型测试。
- `npm run build`：类型检查通过后生成完整扩展。
- `npm run dev`：监听 TS 和静态资源，同时持续报告类型错误，Chrome 仍需手动刷新。
- `npm run check`：运行 Python、类型检查、构建产物检查和浏览器回归。
- `npx playwright install chromium`：安装 Playwright 测试浏览器。
- `npm test`：运行 Python 单元测试，等价于 `python3 -B -m unittest discover -s tests -v`，不调用真实模型。
- `npm run test:ui`：先构建，再运行产物检查、Markdown、侧栏、后台、悬停及框选测试，使用模拟 Chrome 桥接验证编译产物。
- `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:ui`：改用本机 Chrome 运行浏览器测试。
- `python3 -B scripts/doctor.py`：检查本机 Codex 握手、登录与模型列表。
- `python3 scripts/install_host.py <扩展ID> --codex <Codex可执行文件绝对路径>`：注册 Native Messaging host，生成本机启动脚本和配置。
- `python3 -B scripts/smoke_test.py`：发送真实模型请求，会使用当前账号额度；可用 `--model MODEL_ID` 或 `--image <PNG路径>` 指定模型或截图。

修改扩展后先构建或保持 dev 监听，在 `chrome://extensions` 刷新扩展，再刷新目标网页并重新打开侧边栏。修改 Python host 后，刷新扩展以断开旧连接。无数据库迁移命令。

## 开发规范

### 代码风格与职责边界

- 问完信息后设计方案，并等待人类确认后再开发。
- 使用严格 TypeScript、可区分联合和清晰的消息契约；未知消息与存储数据在入口校验，业务函数接收已收窄的数据。Python 按需补充类型标注。
- 除非特别要求，不做兼容，不保留历史包袱，面向长期干净整洁，减少复杂度。
- 存在架构问题则按职责、层次、领域边界合理拆分。
- 开发功能呢和修复Bug时禁止过度兜底和，要定位根因，并用正确的逻辑解决问题。
- 方法遵守单一抽象层次原则，一个函数里的代码应处在同一个抽象层级。
- 超过 30 行的方法，要增加简短直观的中文注释。
- 增加工具方法时考虑复用性,优先使用已有的工具方法 ；优先使用平台或标准库能力，确需第三方依赖时再选成熟库. 

## 提交与拉取请求规范

- 提交使用 `feat:`、`fix:`、`docs:` 等前缀，摘要简短，优先中文，每次提交聚焦单一改动。
- PR 应说明行为变化、按需关联问题，并列出验证命令；界面改动附截图，权限或本机配置变更说明影响。
- 不提交 `dist/`、`node_modules/`、`test-artifacts/`、Python 缓存及本机生成的配置和启动脚本。
