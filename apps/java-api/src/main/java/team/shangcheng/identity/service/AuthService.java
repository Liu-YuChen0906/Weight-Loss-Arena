package team.shangcheng.identity.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import team.shangcheng.common.Mutations;
import team.shangcheng.common.Problem;
import team.shangcheng.domain.Domain;
import team.shangcheng.identity.PnvsClient;
import team.shangcheng.identity.dto.*;
import team.shangcheng.identity.entity.UserEntity;
import team.shangcheng.identity.mapper.LoginMapper;
import team.shangcheng.identity.mapper.UserMapper;

@Service
public class AuthService {

    private final LoginMapper logins;
    private final UserMapper users;
    private final RateLimitService limits;
    private final Clock clock;
    private final TransactionTemplate tx;
    private final SecureRandom random = new SecureRandom();
    private final String mode;
    private final String testCodes;
    private final Environment environment;
    private final ObjectMapper json;
    private PnvsClient sms;
    private int smsDailyLimit;

    public AuthService(
        LoginMapper logins,
        UserMapper users,
        RateLimitService limits,
        Clock clock,
        PlatformTransactionManager manager,
        Environment environment,
        ObjectMapper json,
        @Value("${app.mode}") String mode,
        @Value("${app.test-codes}") String testCodes
    ) {
        this.logins = logins;
        this.users = users;
        this.limits = limits;
        this.clock = clock;
        this.tx = new TransactionTemplate(manager);
        this.mode = mode;
        this.testCodes = testCodes;
        this.environment = environment;
        this.json = json;
    }

    public String mode() {
        return mode;
    }

    public boolean realSms() {
        return Set.of("sms-trial", "production").contains(mode);
    }

    @PostConstruct
    void validate() {
        // A half-configured paid provider must never silently fall back to local SMS.
        if (realSms()) {
            configureSms();
        } else if (!Set.of("local", "test").contains(mode)) {
            throw new IllegalStateException("Unsupported app mode");
        }
        if (mode.equals("test")) {
            var codes = testCodes.split(",");
            if (
                codes.length < 2 ||
                codes.length > 8 ||
                Arrays.stream(codes).anyMatch(s -> !s.matches("[a-f0-9]{64}:[^,:]{1,20}"))
            ) throw new IllegalStateException("test mode requires 2-8 SHA256:nickname entries");
        }
    }

    private void configureSms() {
        URI origin = URI.create(environment.getRequiredProperty("app.origin"));
        if (
            !"https".equals(origin.getScheme()) ||
            origin.getHost() == null ||
            !origin.toString().equals("https://" + origin.getRawAuthority()) ||
            origin.getRawUserInfo() != null ||
            !environment.getProperty("server.servlet.session.cookie.secure", Boolean.class, false)
        ) throw new IllegalStateException("SMS login requires an HTTPS origin and secure cookies");

        smsDailyLimit = environment.getRequiredProperty("PNVS_DAILY_LIMIT", Integer.class);
        if (smsDailyLimit < 1 || smsDailyLimit > 20) {
            throw new IllegalStateException("PNVS_DAILY_LIMIT must be between 1 and 20");
        }
        var config = new PnvsClient.Config(
            environment.getProperty("PNVS_ACCESS_KEY_ID", ""),
            environment.getProperty("PNVS_ACCESS_KEY_SECRET", ""),
            environment.getProperty("PNVS_SIGN_NAME", ""),
            environment.getProperty("PNVS_TEMPLATE_CODE", ""),
            environment.getProperty("PNVS_SECURITY_TOKEN", ""),
            environment.getProperty("PNVS_TIMEOUT_MS", Integer.class, 8000)
        );
        sms = new PnvsClient(config, PnvsClient.http(json), clock, () ->
            UUID.randomUUID().toString()
        );
    }

    @PreDestroy
    void closeSms() {
        if (sms != null) sms.close();
    }

    public IdentityResponses.Code send(IdentityRequests.SendCode request, String source) {
        if (!mode.equals("local") && !realSms()) throw new Problem(
            403,
            "TEST_LOGIN_ONLY",
            "当前环境仅使用合成体验身份"
        );
        String phone = request.phone();
        limits.check("send-ip:" + Mutations.hash(source), 20, 3600);
        limits.check("send-phone:" + Mutations.hash(phone), 10, 86400);
        if (realSms()) return sendSms(phone);
        var old = logins.findOtp(phone, false);
        if (old != null) {
            long elapsed = Duration.between(old.sentAt(), clock.instant()).toSeconds();
            if (elapsed < 60) throw new Problem(
                429,
                "RATE_LIMITED",
                "请稍后再次获取",
                Map.of("retryAfter", 60 - elapsed)
            );
        }
        String code = String.format(Locale.ROOT, "%06d", random.nextInt(1000000));
        String dispatch = UUID.randomUUID().toString();
        logins.saveOtp(
            phone,
            Mutations.hash(dispatch + code),
            dispatch,
            clock.instant().plusSeconds(300),
            clock.instant()
        );
        return new IdentityResponses.Code(60, 300, "DEVELOPMENT", "模拟验证码，未发送短信", code);
    }

