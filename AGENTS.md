# Repository Guidelines

## 项目结构与模块组织

本项目使用 TypeScript，通过同一个 Cloudflare Worker 提供 React 管理界面和 Hono API，数据存储使用 D1。

- `src/web/`：React 页面、组件、会话状态和 `styles.css`；`api.ts` 统一管理 HTTP 请求。
- `src/shared/`：共享类型契约和 Zod 校验规则。
- `src/worker/`：Worker 入口、业务路由、认证与授权服务、公共工具及 `sql/` 查询模块。
- `migrations/`：按编号排序的 D1 迁移，例如 `0003_external_accounts.sql`。
- `tests/`：Vitest 测试和 Worker 测试夹具；`scripts/`：初始化、部署和验证脚本。
- `doc/对接api详情/`：对外 API 接入文档。Vite 构建产物位于 `dist/`。

## 构建、测试与开发命令

使用 Node.js 22.12+ 和 npm。

- `npm ci`：按锁文件安装依赖。
- `npm run setup:local`：生成本地密钥、迁移 D1 并填充虚构数据。
- `npm run setup:local-admin`：配置本地管理员密码。
- `npm run dev`：启动开发服务，地址为 `http://127.0.0.1:5173`。
- `npm run db:migrate`：执行本地 D1 迁移。
- `npm run typecheck`：执行严格的 TypeScript 类型检查。
- `npm test`：运行全部 Vitest 测试。
- `npm run build`：检查类型并构建应用。
- `npm run test:production`：验证构建产物中的认证限制；运行前先完成构建。

## 开发规范

### 开发前

- 问完信息后设计方案，并等待人类确认后再开发
- 尽量采用强类型设计
- 除非特别要求，不做兼容，不保留历史包袱，面向长期干净整洁，减少复杂度

### 开发中

代码风格

- 单文件超出2000 行了必须进行结构审查，如果存在架构问题则按职责、层次、领域边界合理拆分
- 修复 Bug 时禁止过度兜底，要定位根因，并用正确的逻辑解决问题
- 方法要遵守单一抽象层次原则，一个函数里的代码应该处在同一个抽象层级
- 超过10行的方法,要增加简短直观的中文注释
- 增加工具方法时,要考虑复用性.常用的字符串、日期等操作,优先引用成熟库来实现

命名规范

- 使用单引号和分号，缩进与所在文件保持一致：较新的模块通常使用四个空格，部分已有文件使用两个空格。React 组件文件和类型使用 PascalCase，函数和变量使用 camelCase，多词服务模块文件名使用 kebab-case。目前未配置专用格式化工具或 lint 脚本。
- 前端接口地址和 HTTP 操作统一放在 `src/web/api.ts`，页面调用业务方法。运行时 SQL 统一放在 `src/worker/sql/`。边界测试会检查这两项约束。


## 测试规范

测试文件命名为 `tests/*.test.ts`，使用 Vitest 的 `describe`、`it` 和断言组织用例。集成测试使用独立的 Miniflare D1 数据库，需要本机端口访问权限。单独运行测试可使用 `npm test -- tests/auth.test.ts`。修改权限隔离、认证、事务或 API 行为时，应补充回归测试。目前未设置数值化的覆盖率门槛。

## 提交与拉取请求规范

Git 历史使用 `feat:`、`fix:` 前缀，摘要简短且多为中文。延续此格式，每次提交聚焦单一改动。PR 应说明行为变化、按需关联问题，并列出验证命令；界面改动附截图，数据库迁移或配置变更需说明影响。

## 安全与配置

密钥保存在 Git 忽略的 `.dev.vars` 中，配置项参考 `.dev.vars.example`。修改密钥后重启开发服务。保持生产环境的认证限制及 `SSO` Service Binding 调用边界。
