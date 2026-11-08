# 03 API 契约（M1兼容目标）

前缀 `/api/v1`；JSON请求／响应；字段保持camelCase。DTO不得直接序列化数据库实体。日期`YYYY-MM-DD`、时间戳ISO UTC或契约指定epoch毫秒。金额无本期需求；重量JSON数值、展示两位。Java须校验类型，不将字符串数字自动当合法业务数值。

## 1. 通用协议

- 所有响应含requestId和X-Request-Id；失败形状 `{error:{code,message,details?},requestId}`，不能改成只有一个通用message。
- 写请求 `Content-Type: application/json`、`X-App-Request: 1`；登录后另带`X-CSRF-Token`。业务写请求使用`Idempotency-Key`，合法正则`^[a-zA-Z0-9_-]{8,100}$`；见04。
- Cookie名保留`cq_session`，或提供明确适配且旧前端无需读Cookie；用户csrf由登录和me返回，前端存内存。Spring内置CSRF令牌获取方式可适配本接口，不暴露sessionId到响应。
- 响应不走公共缓存：Cache-Control:no-store；nosniff、同源Referrer、禁止iframe、CSP仅允许必要同源资源。线上精确Host／Origin，同源请求；不开放任意CORS。转发来源IP只信任受控反代覆盖的头。
- body最大16KiB，只接受JSON对象（非数组／null），非法JSON=400，类型415，过大413。超时有界；不输出SQL、堆栈、供应商原报文。幂等不包括认证发送／核验、登出和注销的普通mutate记录。
- 成功通常200，错误400／401／403／404／409／413／415／429／503／500；requestId不能用于掩盖真实业务错误。

## 2. 端点清单

“幂等”列为需持久业务回执；所有已登录写仍需CSRF，GET不写展示回执。`r=roomId`、`v=version`。

| ID | 方法与路径 | 输入 | 成功响应主字段 | 鉴权／幂等 |
| --- | --- | --- | --- | --- |
| E01 | GET /health | 无 | `{ok,storage,mode}` | 匿名最小健康信息 |
| E02 | GET /config | 无 | `{mode,login,syntheticOnly,realSms?,smsDailyLimit?}` | 匿名，不含凭据 |
| E03 | POST /auth/code | `{phone}` | `{retryAfter,expiresIn:300,deliveryStatus,message,developmentCode?}` | 匿名，限流，无业务幂等 |
| E04 | POST /auth/login | `{phone,code}` | `{user}`，Set-Cookie | 匿名，单次消费，无业务幂等 |
| E05 | POST /auth/test-login | `{code}` | `{user}`，Set-Cookie | 仅test，local/sms-trial为404 |
| E06 | POST /auth/logout | `{}` | `{ok:true}`，清Cookie | 当前会话；无业务幂等 |
| E07 | GET /me | 无 | `{user,today,mode,consentVersion}` | 本人 |
| E08 | POST /me/profile | `{nickname,avatar?,adult?,sensitiveConsent?}` | `{ok:true}` | 本人；幂等operation=profile |
| E09 | PATCH /me | 与E08相同 | 同E08 | 兼容入口；与E08共用回执 |
| E10 | POST /rooms | `{name?,intro?,days,intensity,extremeConfirmed?,sharingConsent:true}` | `{roomId}` | 已同意；幂等 |
| E11 | GET /invites/:code | 无 | `{invite}`，结构见下 | 匿名或可选会话、限流 |
| E12 | POST /invites/:code | LOBBY:`{sharingConsent:true}`；ACTIVE另含`{height,weight,date,version}` | `{roomId}` | 已同意；幂等 |
| E13 | GET /rooms/:r | `?range=7/28/90`默认28 | `{room,members,today,range}` | 当前／历史有效成员 |
| E14 | PATCH /rooms/:r | `{name?,intro?,days,version}` | `{ok:true,needsReconfirmation}` | LOBBY当前owner；幂等 |
| E15 | GET /rooms/:r/preparation | 无 | `{height,weight,target,ready,version}` | 本人、LOBBY |
| E16 | PUT /rooms/:r/preparation | `{height,weight,version}` | `{target,loss,algorithm}` | 本人已同意、LOBBY；幂等 |
| E17 | POST /rooms/:r/leave | `{}` | `{ok:true}` | 本人、LOBBY；幂等 |
| E18 | GET /rooms/:r/start-preview | 无 | `{roomId,name,intro,days,intensity,version,date,endDate,expiresAt}` | LOBBY owner、全员ready且≥2 |
| E19 | POST /rooms/:r/start | `{version,date,expiresAt}` | `{roomId,startDate}` | 同E18；幂等 |
| E20 | PUT /rooms/:r/records | `{date,weight,unit:'kg'/'jin',version,overwrite?}` | `{date,weight,version}` | 本人已同意、ACTIVE；幂等 |
| E21 | GET /rooms/:r/reminders | 无 | `{reminders:[Reminder]}` | 成员；仅预览 |
| E22 | POST /rooms/:r/reminders | `{}` | `{ok:true,date,reminders:[Reminder]}` | 成员；原子领取、幂等 |
| E23 | GET /history | 无 | `{rooms:[{id,name,startDate,days,intensity}]}` | 本人，最新100 |
| E24 | GET /me/export | 无 | `{exportedAt,user,memberships,records}` | 本人；附件my-data.json |
| E25 | POST /support | `{message}` | `{requestId,status:'OPEN'}` | 本人；幂等 |
| E26 | GET /support | 无 | `{requests:[{id,message,status,createdAt}]}` | 本人，最新100 |
| E27 | DELETE /me | `{confirm:'注销并删除我的数据'}` | `{ok:true,deletion:{requestId,onlineStatus:'COMPLETED',backupStatus:'REPLAY_REQUIRED'}}` | 本人；独立删除意图，不走普通业务回执 |

