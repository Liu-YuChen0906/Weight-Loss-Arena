package team.shangcheng.room.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import team.shangcheng.domain.Domain;

/** HTTP projections are separate from database entities; private height data is never part of a snapshot. */
public final class RoomResponses {

    private RoomResponses() {}

    public record RoomId(String roomId) {}

    public record Preparation(
        BigDecimal height,
        BigDecimal weight,
        BigDecimal target,
        boolean ready,
        int version
    ) {}

    public record Edited(boolean ok, boolean needsReconfirmation) {}

    public record Preview(
        String roomId,
        String name,
        String intro,
        int days,
        String intensity,
        int version,
        LocalDate date,
        LocalDate endDate,
        long expiresAt
    ) {}

    public record Started(String roomId, LocalDate startDate) {}

    public record SavedRecord(LocalDate date, BigDecimal weight, int version) {}

    public sealed interface InviteDetails permits ExistingInvite, Invite {}

    public record ExistingInvite(String code, String memberRoomId) implements InviteDetails {}

    public record Invite(
        String code,
        String name,
        String intro,
        int days,
        String intensity,
        String status,
        int count,
        int remaining,
        boolean joinable,
        LocalDate today,
        int version
    ) implements InviteDetails {}

    public record Invitation(InviteDetails invite) {}

    public record RoomView(
        String id,
        String name,
        String intro,
        int days,
        String intensity,
        String status,
        String ownerId,
        String inviteCode,
        int version,
        LocalDate startDate,
        LocalDate endDate,
        int remaining
    ) {}

    public record ChartPoint(
        LocalDate date,
        BigDecimal weight,
        @com.fasterxml.jackson.annotation.JsonInclude(
            com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL
        ) String source,
        BigDecimal change,
        BigDecimal percent
    ) {}

    public record MemberView(
        String id,
        String userId,
        String memberId,
        String nickname,
        String avatar,
        boolean ready,
        BigDecimal startWeight,
        BigDecimal target,
        String algorithm,
        LocalDate joinDate,
        @JsonProperty("joined_order") int joinedOrder,
        Domain.Summary summary,
        Domain.Summary periodSummary,
        List<ChartPoint> points,
        List<Domain.Point> records,
        long missingDays,
        Domain.Reading todayRecord
    ) {}

    public record Snapshot(
        RoomView room,
        List<MemberView> members,
        Map<String, Integer> ranks,
        LocalDate today,
        int range
    ) {}

    public record Reminder(
        String memberId,
        String userId,
        String nickname,
        LocalDate round,
        int stage,
        long missingDays
    ) {}

    public record Reminders(boolean ok, LocalDate date, List<Reminder> reminders) {}

    public record HistoryRoom(
        String id,
        String name,
        LocalDate startDate,
        int days,
        String intensity
    ) {}

    public record History(List<HistoryRoom> rooms) {}
}
