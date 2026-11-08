package team.shangcheng.common.idempotency.model;

public record StoredResult(String operation, String bodyHash, String resultJson) {}