E25的业务requestId与通用请求追踪字段在旧实现中重名，重构处理见08：返回独立supportRequestId并同步新前端，保留HTTP追踪requestId，不把追踪号当工单主键。

## 3. 对象字段

**User**：`id,nickname,avatar,phone,consent,currentRoomId,csrf`。普通phone脱敏为前三后四，中间四星；test身份为“测试身份”。csrf仅本人身份上下文。新账号默认昵称“朋友”+手机号后四，test使用已配置合成昵称。`me.mode`旧值可为development/provider/test，`config.mode`为local/test/sms-trial，两者不可混用。

**Invite**两种返回互斥：有效会话且仍在该期为JOINED时，仅`{code,memberRoomId}`；其他人返回`{code,name,intro,days,intensity,status,count,remaining,joinable,today,version}`。不存在／取消／对非成员结束均404 INVITE_INVALID。匿名带失效会话应按匿名看公开邀请，不能强制先登录。已拥有其他当前组的前端先回当前组，不靠加入失败分流。

**Room**：`id,name,intro,days,intensity,status,ownerId,inviteCode,version,startDate,endDate,remaining`。startDate/endDate在LOBBY为null；remaining含今天，LOBBY为days，已结束为0。结束自动释放currentRoomId，不删历史成员。

**Member**：`id`（用户ID）、`memberId`（本次关系ID）、`nickname,avatar,ready,startWeight,target,algorithm,joined_order,joinDate,records,summary,missingDays`；不含height／phone／csrf。LOBBY summary=null，joinDate=null；未准备时target等可null。ENDED另有`rank,periodSummary`，排序按全期覆盖率。保留`joined_order`现字段以兼容。

**Record**：`{date,weight,version}`，weight规范kg，不带伪造backfill。

**Summary**：`{start,anchor,count,denominator,coverage,first,latest,change,rows}`：first为本期首条kg或null，latest为截至anchor最后Record或null；change需至少两条实际记录；rows为区间Record加`change,percent`。没有记录rows=[]、count=0、first/latest/change=null；denominator有效时coverage=0，否则null。周期排名使用periodSummary，不能覆盖所选summary。

**Reminder**：`{memberId,nickname,round,stage,missingDays}`；POST另含业务date，回执重放要重新过滤过期提示，不返回已删除成员信息。

