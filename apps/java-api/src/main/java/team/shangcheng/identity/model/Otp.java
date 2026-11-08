package team.shangcheng.identity.model;

public record Otp(
    String dispatchId,
    String credentialMarker,
    String deliveryState,
    java.time.Instant expiresAt,
    java.time.Instant sentAt,
    int attempts
) {}
