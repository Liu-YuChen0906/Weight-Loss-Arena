package team.shangcheng.identity.dto;

import java.time.LocalDate;

public final class IdentityResponses {

    private IdentityResponses() {}

    public record UserView(
        String id,
        String nickname,
        String avatar,
        String phone,
        boolean consent,
        String currentRoomId,
        String csrf
    ) {}

    public record Login(UserView user) {}

    public record Me(UserView user, LocalDate today, String mode, String consentVersion) {}

    public record Code(
        int retryAfter,
        int expiresIn,
        String deliveryStatus,
        String message,
        String developmentCode
    ) {}
}
