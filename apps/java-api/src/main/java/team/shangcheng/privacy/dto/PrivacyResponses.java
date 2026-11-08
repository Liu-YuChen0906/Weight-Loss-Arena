package team.shangcheng.privacy.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.time.*;
import java.util.List;

public final class PrivacyResponses {

    private PrivacyResponses() {}

    public record ExportUser(String id, String nickname, String avatar, String phone) {}

    public record Membership(
        @JsonProperty("room_id") String roomId,
        @JsonProperty("join_date") LocalDate joinDate,
        String state,
        BigDecimal height,
        @JsonProperty("start_weight") BigDecimal startWeight,
        BigDecimal target,
        String algorithm
    ) {}

    public record Reading(
        @JsonProperty("room_id") String roomId,
        LocalDate date,
        BigDecimal weight,
        int version
    ) {}

    public record Export(
        Instant exportedAt,
        ExportUser user,
        List<Membership> memberships,
        List<Reading> records
    ) {}

    public record Deletion(String requestId, String onlineStatus, String backupStatus) {}

    public record Deleted(boolean ok, Deletion deletion) {}
}
