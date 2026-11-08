# Java 后端架构与阅读入口

项目采用按业务分包的模块化单体，使用 Java 21、Spring Boot、MyBatis-Plus 和 MySQL。常规调用链为：

```text
HTTP 请求 / 运维命令
    → Controller / Tool：接收输入、处理会话和协议
    → Service：业务规则、权限、事务、结果组装
    → Mapper：MyBatis-Plus 数据访问与定制 SQL
    → MySQL
```

## 各层负责什么

| 层或目录 | 职责 | 当前例子 |
| --- | --- | --- |
| controller、tool | HTTP 参数、Session、命令行参数、调用用例 | RoomController、SupportTool |
| service | 用例编排、业务校验、查询条件、实体组装、事务范围 | UserService、RoomService、SupportService |
| mapper | 继承 BaseMapper、绑定参数、执行定制 SQL、映射查询结果 | UserMapper、MemberMapper、WeightRecordMapper |
| entity | 可写数据库表映射、主键策略、数据库生成字段策略 | UserEntity、RoomEntity、MemberEntity |
| model | 内部业务数据、认证信息和不可变查询投影 | User、Room、Member、Otp、StoredResult |
| dto | 请求与响应契约，控制对外暴露字段 | RoomRequests、RoomResponses、SystemResponses |
| journal | 独立删除日志的连接、锁、持久化与重放 | PrivacyJournal、JournalMapper |
| common | 共享错误、HTTP 基础设施、幂等事务等机制 | Problem、Errors、Mutations |
| domain | 无外部依赖的日期、体重、统计和排名计算 | Domain |

Service 直接使用 Mapper。普通增删改查通过 `BaseMapper` 和 Lambda 条件构造器完成，行锁、原子递增、条件覆盖、upsert、多表投影和复合主键操作使用 Mapper 注解 SQL，参数使用 `#{...}` 绑定。多个 Mapper 可以参加同一个 Spring 事务。

这次删除了 UserRepository、LoginRepository、RoomRepository、SupportRepository、ExportRepository、HealthRepository、IdempotencyRepository，完成调用方迁移。有用的实体组装和更新逻辑归入对应 Service，单纯转调 Mapper 的方法随重复层一起删除。当前 Service 使用具体类和构造器注入；多个业务实现出现后再引入相应接口。

## 目录怎么读

```text
team/shangcheng/
├── Application.java
├── identity/
│   ├── controller/      登录、个人资料接口
│   ├── service/         AuthService、RateLimitService、UserService
│   ├── mapper/          UserMapper、LoginMapper
│   ├── entity/          UserEntity
│   ├── model/           User、Otp、RateLimit
│   ├── dto/             请求与响应
│   ├── web/             SessionIdentity
│   └── PnvsClient.java  尚未开放真实短信流程的供应商适配器
├── room/
│   ├── controller/      小组、邀请接口
│   ├── service/
│   │   ├── RoomApplicationService  小组写用例的幂等与事务编排
│   │   ├── RoomService             小组生命周期、成员、准备和开始规则
│   │   ├── WeightRecordService     体重记录、版本校验与覆盖确认
│   │   ├── ReminderService         提示查询、领取和重放时效校验
│   │   └── RoomQueryService        快照、统计和历史结果组装
│   ├── mapper/
│   │   ├── RoomMapper             小组与历史投影
│   │   ├── MemberMapper           成员与资料投影
│   │   ├── ActiveMembershipMapper 当前成员关系
│   │   ├── WeightRecordMapper     体重记录
│   │   ├── StartPreviewMapper     开始预览授权
│   │   └── ReminderReceiptMapper  提示回执
│   ├── entity/          RoomEntity、MemberEntity、ActiveMembershipEntity
│   ├── model/           Room、Member、StartPreview、WeightRecord
│   ├── dto/             请求与响应
│   └── web/             RoomExpiryAdvice：请求前执行到期检查
├── support/
│   ├── controller/、service/、mapper/、entity/、dto/
│   └── SupportTool.java 支持工单运维入口，调用 SupportService
├── privacy/
│   ├── controller/、service/、dto/
│   ├── mapper/          业务库的数据导出和隐私删除
│   └── journal/         独立日志库的 Mapper 和生命周期管理
├── system/
│   └── controller/、service/、mapper/、dto/
├── domain/Domain.java
└── common/
    ├── config/          SecurityConfig
    ├── web/             RequestFilter、Errors、Envelope
    ├── idempotency/     幂等 Mapper 与 StoredResult 投影
    ├── dto/             共享响应契约
    ├── Mutations.java   共享幂等事务执行器
    ├── Problem.java     业务异常
    ├── Input.java       严格请求类型校验
    └── ResponseDetails.java 错误详情等小型动态结构
```

