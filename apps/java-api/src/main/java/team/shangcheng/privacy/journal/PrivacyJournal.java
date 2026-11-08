package team.shangcheng.privacy.journal;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.spring.MybatisSqlSessionFactoryBean;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Clock;
import java.util.UUID;
import org.apache.ibatis.session.LocalCacheScope;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import team.shangcheng.common.Problem;
import team.shangcheng.privacy.journal.JournalMapper;
import team.shangcheng.privacy.mapper.PrivacyMapper;

/** A separate schema and lifecycle, never included in business snapshot restoration. */
@Component
public class PrivacyJournal implements AutoCloseable {

    private final HikariDataSource source;
    private final SqlSessionFactory journalFactory;
    private final PrivacyMapper business;
    private final TransactionTemplate tx;
    private final Clock clock;

    public PrivacyJournal(
        PrivacyMapper business,
        PlatformTransactionManager manager,
        Clock clock,
        @Value(
            "${JOURNAL_DB_URL:jdbc:mysql://localhost:3307/shangcheng_java_journal?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true}"
        ) String url,
        @Value("${JOURNAL_DB_USER:shangcheng}") String user,
        @Value("${JOURNAL_DB_PASSWORD:${DB_PASSWORD}}") String password
    ) throws Exception {
        this.business = business;
        this.tx = new TransactionTemplate(manager);
        this.clock = clock;
        var config = new HikariConfig();
        config.setJdbcUrl(url);
        config.setUsername(user);
        config.setPassword(password);
        config.setMaximumPoolSize(3);
        config.setConnectionTimeout(3000);
        config.setInitializationFailTimeout(-1);
        config.setPoolName("privacy-journal");
        source = new HikariDataSource(config);
        try {
            var configuration = new MybatisConfiguration();
            configuration.setLocalCacheScope(LocalCacheScope.STATEMENT);
            configuration.addMapper(JournalMapper.class);
            var factory = new MybatisSqlSessionFactoryBean();
            factory.setDataSource(source);
            factory.setConfiguration(configuration);
            journalFactory = factory.getObject();
        } catch (Exception e) {
            source.close();
            throw e;
        }
    }

    public Gate enter() {
        SqlSession session = null;
        try {
            // One session holds the same physical connection for the entire named-lock lifetime.
            session = journalFactory.openSession(true);
            var mapper = session.getMapper(JournalMapper.class);
            if (!Integer.valueOf(1).equals(mapper.acquireGate())) {
                throw new IllegalStateException("gate unavailable");
            }
            Gate gate = new Gate(session);
            try {
                replay(mapper);
                return gate;
            } catch (Exception e) {
                gate.close();
                session = null;
                throw e;
            }
        } catch (Exception e) {
            if (session != null) {
                session.close();
            }
            throw new Problem(503, "DEPENDENCY_UNAVAILABLE", "数据安全校验暂时不可用，请稍后重试");
        }
    }

    private void replay(JournalMapper journal) {
        String identity = journal.identity();
        if (identity == null) {
            throw new IllegalStateException("missing journal");
        }
        var meta = business.meta();
        if (meta == null) {
            if (business.userCount() != 0) {
                throw new IllegalStateException("unbound snapshot");
            }
            business.bind(identity);
            meta = business.meta();
        }
        if (!identity.equals(meta.journalId())) {
            throw new IllegalStateException("journal identity mismatch");
        }
        long last = meta.lastSequence();
        long max = journal.lastSequence();
        if (last > max) {
            throw new IllegalStateException("journal older than snapshot");
        }
        for (var event : journal.eventsAfter(last)) {
            if (event.sequence() != last + 1) {
                throw new IllegalStateException("journal gap");
            }
            tx.executeWithoutResult(status -> {
                erase(event.userId());
                business.advance(event.sequence());
            });
            last = event.sequence();
        }
    }

    public String delete(String userId) {
        String eventId = UUID.randomUUID().toString();
        // Autocommit makes the erasure event durable before the business transaction is attempted.
        try (var session = journalFactory.openSession(true)) {
            var journal = session.getMapper(JournalMapper.class);
            journal.append(eventId, userId, clock.instant());
            replay(journal);
            return eventId;
        } catch (Exception e) {
            throw new Problem(503, "DEPENDENCY_UNAVAILABLE", "删除尚未确认完成，请重新登录核对");
        }
    }

    private void erase(String userId) {
        var rooms = business.rooms(userId);
        var phone = business.phone(userId);
        for (String room : rooms) {
            business.deleteReceipts(room);
            business.invalidateRoom(room);
        }
        business.deleteMemberships(userId);
        business.deletePreviews(userId);
        business.deleteRecords(userId);
        business.deleteSupport(userId);
        business.deleteIdempotency(userId);
        business.deleteMembers(userId);
        if (phone != null) {
            business.deleteOtp(phone);
        }
        business.deleteUser(userId);
        for (String roomId : rooms) {
            var room = business.room(roomId);
            if (room != null && "LOBBY".equals(room.status())) {
                var next = business.nextOwner(roomId);
                if (next == null) {
                    business.cancelRoom(roomId);
                } else if (userId.equals(room.ownerId())) {
                    business.transferOwner(roomId, next);
                }
            }
        }
    }

    public static class Gate implements AutoCloseable {

        private final SqlSession session;

        Gate(SqlSession session) {
            this.session = session;
        }

        @Override
        public void close() {
            try {
                session.getMapper(JournalMapper.class).releaseGate();
            } finally {
                session.close();
            }
        }
    }

    @Override
    public void close() {
        source.close();
    }
}
