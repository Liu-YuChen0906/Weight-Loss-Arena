package team.shangcheng.identity.service;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import java.time.Clock;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import team.shangcheng.common.Problem;
import team.shangcheng.common.dto.SuccessResponse;
import team.shangcheng.domain.Domain;
import team.shangcheng.identity.dto.IdentityRequests.Profile;
import team.shangcheng.identity.dto.IdentityResponses.*;
import team.shangcheng.identity.entity.UserEntity;
import team.shangcheng.identity.mapper.UserMapper;
import team.shangcheng.identity.model.User;

@Service
@RequiredArgsConstructor
public class UserService {

    public static final String CONSENT = "body-data-v1";
    public static final Set<String> AVATARS = Set.of(
        "🌱",
        "🐱",
        "🐶",
        "🐼",
        "🦊",
        "🐰",
        "🐻",
        "🐧",
        "🌻",
        "🍊",
        "🥑",
        "⭐"
    );
    private final UserMapper mapper;
    private final Clock clock;
    private final AuthService auth;
    private final team.shangcheng.common.Mutations mutations;

    public User findById(String userId) {
        var user = mapper.selectById(userId);
        return user == null
            ? null
            : new User(
                user.getId(),
                user.getPhone(),
                user.getNickname(),
                user.getAvatar(),
                user.getConsentVersion()
            );
    }

    public void consent(String userId) {
        User user = findById(userId);
        if (user == null || !user.hasConsent()) throw new Problem(
            403,
            "CONSENT_REQUIRED",
            "请先确认个人资料和数据使用说明"
        );
    }

    public UserView view(User user, String csrf) {
        String phone = user.phone();
        String maskedPhone = phone.startsWith("test:")
            ? "测试身份"
            : phone.substring(0, 3) + "****" + phone.substring(7);
        return new UserView(
            user.id(),
            user.nickname(),
            user.avatar(),
            maskedPhone,
            user.hasConsent(),
            mapper.findCurrentRoomId(user.id()),
            csrf
        );
    }

    public Me me(User user, String csrf) {
        return new Me(
            view(user, csrf),
            Domain.today(clock),
            auth.realSms() ? "provider" : (auth.mode().equals("local") ? "development" : "test"),
            CONSENT
        );
    }

    public SuccessResponse profile(
        String userId,
        String key,
        com.fasterxml.jackson.databind.JsonNode body
    ) {
        return mutations.run(
            userId,
            key,
            "profile",
            body,
            SuccessResponse.class,
            () -> {},
            () -> updateProfile(userId, Profile.from(body))
        );
    }

    /** Called inside the idempotent application transaction. */
    private SuccessResponse updateProfile(String userId, Profile request) {
        Problem.require(!request.nickname().isEmpty(), "请填写昵称");
        Problem.require(AVATARS.contains(request.avatar()), "请选择提供的头像");
        User user = findById(userId);
        if (user == null) throw new Problem(401, "UNAUTHENTICATED", "请先登录");
        if (!user.hasConsent()) {
            Problem.require(
                request.adult() && request.sensitiveConsent(),
                "请确认年满18岁并同意身体数据说明"
            );
            mapper.update(
                new LambdaUpdateWrapper<UserEntity>()
                    .eq(UserEntity::getId, userId)
                    .set(UserEntity::getConsentVersion, CONSENT)
                    .set(UserEntity::getConsentAt, clock.instant())
            );
        }
        mapper.update(
            new LambdaUpdateWrapper<UserEntity>()
                .eq(UserEntity::getId, userId)
                .set(UserEntity::getNickname, request.nickname())
                .set(UserEntity::getAvatar, request.avatar())
        );
        return SuccessResponse.success();
    }
}
