package team.shangcheng.identity.model;

public record RateLimit(int count, java.time.Instant resetAt) {}
