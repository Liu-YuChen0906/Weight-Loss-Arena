package team.shangcheng.room.model;

import java.time.LocalDate;

public record StartPreview(int version, LocalDate businessDate, long expiresAt) {}
