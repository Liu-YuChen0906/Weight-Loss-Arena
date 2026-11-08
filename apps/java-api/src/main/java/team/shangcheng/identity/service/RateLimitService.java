package team.shangcheng.identity.service;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import team.shangcheng.common.Problem;
import team.shangcheng.identity.mapper.LoginMapper;

@Service
public class RateLimitService {

    private final LoginMapper mapper;
    private final Clock clock;
    private final TransactionTemplate transaction;

    public RateLimitService(LoginMapper mapper, Clock clock, PlatformTransactionManager manager) {
        this.mapper = mapper;
        this.clock = clock;
        this.transaction = new TransactionTemplate(manager);
    }

    public void check(String key, int maximum, int seconds) {
        // Return the rejection so the transaction commits the existing rate-limit state.
        Problem failure = transaction.execute(status -> {
            mapper.initializeLimit(key, clock.instant().plusSeconds(seconds));
            var limit = mapper.lockLimit(key);
            if (!limit.resetAt().isAfter(clock.instant())) {
                mapper.resetLimit(key, clock.instant().plusSeconds(seconds));
                return null;
            }
            if (limit.count() >= maximum) return new Problem(
                429,
                "RATE_LIMITED",
                "操作较频繁，请稍后再试",
                Map.of(
                    "retryAfter",
                    Math.max(1, Duration.between(clock.instant(), limit.resetAt()).toSeconds())
                )
            );
            mapper.incrementLimit(key);
            return null;
        });
        if (failure != null) throw failure;
    }
}
