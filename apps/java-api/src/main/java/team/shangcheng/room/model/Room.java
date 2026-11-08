package team.shangcheng.room.model;

import java.time.LocalDate;

public record Room(
    String id,
    String name,
    String intro,
    int days,
    String intensity,
    String status,
    String ownerId,
    String inviteCode,
    int version,
    LocalDate startDate
) {}
