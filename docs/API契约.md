# 上秤 · 本地基础版 API 契约 v0.1

2026-10-13。此契约描述当前实现，不代替尚未冻结的生产规则。

同源 `/api/v1`，JSON，请求／响应不缓存。失败返回 `{error:{code,message,details?},requestId}`。所有写请求带 `Content-Type: application/json`、`X-App-Request: 1`；已登录写请求另带 `X-CSRF-Token`。来源须与本机服务同源。响应设置 CSP、nosniff、禁止嵌入、no-store。

会话采用 HttpOnly、SameSite=Strict Cookie，7 天有效；令牌只保存哈希；退出撤销当前会话。本地模式为 loopback HTTP；合成数据联机模式通过精确 HTTPS origin 访问，Cookie 带 Secure，Nginx 反代本机端口。浏览器不存身体数据或登录令牌到 localStorage，不导入原型数据。

联机测试补充：匿名 `GET /config` 只返回运行模式、登录方式和 `syntheticOnly`，不返回体验码／摘要。`POST /auth/test-login` 接收 `{code}`，24 位随机体验码匹配服务器已签发摘要，返回普通用户会话；同一码恢复同一测试身份，不存真实手机号。该接口仅测试模式可用，本地返回 404；测试模式的 `/auth/code`、`/auth/login` 返回 `TEST_LOGIN_ONLY`，不能泄露开发短信码。主机、来源校验按配置的精确 HTTPS origin；只有来自回环反向代理且格式有效的单个 `X-Forwarded-For` 才作为限流 IP，Nginx 覆盖用户传入值。

| 方法与路径 | 请求／结果要点 |
| --- | --- |
| `GET /health` | 进程及数据库健康 |
| `POST /auth/code` | `{phone}`；6 位、5 分钟、60 秒冷却、手机号及来源限流。返回 `deliveryStatus: DEVELOPMENT或ACCEPTED`；仅开发模式返回 developmentCode，ACCEPTED 只表示供应商受理 |
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
| `DELETE /me` | `{confirm:'注销并删除我的数据'}`；先持久记录独立删除清单，再事务删除账号、会话、准备、记录、回执、本人及相关提醒幂等结果和支持请求；返回 `deletion:{requestId,onlineStatus:'COMPLETED',backupStatus:'REPLAY_REQUIRED'}` |

业务写入（个人资料、小组、准备、开始、记录、支持、提醒回执）使用 `Idempotency-Key`，8–100 位字母数字、下划线或连字符。客户端同参数未知结果重试保留同键。服务端在 SQLite `BEGIN IMMEDIATE` 中校验、写入并保存结果；同键不同操作／参数返回 `IDEMPOTENCY_CONFLICT`。身份与成员访问检查先于重放。退出、撤权后不能读取原小组结果。

常见状态码：401 未登录／验证码无效；403 年龄／同意／对象授权／来源拒绝；409 版本冲突、已有未结束小组、开营条件变化、日期变化或已锁定；429 限流。跨日用 `BUSINESS_DATE_CHANGED`，多设备覆盖用 `VERSION_CONFLICT`，开始预览变化用 `PREVIEW_STALE`。客户端保留输入，刷新权威信息后要求再次确认。

2026-10-14 稳定性补充：请求超时／连接失败、响应 JSON 丢失或损坏、5xx 均不能据此认定写入失败；客户端保留原参数对应的幂等键，直到获取确定结果。记录页以「核对保存结果」显式重试，不自动覆盖新版本或把昨日请求改为今日。已成功写入后的读取失败不改变保存成功状态。HTTP 在完整读取请求内容后再次执行到期检查，避免缓慢上传跨截止时间延长写权限；会话／对象授权仍在执行接口前检查。旧会话的迟到响应不得改变新会话界面或删除新请求编号。

日期为服务端 `Asia/Shanghai`，时间戳 UTC；存储日期 `YYYY-MM-DD`。结束区间为 `[开始日, 开始日+N天)`；实际开始前和截止瞬间起拒绝写入。接口进入时即时到期判定，30 秒后台任务辅助持久化，任务停机不能延长记录权限。

目标采用 `bmi22-piecewise-v1`：BMI／22 修正取 0.75–1.25；四档 0.02／0.03／0.04／0.05；时间节点 14→0.6、28→1、56→1.8、90→2.6，分段线性。最终目标两位小数，中间不舍入。

统计基准为本期首条有效记录。覆盖率分母从区间、本期开始和本人加入日的最晚者至不晚于结束日的锚点，均包含当天；覆盖率展示两位。全期排名按整数交叉相乘比较。同点及缺失日不虚构趋势。2026-10-14 用户确认保留当前目标算法，不增加起始／目标低 BMI 拦截、目标截断或仅记录模式；现有输入技术校验保持。字段正式范围及保留期限仍需冻结。

