# 上秤

手机浏览器优先的熟人小组体重记录应用。正式代码位于 `apps/`，原有设计原型保留在 `prototype/`，两者数据相互隔离。

当前交付包括**本地基础应用**与已部署的[手机短信试用版](https://101.132.150.197/#login)。两者数据库独立。服务器现为 `sms-trial`，用户自行输入手机号、获取真实短信并核验；全站每天最多 10 次发送请求，身体数据请使用示例值。旧账号及其在线记录已按用户要求清空、旧体验码已撤销。本地仍保留明确标记的测试验证码。实际收码／手机登录等待用户验证，支付未接。

手机短信体验、部署位置及运行边界见[联机测试部署](docs/联机测试部署.md)。

测试站已启用每小时一致性备份与隔离恢复验证、每 5 分钟运行检查；本批另保存并验证一份本机私有副本。查询、演练及验证边界见[备份恢复与运行检查](docs/备份恢复与运行检查.md)。

## 换聊天继续开发

先读[开发交接](docs/开发交接.md)，再按任务选读规范与代码；开发经验、工具恢复和验收方法见[开发流程与经验](docs/开发流程与经验.md)。下一阶段可开始正式登录与数据控制开发，具体可执行范围、外部依赖及待确认规则见[真实试用推进方案](docs/真实试用推进方案.md)。低 BMI 已确认保留当前算法、不增加限制。项目根目录 `AGENTS.md` 提供新聊天的阅读入口。

## 启动

需要 Node **24.15–24.x**，本次实际使用 **24.19.0**。无第三方运行依赖，不需要 `npm install` 或额外安装数据库。

```sh
node --env-file-if-exists=.env apps/api/server.mjs
```

打开 [本地应用](http://127.0.0.1:4180)。开发配置见 `.env.example`；默认只监听本机。普通 Node 环境也可 `npm run dev`／`npm start`。

本机系统 PATH 没有可用 Node 时，使用本次验证过的完整命令：

```sh
cd /Users/liuyuchen/Documents/payathon
/Users/liuyuchen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node apps/api/server.mjs
```

登录时输入合成测试手机号（例如 `13910000001`），点击获取验证码，页面明确显示「本地测试验证码，未发送短信」。不同手机号对应不同账号；同一手机号重新登录读取原有数据。不要把本地测试验证码当成手机号归属验证。

多人验证可在普通与无痕浏览器分别登录不同测试手机号，经动态邀请码加入同一个小组。两个环境都必须运行在本机：当前邀请链接的 `127.0.0.1` 不能直接分享给远端手机。

上述限制适用于本地模式。手机测试打开公网网址，使用本人手机号；请只填写示例昵称和身体数据。`sms-trial` 是独立 HTTPS 试用配置，不通过解除本地／体验码模式限制发布。配置示例见 `deploy/sms-trial.env.example`；缺短信适配、凭据、独立库或日上限均拒绝启动。

## 检查

```sh
node scripts/check.mjs
node --test tests/*.test.mjs
```

测试临时库相互隔离，不修改应用数据。HTTP 集成测试临时监听本机随机端口；受限环境需要允许本机端口。GitHub Actions 配置已写入，尚未在远端执行。

可选的浏览器异常流程验收使用已安装的 Playwright 与 Chrome，不属于正式应用运行依赖。脚本只创建内存数据库与独立无头浏览器，覆盖断网、响应丢失、两会话修改冲突、跨日、会话撤销及响应式布局，不操作 `var/development.sqlite`。本机命令：

```sh
PLAYWRIGHT_MODULE_PATH=/Users/liuyuchen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs /Users/liuyuchen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/browser-check.mjs
```

普通已安装 Playwright 的环境可直接执行 `node scripts/browser-check.mjs`；需要允许本机随机端口与 Chrome 启动。它不在默认 CI 中运行，也不等于手机实机验证。

## 结构

| 路径 | 职责 |
| --- | --- |
| `apps/web/` | 模块化原生 JavaScript 客户端，复用已确定的珊瑚色视觉 |
| `apps/api/` | 同源 HTTP 服务、会话、权限、业务事务 |
| `packages/domain/` | 目标公式、北京时间、单位换算、统计与排序 |
| `packages/contracts/` | 校验、错误与版本常量 |
| `db/migrations/` | SQLite 表、索引与约束 |
| `tests/` | 领域、服务、真实 HTTP 和回归测试 |
| `var/` | 本地私有数据，已忽略 Git |

SQLite 在 Node 24 中为 release candidate；当前选型用于单进程本地开发，生产数据库与部署栈仍需评估。[Node 官方 SQLite 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

## 当前能力与支持工具

已实现范围及验证边界见[开发交接](docs/开发交接.md)，逐批证据见[开发记录](docs/本地基础版开发记录.md)。

支持请求由开发者运行 `node scripts/support.mjs list` 查看，处理后用 `node scripts/support.mjs resolve <完整请求编号>`。产品仅显示请求已保存／待处理；实际支持渠道和时限尚未正式确定。

短信接入支持离线预检：`node scripts/sms-check.mjs`（或 `npm run sms:check`）。当前使用阿里云 PNVS 短信认证，字段示例见 [sms-auth.env.example](deploy/sms-auth.env.example)，私有配置检查命令如下；缺项退出码为 1。普通短信另见 [sms.env.example](deploy/sms.env.example)。只检查格式，不联网、不发短信、不输出密钥；通过也不代表供应商已授权或手机能收到。该工具不启用正式运行模式。

```sh
/Users/liuyuchen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --env-file=var/private/sms-auth.env scripts/sms-check.mjs
```

## 可视化查看与管理数据库

已安装独立 sqlite-web 管理工具，支持表格查看、编辑、SQL 查询与导出。电脑上双击项目中的 [打开数据库管理.command](打开数据库管理.command)，访问本机 `http://127.0.0.1:18888/`；密码在 Git 忽略的私有 `var/private/数据库管理入口.md`。这是 SSH 连接服务器当前数据库，操作会影响在线数据。完整打开／关闭方式、表说明及管理边界见[数据库可视化管理](docs/数据库可视化管理.md)。

## 交付与后续门槛

详情见 [本批开发与验证记录](docs/本地基础版开发记录.md) 和 [API 契约](docs/API契约.md)。本地开发使用昵称 20 字、介绍 200 字、体重 20–300 kg 的技术校验；它们仍是待用户冻结的正式规格。身高暂存本人私有准备字段用于本人编辑，组内接口不返回身高；正式保存期限尚未确定。2026-10-14 用户确认保留当前算法，不增加起始或目标低 BMI 限制。

本地源码已补齐验证码发送状态／超时保护、普通短信及 PNVS 平台生成／核验适配器；已部署独立 sms-trial 模式供用户手动试收，助手未发送真实短信，local／test 及生产模式门槛保留。账号注销新增独立删除清单，默认 `DATABASE_PATH.deletions.sqlite`（可用 `DELETION_JOURNAL_PATH` 指定），启动／恢复读取前重放，不能随业务快照回退；恢复要求见[维护手册](docs/备份恢复与运行检查.md)。首次升级到结构 2 会作废旧验证码，保留账号和记录。

真实短信验签／收发、历史／身高及备份保存策略、备份加密和清单异地持久化、生产监控、iOS／Android 实机及真实数据准入仍待完成。用户已决定不设计独立撤回共享功能，历史长期保留的具体政策仍待确认，暂不开自动清理。短信试用版本已部署，正式生产及收费按总控后续门槛评估。
