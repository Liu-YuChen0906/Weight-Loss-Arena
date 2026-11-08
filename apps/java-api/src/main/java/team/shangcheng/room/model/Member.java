package team.shangcheng.room.model;

import java.math.BigDecimal;
import java.time.LocalDate;

public record Member(
    String id,
    String roomId,
    String userId,
    boolean ready,
    BigDecimal height,
    BigDecimal startWeight,
    BigDecimal target,
    String algorithm,
    LocalDate joinDate,
    int joinedOrder,
    String nickname,
    String avatar
) {}