## 2026-10-14 短信与删除恢复补充

验证码状态为 `PENDING → ACCEPTED／FAILED／UNKNOWN`，开发模式直接为 `DEVELOPMENT`。只有 ACCEPTED／DEVELOPMENT 可以验证；投递器必须显式返回 `{status:'ACCEPTED'}`，空结果不能表示成功。服务层默认 8 秒超时并取消请求，不自动重发；明确拒绝返回 `SMS_UNAVAILABLE`，网络、无效响应或超时返回 `SMS_DELIVERY_UNKNOWN`。失败仍保留冷却；过期清理、遗留 PENDING 转 UNKNOWN 和 dispatch_id 条件更新防止迟到结果影响新码。缺少适配器时不创建 OTP。阿里云适配器已实现，但运行模式仍只有 local／test；环境变量不自动开启真实短信或正式上线。

`scripts/sms-check.mjs` 是离线配置检查，不是业务 API；只返回字段名与问题，不输出值，不联网／发送／打开数据库。配置齐全返回退出码 0，缺项／格式无效为 1；即使 `ok:true` 仍标明 `scope:CONFIGURATION_ONLY`、`deliveryVerified:false`。预检与适配器共用配置校验，官方 ACS3 固定样例通过不代替真实供应商验签。

结构版本 2 增加发送状态和删除清单元信息。首次从版本 1 升级保留账号及记录、作废旧验证码。独立清单保存随机账号 ID、事件 ID、时间和序号，无手机号或身体数值；默认是业务库旁的 `.deletions.sqlite` 文件，不能随快照回退。启动先按清单完成未执行的账号注销，再提供接口；清单缺失、身份不符或已知序号落后时拒绝启动。恢复工具在隔离副本里用最新独立清单重放，再启动业务读取；清单以只读方式打开。

`onlineStatus:COMPLETED` 是在线逻辑清除完成，不表示旧备份已物理淘汰。备份期限、加密／密钥与独立清单异地持久化仍待落实；目前仅实现账号注销的重放，某期删除尚未纳入已实现接口。用户已决定不设计独立撤回共享，不新增相应路由／成员状态。

## 2026-10-15 PNVS 短信认证补充

`SMS_PROVIDER=aliyun-pnvs` 使用独立认证接口，数字模板如 `100001`。发送接口通过 `TemplateParam:{code:'##code##',min:'5'}` 交给平台生成六位数字，`ReturnVerifyCode=false`、`ValidTime=300`、`DuplicatePolicy=1`、`Interval=60`、`AutoRetry=0`。普通短信仍保留本地随机码／哈希核验；两种模式不混用。PNVS 在原有 `code_hash` 列保存 `pnvs:<dispatch_id>` 核验方式标记，不保存真实码或其哈希，结构版本仍为 2；适配缺失时不回退为本地核验；PNVS 拒绝旧开发／普通短信码，非开发模式拒绝 DEVELOPMENT 状态。

投递函数带 `verifyCode({phone,code,dispatchId,signal})`；发送／核验传相同 OutId，并检查回传值。核验返回 `{status:'PASS'}` 或 `{status:'INVALID'}`；只有成功调用且 `Model.VerifyResult=PASS` 表示验证通过，供应商 UNKNOWN 对应无效码。服务层和 HTTP 等待远程核验，匹配当前 dispatch_id、有效期及 ACCEPTED 后，在事务中单次删除 OTP 并签发会话；远程等待不占数据库事务。

同一服务实例中，每个手机号只允许一个核验请求，核验期间重复核验或重发返回 `AUTH_IN_PROGRESS`（409），不额外消耗验证码尝试次数。五次无效码后拒绝核验；过期、删除或新流水号不能消费旧结果。供应商报错、格式异常、网络及超时（默认 8 秒）返回脱敏 `SMS_VERIFICATION_UNAVAILABLE`（503），本次 OTP 置 UNKNOWN 并要求重新获取；迟到成功不能复活会话。账号／会话只在最终成功事务内创建。当前仍是单进程实现，公开多实例运行前需持久核验租约。

离线检查同时支持普通短信和 PNVS 各自模板格式，不联网／发短信／输出值／打开数据库。配齐也不自动启用真实服务；`loadRuntime` 继续只允许既有 local／test 配置。

## 下一阶段规划（尚未完成）

开发入口见[真实试用推进方案](真实试用推进方案.md)。用户已开通 PNVS 并保存私有配置，离线预检与隔离适配测试通过；真实供应商验签／短信收发、正式运行准入、保留策略以及是否提供按范围删除仍待落实。独立撤回共享已从本期范围移除，现有成员／共享规则不变，暂不开自动清理。
