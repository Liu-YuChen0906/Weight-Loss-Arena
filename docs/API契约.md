# 本地基础版 API 契约 v0.1

2026-10-13。此契约描述当前实现，不代替尚未冻结的生产规则。

同源 `/api/v1`，JSON，请求／响应不缓存。失败返回 `{error:{code,message,details?},requestId}`。所有写请求带 `Content-Type: application/json`、`X-App-Request: 1`；已登录写请求另带 `X-CSRF-Token`。来源须与本机服务同源。响应设置 CSP、nosniff、禁止嵌入、no-store。

会话采用 HttpOnly、SameSite=Strict Cookie，7 天有效；令牌只保存哈希；退出撤销当前会话。本地模式为 loopback HTTP；合成数据联机模式通过精确 HTTPS origin 访问，Cookie 带 Secure，Nginx 反代本机端口。浏览器不存身体数据或登录令牌到 localStorage，不导入原型数据。

联机测试补充：匿名 `GET /config` 只返回运行模式、登录方式和 `syntheticOnly`，不返回体验码／摘要。`POST /auth/test-login` 接收 `{code}`，24 位随机体验码匹配服务器已签发摘要，返回普通用户会话；同一码恢复同一测试身份，不存真实手机号。该接口仅测试模式可用，本地返回 404；测试模式的 `/auth/code`、`/auth/login` 返回 `TEST_LOGIN_ONLY`，不能泄露开发短信码。主机、来源校验按配置的精确 HTTPS origin；只有来自回环反向代理且格式有效的单个 `X-Forwarded-For` 才作为限流 IP，Nginx 覆盖用户传入值。

| 方法与路径 | 请求／结果要点 |
| --- | --- |
| `GET /health` | 进程及数据库健康 |
| `POST /auth/code` | `{phone}`；6 位、5 分钟、60 秒冷却、手机号及来源限流。本地返回明确标注的 developmentCode；供应商适配接口不返回此字段 |
| `POST /auth/login` | `{phone,code}`；一次使用、最多 5 次尝试，返回当前用户及 CSRF，签发 Cookie |
| `POST /auth/logout` | 撤销当前会话 |
| `GET /me` | 脱敏手机号、稳定用户 ID、昵称、同意状态、当前小组、服务端日期 |
| `PATCH /me` | `{nickname,adult:true,sensitiveConsent:true}`；保存同意文本版本及时间 |
| `POST /rooms` | `{name,intro,days,intensity,extremeConfirmed?,sharingConsent:true}`；确认提交才建房 |
| `GET /invites/:code` | 只返回名称、介绍、人数、周期、强度、状态、剩余天数及版本，无身体数据 |
| `POST /invites/:code` | 组队阶段只需共享确认；进行中另需 `{height,weight,date,version}`，加入与准备原子提交 |
| `GET /rooms/:id?range=7或28` | 成员 ID、目标、起始体重、原始记录及规范统计；无身高。结束期另有全期 periodSummary 与并列排名 |
| `GET /rooms/:id/preparation` | 仅本人、仅开营前的私有编辑字段 |
| `PUT /rooms/:id/preparation` | `{height,weight,version}`；服务端计算权威目标 |
| `PATCH /rooms/:id` | `{name,intro,days,version}`；当前开始权限持有人、仅开营前。周期变化清除准备状态和旧目标，保留私有输入 |
| `POST /rooms/:id/leave` | 仅组队阶段；撤销关系、释放账号名额、必要时交接；空组关闭 |
| `GET /rooms/:id/start-preview` | 最新名称、周期、强度、起止日、房间版本、2 分钟失效时间 |
| `POST /rooms/:id/start` | `{date,version,expiresAt}`；重新校验日期、版本、全员准备及权限 |
| `PUT /rooms/:id/records` | `{date,weight,unit:'kg'或'jin',version,overwrite?}`；服务端当天、每人每日唯一，首次 version=0 |
| `GET /rooms/:id/reminders` | 当前轮最新有效未展示提示；不在 GET 中消费 |
| `POST /rooms/:id/reminders` | 原子领取当前可展示提示并保存回执；仅返回成功领取的条目，避免两设备先读后展示竞态；未知结果用同键重试 |
| `GET /history` | 本人有效参与过的结束期，最新 100 期；更大历史量分页待补 |
| `GET /me/export` | 只取回本人的资料、准备输入和记录 |
| `POST /support`、`GET /support` | 创建／查看本人支持请求，正文最多 1000 字；本地工具处理 |
| `DELETE /me` | `{confirm:'注销并删除我的数据'}`；事务删除账号、会话、准备、记录、回执、幂等结果和支持请求，重算可见小组数据 |

业务写入（个人资料、小组、准备、开始、记录、支持、提醒回执）使用 `Idempotency-Key`，8–100 位字母数字、下划线或连字符。客户端同参数未知结果重试保留同键。服务端在 SQLite `BEGIN IMMEDIATE` 中校验、写入并保存结果；同键不同操作／参数返回 `IDEMPOTENCY_CONFLICT`。身份与成员访问检查先于重放。退出、撤权后不能读取原小组结果。

常见状态码：401 未登录／验证码无效；403 年龄／同意／对象授权／来源拒绝；409 版本冲突、已有未结束小组、开营条件变化、日期变化或已锁定；429 限流。跨日用 `BUSINESS_DATE_CHANGED`，多设备覆盖用 `VERSION_CONFLICT`，开始预览变化用 `PREVIEW_STALE`。客户端保留输入，刷新权威信息后要求再次确认。

2026-10-14 稳定性补充：请求超时／连接失败、响应 JSON 丢失或损坏、5xx 均不能据此认定写入失败；客户端保留原参数对应的幂等键，直到获取确定结果。记录页以「核对保存结果」显式重试，不自动覆盖新版本或把昨日请求改为今日。已成功写入后的读取失败不改变保存成功状态。HTTP 在完整读取请求内容后再次执行到期检查，避免缓慢上传跨截止时间延长写权限；会话／对象授权仍在执行接口前检查。旧会话的迟到响应不得改变新会话界面或删除新请求编号。

日期为服务端 `Asia/Shanghai`，时间戳 UTC；存储日期 `YYYY-MM-DD`。结束区间为 `[开始日, 开始日+N天)`；实际开始前和截止瞬间起拒绝写入。接口进入时即时到期判定，30 秒后台任务辅助持久化，任务停机不能延长记录权限。

目标采用 `bmi22-piecewise-v1`：BMI／22 修正取 0.75–1.25；四档 0.02／0.03／0.04／0.05；时间节点 14→0.6、28→1、56→1.8、90→2.6，分段线性。最终目标两位小数，中间不舍入。

统计基准为本期首条有效记录。覆盖率分母从区间、本期开始和本人加入日的最晚者至不晚于结束日的锚点，均包含当天；覆盖率展示两位。全期排名按整数交叉相乘比较。同点及缺失日不虚构趋势。算法与字段上限只是本地开发行为，低 BMI 配套政策、正式范围、保留期限仍需冻结。
