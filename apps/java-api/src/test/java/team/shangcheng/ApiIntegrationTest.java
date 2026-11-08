package team.shangcheng;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/** Genuine MySQL + Redis integration; never substitute H2 when Docker is absent. */
@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ApiIntegrationTest {

    @Container
    static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.4.7")
        .withDatabaseName("shangcheng_java_test")
        .withUsername("shangcheng")
        .withPassword("synthetic-integration");

    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>(
        "redis:7.4.6-alpine"
    ).withExposedPorts(6379);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry p) throws Exception {
        String main = MYSQL.getJdbcUrl();
        try (
            var c = DriverManager.getConnection(main, "root", MYSQL.getPassword());
            var s = c.createStatement();
        ) {
            s.execute("CREATE DATABASE IF NOT EXISTS shangcheng_java_journal");
            s.execute(
                "CREATE TABLE IF NOT EXISTS shangcheng_java_journal.identity(id INT PRIMARY KEY,journal_id VARCHAR(36) NOT NULL)"
            );
            s.execute("INSERT IGNORE INTO shangcheng_java_journal.identity VALUES(1,UUID())");
            s.execute(
                "CREATE TABLE IF NOT EXISTS shangcheng_java_journal.events(sequence BIGINT AUTO_INCREMENT PRIMARY KEY,event_id VARCHAR(36) UNIQUE,user_id VARCHAR(36),created_at TIMESTAMP(6))"
            );
        }
        p.add("spring.datasource.url", () -> main);
        p.add("spring.datasource.username", () -> "root");
        p.add("spring.datasource.password", MYSQL::getPassword);
        p.add("JOURNAL_DB_URL", () ->
            main.replace("/shangcheng_java_test", "/shangcheng_java_journal")
        );
        p.add("JOURNAL_DB_USER", () -> "root");
        p.add("JOURNAL_DB_PASSWORD", MYSQL::getPassword);
        p.add("DB_PASSWORD", MYSQL::getPassword);
        p.add("spring.data.redis.host", REDIS::getHost);
        p.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
        p.add("app.origin", () -> "http://localhost:5173");
    }

    @LocalServerPort
    int port;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.room.mapper.RoomMapper roomMapper;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.identity.mapper.LoginMapper loginMapper;

    @Test
    void smsQuotaAndLeasePreventOverspendingAndCodeReplay() {
        var day = java.time.LocalDate.of(2000, 1, 1);
        loginMapper.initializeSmsBudget(day);
        assertEquals(1, loginMapper.spendSmsBudget(day, 1));
        assertEquals(0, loginMapper.spendSmsBudget(day, 1));

        var now = java.time.Instant.parse("2026-01-01T00:00:00Z");
        String phone = "13900009711";
        String dispatch = UUID.randomUUID().toString();
        String lease = UUID.randomUUID().toString();
        try {
            assertEquals(1, loginMapper.insertSms(phone, dispatch, now.plusSeconds(300), now));
            assertEquals(1, loginMapper.finishSms(phone, dispatch, "ACCEPTED"));
            assertEquals(1, loginMapper.leaseSms(phone, dispatch, lease, now, now.plusSeconds(25)));
            assertEquals(
                0,
                loginMapper.leaseSms(phone, dispatch, "other", now, now.plusSeconds(25))
            );
            assertEquals(0, loginMapper.consumeSms(phone, dispatch, "other", now));
            assertEquals(1, loginMapper.consumeSms(phone, dispatch, lease, now));
            assertEquals(0, loginMapper.consumeSms(phone, dispatch, lease, now));
        } finally {
            loginMapper.deleteOtp(phone);
        }
    }

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.room.mapper.MemberMapper memberMapper;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.identity.service.UserService users;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.identity.mapper.UserMapper userMapper;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.common.idempotency.mapper.IdempotencyMapper idempotency;

    @org.springframework.beans.factory.annotation.Autowired
    org.springframework.transaction.PlatformTransactionManager transactionManager;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.privacy.journal.PrivacyJournal privacyJournal;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.privacy.mapper.PrivacyMapper privacyMapper;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.room.service.WeightRecordService weightRecords;

    @org.springframework.beans.factory.annotation.Autowired
    team.shangcheng.room.service.ReminderService reminders;

    @Test
    void businessWritersRequireTheApplicationTransaction() {
        assertThrows(org.springframework.transaction.IllegalTransactionStateException.class, () ->
            weightRecords.save("unused-room", "unused-user", null)
        );
        assertThrows(org.springframework.transaction.IllegalTransactionStateException.class, () ->
            reminders.claim("unused-room", "unused-user")
        );
    }

    @Test
    void mybatisWritesAndIdempotencyShareRollback() {
        String userId = UUID.randomUUID().toString();
        String roomId = UUID.randomUUID().toString();
        var now = java.time.Instant.now();
        var transaction = new org.springframework.transaction.support.TransactionTemplate(
            transactionManager
        );
        transaction.executeWithoutResult(status -> {
            insertUser(userId, "synthetic-" + userId, "事务测试", now);
            var room = new team.shangcheng.room.entity.RoomEntity();
            room.setId(roomId);
            room.setName("事务测试");
            room.setIntro("");
            room.setDays(14);
            room.setIntensity("低");
            room.setStatus("LOBBY");
            room.setOwnerId(userId);
            room.setInviteCode(UUID.randomUUID().toString().substring(0, 12));
            room.setCreatedAt(now);
            roomMapper.insert(room);
            assertEquals(userId, idempotency.lockUser(userId));
            idempotency.insert(userId, "rollback-key", "profile", "a".repeat(64), "{}", now);
            userMapper.update(
                new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<
                    team.shangcheng.identity.entity.UserEntity
                >()
                    .eq(team.shangcheng.identity.entity.UserEntity::getId, userId)
                    .set(team.shangcheng.identity.entity.UserEntity::getNickname, "已修改")
            );
            assertEquals("已修改", users.findById(userId).nickname());
            assertNotNull(roomMapper.findRoom(roomId, true));
            assertNotNull(idempotency.find(userId, "rollback-key"));
            status.setRollbackOnly();
        });
        assertNull(users.findById(userId));
        assertNull(roomMapper.findRoom(roomId, false));
        assertNull(idempotency.find(userId, "rollback-key"));
    }

    @Test
    void privacyGateIsHeldOnOneConnectionAndReleased() throws Exception {
        try (
            var observer = DriverManager.getConnection(
                MYSQL.getJdbcUrl(),
                "root",
                MYSQL.getPassword()
            );
            var statement = observer.createStatement();
        ) {
            for (int attempt = 0; attempt < 2; attempt++) {
                try (var gate = privacyJournal.enter()) {
                    try (
                        var result = statement.executeQuery(
                            "SELECT IS_USED_LOCK('shangcheng_java_privacy_gate')"
                        );
                    ) {
                        assertTrue(result.next());
                        assertNotNull(result.getObject(1));
                    }
                }
                try (
                    var result = statement.executeQuery(
                        "SELECT IS_USED_LOCK('shangcheng_java_privacy_gate')"
                    );
                ) {
                    assertTrue(result.next());
                    assertNull(result.getObject(1));
                }
            }
        }
    }

    @Test
    void durableJournalReplaysDeletionAfterBusinessSnapshotRollsBack() {
        String userId = UUID.randomUUID().toString();
        String phone = "synthetic-" + userId;
        try (var gate = privacyJournal.enter()) {
            long beforeDeletion = privacyMapper.meta().lastSequence();
            insertUser(userId, phone, "恢复测试", java.time.Instant.now());
            privacyJournal.delete(userId);
            assertNull(users.findById(userId));
            // Simulate an old business snapshot resurrecting the account and its replay cursor.
            insertUser(userId, phone, "旧快照", java.time.Instant.now());
            privacyMapper.advance(beforeDeletion);
            assertNotNull(users.findById(userId));
        }
        try (var gate = privacyJournal.enter()) {
            assertNull(users.findById(userId));
        }
    }

    final ObjectMapper json = new ObjectMapper();

    class Client {

        final HttpClient http = HttpClient.newBuilder()
            .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
            .build();
        String csrf = "";

        HttpResponse<String> call(String method, String path, Object body, String key)
            throws Exception {
            var b = HttpRequest.newBuilder(
                URI.create("http://localhost:" + port + "/api/v1" + path)
            );
            if (!method.equals("GET")) {
                b
                    .header("Content-Type", "application/json")
                    .header("X-App-Request", "1")
                    .header("Origin", "http://localhost:5173");
                if (!csrf.isBlank()) b.header("X-CSRF-Token", csrf);
                if (key != null) b.header("Idempotency-Key", key);
            }
            return http.send(
                b
                    .method(
                        method,
                        body == null
                            ? HttpRequest.BodyPublishers.noBody()
                            : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))
                    )
                    .build(),
                HttpResponse.BodyHandlers.ofString()
            );
        }

        JsonNode ok(String method, String path, Object body) throws Exception {
            return ok(method, path, body, UUID.randomUUID().toString());
        }

        JsonNode ok(String method, String path, Object body, String key) throws Exception {
            var r = call(method, path, body, key);
            assertEquals(200, r.statusCode(), () -> r.body());
            JsonNode data = json.readTree(r.body());
            assertEquals(
                r.headers().firstValue("X-Request-Id").orElseThrow(),
                data.path("requestId").asText()
            );
            return data;
        }

        JsonNode login(String phone) throws Exception {
            var send = ok("POST", "/auth/code", Map.of("phone", phone));
            var login = ok(
                "POST",
                "/auth/login",
                Map.of("phone", phone, "code", send.get("developmentCode").asText())
            );
            csrf = login.path("user").get("csrf").asText();
            return login.get("user");
        }

        void profile(String name) throws Exception {
            ok(
                "POST",
                "/me/profile",
                Map.of("nickname", name, "avatar", "🌱", "adult", true, "sensitiveConsent", true)
            );
        }
    }

    @Test
    void twoAccountsCompleteFlowAndPrivacy() throws Exception {
        var a = new Client();
        var b = new Client();
        var ua = a.login("13900001001");
        var ub = b.login("13900001002");
        a.profile("合成甲");
        b.profile("合成乙");
        var created = a.ok(
            "POST",
            "/rooms",
            Map.of("days", 14, "intensity", "低", "sharingConsent", true)
        );
        String room = created.get("roomId").asText();
        var snapshot = a.ok("GET", "/rooms/" + room, null);
        String code = snapshot.path("room").get("inviteCode").asText();
        var publicView = new Client().ok("GET", "/invites/" + code, null);
        assertFalse(publicView.toString().contains("合成甲"));
        assertFalse(publicView.toString().contains("height"));
        b.ok("POST", "/invites/" + code, Map.of("sharingConsent", true));
        int version = a.ok("GET", "/rooms/" + room, null).path("room").get("version").asInt();
        a.ok(
            "PUT",
            "/rooms/" + room + "/preparation",
            Map.of("height", 175, "weight", 80, "version", version)
        );
        version = b.ok("GET", "/rooms/" + room, null).path("room").get("version").asInt();
        b.ok(
            "PUT",
            "/rooms/" + room + "/preparation",
            Map.of("height", 168, "weight", 70, "version", version)
        );
        var preview = a.ok("GET", "/rooms/" + room + "/start-preview", null);
        a.ok(
            "POST",
            "/rooms/" + room + "/start",
            Map.of(
                "version",
                preview.get("version"),
                "date",
                preview.get("date"),
                "expiresAt",
                preview.get("expiresAt")
            )
        );
        String today = a.ok("GET", "/rooms/" + room, null).get("today").asText();
        var body = Map.of("date", today, "weight", 140, "unit", "jin", "version", 0);
        String key = UUID.randomUUID().toString();
        var first = a.ok("PUT", "/rooms/" + room + "/records", body, key);
        var replay = a.ok("PUT", "/rooms/" + room + "/records", body, key);
        assertEquals(1, replay.get("version").asInt());
        assertEquals(first.get("weight"), replay.get("weight"));
        var changed = a.call(
            "PUT",
            "/rooms/" + room + "/records",
            Map.of("date", today, "weight", 69, "unit", "kg", "version", 0),
            UUID.randomUUID().toString()
        );
        assertEquals(409, changed.statusCode());
        var denied = new Client().call("GET", "/rooms/" + room, null, null);
        assertEquals(401, denied.statusCode());
        var shared = b.ok("GET", "/rooms/" + room, null);
        assertFalse(shared.toString().contains("height"));
        var response = b.call("GET", "/rooms/" + room, null, null);
        assertTrue(response.body().contains("\"weight\":70.00"), response::body);
        assertEquals(
            0,
            shared
                .path("members")
                .get(0)
                .path("todayRecord")
                .get("weight")
                .decimalValue()
                .compareTo(new java.math.BigDecimal("70"))
        );
        var support = a.ok("POST", "/support", Map.of("message", "合成测试支持请求"));
        assertTrue(support.has("supportRequestId"));
        assertNotEquals(support.get("requestId"), support.get("supportRequestId"));
        var exported = a.ok("GET", "/me/export", null);
        assertEquals(ua.get("id"), exported.path("user").get("id"));
        assertFalse(exported.toString().contains(ub.get("id").asText()));
        a.ok("DELETE", "/me", Map.of("confirm", "注销并删除我的数据"));
        assertEquals(401, a.call("GET", "/me", null, null).statusCode());
        assertEquals(1, b.ok("GET", "/rooms/" + room, null).get("members").size());
    }

    @Test
    void csrfTypeAndConsentBoundaries() throws Exception {
        var c = new Client();
        c.login("13900001003");
        var bad = c.call(
            "POST",
            "/rooms",
            Map.of("days", 14, "intensity", "低", "sharingConsent", true),
            UUID.randomUUID().toString()
        );
        assertEquals(403, bad.statusCode());
        c.profile("边界测试");
        c.csrf = "wrong";
        assertEquals(
            403,
            c
                .call(
                    "POST",
                    "/support",
                    Map.of("message", "合成内容"),
                    UUID.randomUUID().toString()
                )
                .statusCode()
        );
    }

    @Test
    void profileAliasesReplayAndFailedWriteCanBeRetried() throws Exception {
        var client = new Client();
        client.login("13900001101");
        String key = UUID.randomUUID().toString();
        var invalid = Map.of(
            "nickname",
            "资料测试",
            "avatar",
            "invalid",
            "adult",
            true,
            "sensitiveConsent",
            true
        );
        assertEquals(400, client.call("PATCH", "/me", invalid, key).statusCode());
        assertFalse(client.ok("GET", "/me", null).path("user").get("consent").asBoolean());

        var profile = Map.of(
            "nickname",
            "资料测试",
            "avatar",
            "🌱",
            "adult",
            true,
            "sensitiveConsent",
            true
        );
        client.ok("PATCH", "/me", profile, key);
        client.ok("POST", "/me/profile", profile, key);
        var me = client.ok("GET", "/me", null);
        assertEquals("资料测试", me.path("user").get("nickname").asText());
        assertTrue(me.path("user").get("consent").asBoolean());
        assertFalse(me.toString().contains("13900001101"));
        assertTrue(me.path("user").get("phone").asText().contains("****"));
        assertEquals(
            409,
            client.call("PATCH", "/me", Map.of("nickname", "different"), key).statusCode()
        );

        var ticket = client.ok("POST", "/support", Map.of("message", "分层回归支持请求"));
        var tickets = client.ok("GET", "/support", null).get("requests");
        assertEquals(1, tickets.size());
        assertEquals(ticket.get("supportRequestId"), tickets.get(0).get("id"));
        assertTrue(tickets.get(0).has("createdAt"));
        client.ok("POST", "/auth/logout", Map.of());
        assertEquals(401, client.call("GET", "/me", null, null).statusCode());
    }

    @Test
    void editAndLeavePreserveOwnerTransferAndPreparationRules() throws Exception {
        var owner = new Client();
        var friend = new Client();
        owner.login("13900001102");
        var friendUser = friend.login("13900001103");
        owner.profile("发起人");
        friend.profile("接任者");
        String roomId = owner
            .ok("POST", "/rooms", Map.of("days", 14, "sharingConsent", true))
            .get("roomId")
            .asText();
        var room = owner.ok("GET", "/rooms/" + roomId, null).get("room");
        String code = room.get("inviteCode").asText();
        friend.ok("POST", "/invites/" + code, Map.of("sharingConsent", true));
        var existing = friend.ok("GET", "/invites/" + code, null).get("invite");
        assertEquals(roomId, existing.get("memberRoomId").asText());
        assertEquals(2, existing.size());
        int version = owner.ok("GET", "/rooms/" + roomId, null).path("room").get("version").asInt();
        owner.ok(
            "PUT",
            "/rooms/" + roomId + "/preparation",
            Map.of("height", 170, "weight", 70, "version", version)
        );
        version = owner.ok("GET", "/rooms/" + roomId, null).path("room").get("version").asInt();
        var edit = owner.ok("PATCH", "/rooms/" + roomId, Map.of("days", 28, "version", version));
        assertTrue(edit.get("needsReconfirmation").asBoolean());
        var preparation = owner.ok("GET", "/rooms/" + roomId + "/preparation", null);
        assertFalse(preparation.get("ready").asBoolean());
        assertTrue(preparation.get("target").isNull());
        assertEquals(
            403,
            friend
                .call(
                    "PATCH",
                    "/rooms/" + roomId,
                    Map.of("days", 14, "version", version),
                    UUID.randomUUID().toString()
                )
                .statusCode()
        );
        owner.ok("POST", "/rooms/" + roomId + "/leave", Map.of());
        assertEquals(
            friendUser.get("id"),
            friend.ok("GET", "/rooms/" + roomId, null).path("room").get("ownerId")
        );
        assertEquals(403, owner.call("GET", "/rooms/" + roomId, null, null).statusCode());
        owner.ok("POST", "/rooms", Map.of("days", 14, "sharingConsent", true));
        friend.ok("POST", "/rooms/" + roomId + "/leave", Map.of());
        assertEquals(404, new Client().call("GET", "/invites/" + code, null, null).statusCode());
    }

    @Test
    void reminderReplayRetainsDatesAndFiltersMembersWhoHaveRecorded() throws Exception {
        var a = new Client();
        var b = new Client();
        a.login("13900001104");
        b.login("13900001105");
        a.profile("提示甲");
        b.profile("提示乙");
        String roomId = startRoom(a, b);
        var today = java.time.LocalDate.parse(
            a.ok("GET", "/rooms/" + roomId, null).get("today").asText()
        );
        roomMapper.update(
            new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<
                team.shangcheng.room.entity.RoomEntity
            >()
                .eq(team.shangcheng.room.entity.RoomEntity::getId, roomId)
                .set(team.shangcheng.room.entity.RoomEntity::getStartDate, today.minusDays(4))
        );
        memberMapper.update(
            new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<
                team.shangcheng.room.entity.MemberEntity
            >()
                .eq(team.shangcheng.room.entity.MemberEntity::getRoomId, roomId)
                .set(team.shangcheng.room.entity.MemberEntity::getJoinDate, today.minusDays(4))
        );
        String key = UUID.randomUUID().toString();
        var claimed = a.ok("POST", "/rooms/" + roomId + "/reminders", Map.of(), key);
        assertEquals(2, claimed.get("reminders").size());
        assertEquals(
            claimed.get("reminders"),
            a.ok("POST", "/rooms/" + roomId + "/reminders", Map.of(), key).get("reminders")
        );
        assertEquals(
            0,
            a.ok("GET", "/rooms/" + roomId + "/reminders", null).get("reminders").size()
        );
        a.ok(
            "PUT",
            "/rooms/" + roomId + "/records",
            Map.of("date", today.toString(), "weight", 70, "version", 0)
        );
        assertEquals(
            1,
            a.ok("POST", "/rooms/" + roomId + "/reminders", Map.of(), key).get("reminders").size()
        );
    }

    @Test
    void expiryAdviceStillRunsAfterControllerSplitAndStrictNumbersStayStrict() throws Exception {
        var a = new Client();
        var b = new Client();
        a.login("13900001106");
        b.login("13900001107");
        a.profile("到期甲");
        b.profile("到期乙");
        assertEquals(
            400,
            a
                .call(
                    "POST",
                    "/rooms",
                    Map.of("days", "14", "sharingConsent", true),
                    UUID.randomUUID().toString()
                )
                .statusCode()
        );
        String roomId = startRoom(a, b);
        var today = java.time.LocalDate.parse(
            a.ok("GET", "/rooms/" + roomId, null).get("today").asText()
        );
        roomMapper.update(
            new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<
                team.shangcheng.room.entity.RoomEntity
            >()
                .eq(team.shangcheng.room.entity.RoomEntity::getId, roomId)
                .set(team.shangcheng.room.entity.RoomEntity::getStartDate, today.minusDays(30))
        );
        a.ok("GET", "/config", null);
        assertEquals(
            "ENDED",
            a.ok("GET", "/rooms/" + roomId, null).path("room").get("status").asText()
        );
        assertEquals(roomId, a.ok("GET", "/history", null).path("rooms").get(0).get("id").asText());
        assertTrue(a.ok("GET", "/me", null).path("user").get("currentRoomId").isNull());
        a.ok("POST", "/rooms", Map.of("days", 14, "sharingConsent", true));
    }

    private String startRoom(Client a, Client b) throws Exception {
        String id = a
            .ok("POST", "/rooms", Map.of("days", 14, "sharingConsent", true))
            .get("roomId")
            .asText();
        String code = a.ok("GET", "/rooms/" + id, null).path("room").get("inviteCode").asText();
        b.ok("POST", "/invites/" + code, Map.of("sharingConsent", true));
        for (Client client : List.of(a, b)) {
            int version = client
                .ok("GET", "/rooms/" + id, null)
                .path("room")
                .get("version")
                .asInt();
            client.ok(
                "PUT",
                "/rooms/" + id + "/preparation",
                Map.of("height", 170, "weight", 70, "version", version)
            );
        }
        var preview = a.ok("GET", "/rooms/" + id + "/start-preview", null);
        a.ok(
            "POST",
            "/rooms/" + id + "/start",
            Map.of(
                "date",
                preview.get("date"),
                "version",
                preview.get("version"),
                "expiresAt",
                preview.get("expiresAt")
            )
        );
        return id;
    }

    private void insertUser(String id, String phone, String nickname, java.time.Instant now) {
        var user = new team.shangcheng.identity.entity.UserEntity();
        user.setId(id);
        user.setPhone(phone);
        user.setNickname(nickname);
        user.setAvatar("🌱");
        user.setCreatedAt(now);
        userMapper.insert(user);
    }
}
