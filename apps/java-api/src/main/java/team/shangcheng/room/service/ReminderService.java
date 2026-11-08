package team.shangcheng.room.service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import team.shangcheng.room.dto.RoomResponses.Reminder;
import team.shangcheng.room.dto.RoomResponses.Reminders;
import team.shangcheng.room.mapper.MemberMapper;
import team.shangcheng.room.mapper.ReminderReceiptMapper;
import team.shangcheng.room.mapper.WeightRecordMapper;

@Service
@RequiredArgsConstructor
public class ReminderService {

    private final RoomService rooms;
    private final MemberMapper members;
    private final WeightRecordMapper records;
    private final ReminderReceiptMapper receipts;

    public Reminders list(String roomId, String userId) {
        return reminders(roomId, userId, false);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Reminders claim(String roomId, String userId) {
        return reminders(roomId, userId, true);
    }

    private Reminders reminders(String roomId, String userId, boolean claim) {
        rooms.requireMember(roomId, userId);
        var room = rooms.requireRoom(roomId, claim);
        List<Reminder> result = new ArrayList<>();
        if (!"ACTIVE".equals(room.status())) return new Reminders(true, rooms.today(), result);
        for (var member : members.findMembersWithProfiles(roomId)) {
            var last = records.findLastRecordDate(roomId, member.userId());
            LocalDate round = last == null ? member.joinDate().minusDays(1) : last;
            long missing = ChronoUnit.DAYS.between(round, rooms.today());
            if (missing < 3) continue;
            int stage = missing >= 4 ? 4 : 3;
            if (
                receipts.findReminderReceipt(
                    roomId,
                    userId,
                    member.id(),
                    round,
                    stage,
                    rooms.today()
                ) !=
                null
            ) continue;
            if (claim) receipts.insertReminderReceipt(
                roomId,
                userId,
                member.id(),
                round,
                stage,
                rooms.today()
            );
            result.add(
                new Reminder(member.id(), member.userId(), member.nickname(), round, stage, missing)
            );
        }
        return new Reminders(true, rooms.today(), result);
    }

    public boolean reminderCurrent(String roomId, Reminder item) {
        if (!"ACTIVE".equals(rooms.requireRoom(roomId, false).status())) return false;
        var member = members.findMemberById(item.memberId(), roomId);
        if (member == null) return false;
        var last = records.findLastRecordDate(roomId, member.userId());
        LocalDate round = last == null ? member.joinDate().minusDays(1) : last;
        long missing = ChronoUnit.DAYS.between(round, rooms.today());
        return (
            round.toString().equals(item.round().toString()) &&
            missing >= 3 &&
            (missing >= 4 ? 4 : 3) == item.stage()
        );
    }
}