## 小组 Service 为什么分开

复杂的小组写流程由 `RoomApplicationService` 负责组织幂等事务，再调用对应业务服务。`RoomService` 管理小组和成员生命周期，`WeightRecordService` 管理记录写入，`ReminderService` 管理提示，`RoomQueryService` 组装快照和统计。它们位于同一 Service 层，分别承担具体职责。

身份资料和工单的写流程较短，由各自 Service 直接使用 `Mutations`。读查询直接访问对应业务服务。该项目保持单个后端部署单元。

## 第一条阅读路径：查看个人资料

1. [UserController](src/main/java/team/shangcheng/identity/controller/UserController.java)：HTTP 入口。
2. [SessionIdentity](src/main/java/team/shangcheng/identity/web/SessionIdentity.java)：读取会话，检查过期与账号状态。
3. [UserService](src/main/java/team/shangcheng/identity/service/UserService.java)：调用 Mapper，将表实体转换为内部 User，组装脱敏后的响应。
4. [UserMapper](src/main/java/team/shangcheng/identity/mapper/UserMapper.java) 和 [UserEntity](src/main/java/team/shangcheng/identity/entity/UserEntity.java)：BaseMapper 与数据库表映射。
5. [IdentityResponses](src/main/java/team/shangcheng/identity/dto/IdentityResponses.java)：前端可见字段。

数据库实体仅用于内部访问，Controller 返回响应 DTO。共享小组快照不包含成员身高，数据导出仅查询本人数据。

## 第二条阅读路径：保存体重

```text
RoomController.saveRecord
    → RoomApplicationService.save
    → Mutations.run：开启事务、锁用户、校验权限、查幂等记录
    → RoomRequests.SaveRecord：解析明确的请求类型
    → WeightRecordService.save：检查同意状态、小组、日期、版本与覆盖确认
    → Domain.weight：单位换算、范围校验与舍入
    → WeightRecordMapper：锁记录并写入
    → RoomMapper：增加小组版本
    → IdempotencyMapper：保存本次结果
    → 提交同一个事务
    → Envelope：补充本次 HTTP 请求的 requestId
```

**用户锁、权限检查、业务写入、幂等结果必须在同一个事务中。** `Mutations` 使用 TransactionTemplate 创建这条事务边界。小组核心写方法、体重记录写入和提示领取使用 `Propagation.MANDATORY`，通过 Spring 代理调用时要求已有事务。小组开始预览和到期检查有各自的事务。

幂等命中时先重新校验权限，再将保存的 JSON 还原为对应响应 DTO。提示重放还会重新检查日期和记录状态。登录限流与验证码尝试计数保留各自既有提交语义。

## 请求边界与严格校验

需要幂等的接口保留原始 JsonNode，在应用服务内计算规范化摘要、检查重放，然后通过 RoomRequests、IdentityRequests 转为明确类型。这样可以保留数字字符串拒绝、缺失字段与默认值、旧接口别名等契约。核心业务使用解析后的请求对象。

## 独立删除日志