**Export**：user为本人`id,nickname,avatar,phone`（此处可完整本人手机号）；memberships为本人`room_id,join_date,state,height,start_weight,target,algorithm`；records为本人`room_id,date,weight,version`。现有导出snake_case可保留，不要求为了内部风格改变下载文件。

## 4. 错误协议

| 分类 | code及状态 | 前端处理 |
| --- | --- | --- |
| 输入 | VALIDATION 400、CONTENT_TYPE 415、BODY_TOO_LARGE 413、INVALID_JSON 400 | 字段或表单提示，保留输入 |
| 身份 | UNAUTHENTICATED 401、CSRF_REJECTED 403 | 清私有状态、重新登录；不能重放旧账号请求 |
| 访问 | FORBIDDEN 403、CONSENT_REQUIRED 403、HOST_REJECTED 403 | 不泄露对象；引导确认或回首页 |
| 幂等 | IDEMPOTENCY_REQUIRED 400、IDEMPOTENCY_CONFLICT 409 | 补合法键；不同参数不可复用旧键 |
| 当前组 | ALREADY_IN_ROOM 409、ROOM_FULL 409、JOIN_WINDOW_CLOSED 409、INVITE_INVALID 404 | 回当前组或解释不能加入 |
| 状态 | ROOM_LOCKED 409、NOT_READY 409、EXTREME_CONFIRMATION 400 | 保持表单，重新读取最新状态 |
| 版本 | VERSION_CONFLICT 409，记录时details.latest=`{weight,version}`或null | 先展示最新值再确认 |
| 日期 | BUSINESS_DATE_CHANGED 409，details.today | 保留值，更新日期，用户重新提交 |
| 预览 | PREVIEW_STALE 409、INVITE_CHANGED 409 | 重新读取信息，显式确认 |
| 覆盖 | OVERWRITE_REQUIRED 409 | 前后值确认 |
| 验证码 | INVALID_CODE 401、AUTH_IN_PROGRESS 409、RATE_LIMITED 429 | 不当成普通身份失效清掉整个登录表单；有retryAfter按其倒计时 |
| 短信 | SMS_UNAVAILABLE／SMS_DELIVERY_UNKNOWN／SMS_VERIFICATION_UNAVAILABLE／SMS_BALANCE_INSUFFICIENT 503 | 保留专用错误及retryAfter，不转为记录保存未知 |
| 环境 | TEST_LOGIN_ONLY 403、NOT_FOUND 404、METHOD_NOT_ALLOWED 405 | 模式或路由提示，不泄露配置 |
| 注销 | CONFIRM_REQUIRED 400 | 核对文字 |
| 未知 | INTERNAL_ERROR 500／网络或响应不可解析 | 写操作核对原请求；不假报成功 |

Spring默认认证跳转HTML、校验异常500、SQL异常正文都不符合该契约，需要统一映射。框架服务不可用允许新增DEPENDENCY_UNAVAILABLE 503，并在契约和测试记录；不得降级成匿名放行。

## 5. 可执行契约交付

B1输出OpenAPI（路由、DTO、约束、错误、鉴权），B2–B6逐步补齐全部E01–E27。对照本表检查每个端点，给出请求样例及成功／错误集成测试。Java先与旧网页验证业务路径，不仅验证Swagger能调用；新Vue完成后验证实际浏览器链路。

## 6. 后续批次新增端点

以下端点不属于 M1 契约，B9／B10 实施时另行补进 OpenAPI，并按 [06 验收矩阵](06-验收矩阵.md) 的 P／R 条目验收：

- `GET /rooms/:id/version`：只读版本探测，返回 `{dataVersion,businessDate,status}`，供前端降级轮询；不依赖 HTTP 缓存，客户端自行比较版本号。
- `GET /rooms/:id/events`：SSE 事件流，`text/event-stream`，事件名 `ready`／`change`／`ping`／`degraded`；先鉴权再建立连接。

契约与语义见 [12 实时动态与事件推送](12-实时动态与事件推送.md)。
