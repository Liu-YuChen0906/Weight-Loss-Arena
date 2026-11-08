package team.shangcheng.system.service;

import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.*;
import org.springframework.stereotype.Service;
import team.shangcheng.identity.service.AuthService;
import team.shangcheng.privacy.journal.PrivacyJournal;
import team.shangcheng.system.dto.SystemResponses.Config;
import team.shangcheng.system.dto.SystemResponses.Health;
import team.shangcheng.system.mapper.HealthMapper;

@Service
@RequiredArgsConstructor
public class SystemService {

    private final HealthMapper database;
    private final StringRedisTemplate redis;
    private final PrivacyJournal journal;
    private final AuthService auth;

    public Health health() {
        database.check();
        redis.execute((RedisCallback<String>) connection -> connection.ping());
        try (var gate = journal.enter()) {
            return new Health(true, "mysql+redis", auth.mode());
        }
    }

    public Config config() {
        return new Config(
            auth.mode(),
            auth.mode().equals("test") ? "test-code" : "phone",
            !auth.mode().equals("production"),
            auth.realSms()
        );
    }
}