    public String login(IdentityRequests.Login request, String source) {
        if (!mode.equals("local") && !realSms()) {
            throw new Problem(403, "TEST_LOGIN_ONLY", "请使用体验凭据");
        }
        limits.check("login-ip:" + Mutations.hash(source), 50, 3600);
        String phone = request.phone();
        String code = request.code();
        Problem.require(code.matches("\\d{6}"), "验证码须为6位数字");
        if (realSms()) return verifySms(phone, code);
        String uid = tx.execute(status -> {
            var row = logins.findOtp(phone, true);
            if (
                row == null || row.attempts() >= 5 || !row.expiresAt().isAfter(clock.instant())
            ) return null;
            logins.incrementOtpAttempts(phone);
            if (
                !"DEVELOPMENT".equals(row.deliveryState()) ||
                !java.security.MessageDigest.isEqual(
                    Mutations.hash(row.dispatchId() + code).getBytes(
                        java.nio.charset.StandardCharsets.US_ASCII
                    ),
                    row.credentialMarker().getBytes(java.nio.charset.StandardCharsets.US_ASCII)
                )
            ) return null;
            logins.deleteOtp(phone);
            return account(phone, "朋友" + phone.substring(7));
        });
        if (uid == null) throw new Problem(401, "INVALID_CODE", "验证码不正确或已失效");
        return uid;
    }

    private IdentityResponses.Code sendSms(String phone) {
        String dispatch = UUID.randomUUID().toString();
        tx.executeWithoutResult(status -> {
            var now = clock.instant();
            var expires = now.plusSeconds(300);
            if (
                logins.insertSms(phone, dispatch, expires, now) == 0 &&
                logins.replaceSms(phone, dispatch, expires, now, now.minusSeconds(60)) == 0
            ) throw new Problem(
                429,
                "RATE_LIMITED",
                "请稍后再获取验证码",
                Map.of("retryAfter", 60)
            );

            var day = Domain.today(clock);
            logins.initializeSmsBudget(day);
            if (logins.spendSmsBudget(day, smsDailyLimit) == 0) {
                throw new Problem(429, "SMS_DAILY_LIMIT", "今日短信额度已用完，请明天再试");
            }
        });

        try {
            sms.send(phone, dispatch);
        } catch (PnvsClient.ProviderFailure failure) {
            logins.finishSms(phone, dispatch, failure.state);
            throw new Problem(503, "SMS_UNAVAILABLE", "短信服务暂不可用，请稍后再试");
        }
        if (logins.finishSms(phone, dispatch, "ACCEPTED") != 1) {
            throw new Problem(503, "SMS_UNAVAILABLE", "本次验证码已失效，请重新获取");
        }
        return new IdentityResponses.Code(60, 300, "ACCEPTED", "短信已提交，请查收", null);
    }

    private String verifySms(String phone, String code) {
        var row = logins.findOtp(phone, false);
        var now = clock.instant();
        String token = UUID.randomUUID().toString();
        if (
            row == null ||
            logins.leaseSms(phone, row.dispatchId(), token, now, now.plusSeconds(25)) != 1
        ) {
            throw invalidCode();
        }

        PnvsClient.Outcome outcome;
        try {
            outcome = sms.verify(phone, code, row.dispatchId());
        } catch (PnvsClient.ProviderFailure failure) {
            logins.finishSmsVerification(phone, row.dispatchId(), token, "UNKNOWN");
            throw new Problem(503, "SMS_UNAVAILABLE", "核验暂不可用，请重新获取验证码");
        }
        if (outcome != PnvsClient.Outcome.PASS) {
            logins.finishSmsVerification(phone, row.dispatchId(), token, "ACCEPTED");
            throw invalidCode();
        }

        return tx.execute(status -> {
            if (logins.consumeSms(phone, row.dispatchId(), token, clock.instant()) != 1) {
                throw invalidCode();
            }
            return account(phone, "朋友" + phone.substring(7));
        });
    }

    private Problem invalidCode() {
        return new Problem(401, "INVALID_CODE", "验证码不正确、已失效或正在核验");
    }

    public String testLogin(String code, String source) {
        if (!mode.equals("test")) throw new Problem(404, "NOT_FOUND", "此入口不可用");
        limits.check("test-login:" + Mutations.hash(source), 50, 3600);
        String hash = Mutations.hash(code);
        if (code.length() != 24) throw new Problem(401, "INVALID_CODE", "体验凭据不正确");
        for (String entry : testCodes.split(",")) {
            String[] parts = entry.split(":", 2);
            if (
                java.security.MessageDigest.isEqual(parts[0].getBytes(), hash.getBytes())
            ) return tx.execute(s -> account("test:" + hash, parts[1]));
        }
        throw new Problem(401, "INVALID_CODE", "体验凭据不正确");
    }

    private String account(String phone, String nickname) {
        var old = users.selectOne(
            new LambdaQueryWrapper<UserEntity>().eq(UserEntity::getPhone, phone)
        );
        if (old != null) {
            return old.getId();
        }
        var user = new UserEntity();
        user.setId(UUID.randomUUID().toString());
        user.setPhone(phone);
        user.setNickname(nickname);
        user.setAvatar("🌱");
        user.setCreatedAt(clock.instant());
        users.insert(user);
        return user.getId();
    }
}