[PrivacyJournal](src/main/java/team/shangcheng/privacy/journal/PrivacyJournal.java) 管理专用 MyBatis-Plus 会话工厂，JournalMapper 仅注册到独立日志库。获取命名锁的会话覆盖请求执行，并在关闭前通过同一连接释放锁。

删除事件先自动提交到独立库，再在业务事务中完成数据清理和重放游标更新。旧业务快照恢复后，最新独立日志可以重新执行删除。业务库与日志库均使用语句级本地缓存。这里保留的是有独立资源与一致性职责的基础设施组件。

## Lombok 使用约定

后端使用 Lombok 减少重复代码，版本由 Spring Boot 父工程管理。Maven 已显式配置注解处理器，Lombok 不打入应用运行包。

- 数据库实体使用 `@Getter`、`@Setter`，保留原有字段类型、无参构造和 MyBatis-Plus 映射注解。
- 仅对依赖字段赋值的构造方法使用 `@RequiredArgsConstructor`，依赖保持 `private final`。
- 涉及配置参数注入、事务模板、ObjectMapper 副本、连接池等初始化逻辑的构造方法保持显式实现。
- 日志对象通过 `@Slf4j` 生成，现有日志内容与脱敏规则保持不变。
- 请求、响应和查询投影继续使用 Java `record`；当前实体不使用 `@Data`，避免额外生成包含敏感字段的 `toString` 和改变对象比较语义。按需引入 `@Builder`。

IDE 需要支持 Lombok 并启用注解处理；编译与测试以项目 Maven Wrapper 为准。

## 修改约定

- HTTP 与 Session 操作放 Controller 或 web 组件，命令行参数放 Tool。
- 业务规则、实体组装和事务编排放 Service，定制 SQL 与结果映射放 Mapper。
- Mapper 根据持久化职责拆分，共用查询投影复用同一方法。
- 修改写流程时检查权限、锁顺序、幂等键、事务和重放逻辑。
- 数据库变更使用新 Flyway 迁移，已执行的迁移原文保持不变。
- 修改后执行 `pnpm run format`、`pnpm run format:check`。

## 验证与运行状态

准备 Java 21 和 Docker，在仓库根目录执行：

```sh
apps/java-api/mvnw -B -f apps/java-api/pom.xml verify
pnpm run format:check
```

ApiIntegrationTest 使用独立 MySQL/Redis 测试容器。没有 Docker 时该类会跳过，CI 检查它实际执行。构建后的应用需重启才能载入新代码。

本次架构整理的实际验证结果见 [架构整理验证记录](../../java-rebuild/evidence/service-mapper-architecture-2026-10-29.json)。此前的 [MyBatis-Plus 迁移](../../java-rebuild/evidence/mybatis-plus-2026-10-29.json) 和 [分层重构](../../java-rebuild/evidence/architecture-refactor-2026-10-29.json) 记录对应各自阶段。

## Redis 在代码里的位置

当前只有会话和健康检查两处：

- 会话：`identity/web/SessionIdentity.java` 负责写入、读取、过期与撤销；`application.yml` 的 `spring.session.store-type=redis` 决定存储，namespace 为 `shangcheng:java:{mode}:session`。
- 健康检查：`system/service/SystemService.java` 向 Redis 发 PING。
- 限流：`identity/service/RateLimitService.java` 目前用 MySQL 事务与行锁，**没有**使用 Redis。
- Redisson 只有 `pom.xml` 依赖声明，代码中没有任何锁调用。

统计快照缓存、版本键、单飞与降级属规划中的 B9 批次，尚未实现；设计口径见 [11 Redis 使用方案](../../java-rebuild/11-Redis使用方案.md)。

B10 计划新增跨实例事件推送（SSE + Redis Pub/Sub），让队友的改动在 1 秒内到达页面，并把每 5 秒整份快照轮询降为 60 秒版本轮询兜底。设计口径见 [12 实时动态与事件推送](../../java-rebuild/12-实时动态与事件推送.md)。
