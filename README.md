# 上秤 · Java / Vue 重构

和朋友一起记录体重变化、培养日常习惯的手机优先产品。

**本地开发环境已可运行，M1 全量验收尚未完成。** Java 构建及 35 项单测通过；真实 MySQL／Redis、两个 Java 实例的核心 HTTP 流程和浏览器两账号流程已通过。前端类型检查、构建及 6 项请求单测通过。恢复演练、全部边界场景、实机和 M2 仍待完成；B9（读取优化与可选缓存）与 B10（实时动态）尚未开始。

- [Java 后端结构与阅读入口](apps/java-api/README.md)
- [完成情况检查](java-rebuild/完成情况检查.md)
- [需求与业务规则](java-rebuild/README.md)
- [实施任务表](java-rebuild/07-执行任务.md)
- [Redis 使用方案与简历表达](java-rebuild/11-Redis使用方案.md)
- [实时动态与事件推送](java-rebuild/12-实时动态与事件推送.md)

## 目录

| 路径 | 内容 |
| --- | --- |
| `apps/java-api` | Java 21 / Spring Boot 后端、Flyway、测试源码 |
| `apps/web-vue` | Vue 3 / TypeScript 界面、ECharts 图表 |
| `deploy/java` | 本地独立 Compose、Nginx 和镜像配置 |
| `scripts/java` | 配置生成、监控、业务备份、支持、冒烟及界面检查 |
| `java-rebuild` | 需求、验收记录、进度与合成测试样例 |

## 仓库与本地文件

源码、数据库迁移、依赖锁文件和 `deploy/java/.env.example` 随仓库提交。实际环境配置
`deploy/java/.env`、`var/` 下的日志与发布包、`.tools/` 下的本地工具，以及
`java-rebuild/evidence/` 下的验证输出和截图保留在本机。文档中的历史证据链接指向
这些本地文件，公开仓库里不包含对应的附件。

## 前端开发

本机已准备好 Java／Node 和依赖时，先打开 Docker Desktop，然后在仓库根目录执行：

```sh
bash scripts/java/dev.sh
```

访问 `http://localhost:5173/`。这个已实测的开发方式使用 Docker 运行 MySQL／Redis，本机运行两个 Java 实例和 Vue。保持启动终端开启；Ctrl+C 停止该脚本启动的应用进程，数据库数据保留。脚本会复用本机已运行的上秤前端。

本地登录只显示模拟验证码，不发短信。请使用合成账号和示例数据。

需要 Node 24 和 pnpm 11.25.0：

```sh
pnpm --dir apps/web-vue install --frozen-lockfile
pnpm --dir apps/web-vue run dev
```

访问 `http://localhost:5173`。接口代理到本机 Java 8080；没有后端时会提示连接失败，不自动使用虚假账号或模拟业务数据。请勿直接双击源码 index.html。

```sh
pnpm --dir apps/web-vue run build
pnpm --dir apps/web-vue run test
```

## Java 检查

需要 Java 21 和网络依赖下载：

```sh
apps/java-api/mvnw -B -f apps/java-api/pom.xml verify
```

真正的集成测试使用 MySQL／Redis 容器。缺 Docker 时本地测试会跳过集成部分；CI 另行检查不允许将跳过算作通过。

## 全容器方式（尚未启动验收）

需要 Docker Compose：

```sh
python3 scripts/java/configure.py
docker compose --env-file deploy/java/.env -f deploy/java/compose.yml up --build -d
```

配置脚本生成私有随机密码，不打印值；已有配置不会覆盖，也不需重复生成。全容器入口规划为 `http://localhost:8088`；本次其镜像构建受 Docker Hub 验证服务连接超时阻塞，当前实际可用入口是开发方式的 `http://localhost:5173/`。仅使用独立合成身份／示例身体数据，`sms-trial` 和生产模式尚未开放。

不要把需求包中原 Node 项目的旧测试结果、界面夹具测试或容器配置文件的存在，视为新 Java 产品已完成的证据。

## 代码格式

代码使用正常的多行排版：Java 缩进 4 个空格，Vue／TypeScript／CSS 缩进 2 个空格。长参数和模板属性分行，多步页面操作写成命名函数。规则见 `.editorconfig`、`.prettierrc.json` 和 `AGENTS.md`。

在根目录安装格式化工具并执行检查：

```sh
pnpm install --frozen-lockfile
pnpm run format
pnpm run format:check
```

已执行的 Flyway 迁移脚本保持原文，避免仅因排版变化造成数据库校验失败。
