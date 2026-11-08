package team.shangcheng.room.service;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import team.shangcheng.common.Mutations;
import team.shangcheng.common.dto.SuccessResponse;
import team.shangcheng.domain.Domain;
import team.shangcheng.room.dto.RoomRequests;
import team.shangcheng.room.dto.RoomResponses.*;

/** Write-use-case boundary. Decode only after authorization and replay lookup. */
@Service
@RequiredArgsConstructor
public class RoomApplicationService {

    private final RoomService rooms;
    private final Mutations mutations;
    private final WeightRecordService records;
    private final ReminderService reminders;

    public RoomId create(String userId, String key, JsonNode body) {
        return mutations.run(
            userId,
            key,
            "create",
            body,
            RoomId.class,
            () -> {},
            () -> rooms.create(userId, RoomRequests.Create.from(body))
        );
    }

    public RoomId join(String code, String userId, String key, JsonNode body) {
        return mutations.run(
            userId,
            key,
            "join:" + code.toUpperCase(Locale.ROOT),
            body,
            RoomId.class,
            () -> {},
            () -> rooms.join(code, userId, RoomRequests.Join.from(body))
        );
    }

    public Edited edit(String roomId, String userId, String key, JsonNode body) {
        return mutations.run(
            userId,
            key,
            "edit:" + roomId,
            body,
            Edited.class,
            () -> rooms.authorize(roomId, userId),
            () -> rooms.edit(roomId, userId, RoomRequests.Edit.from(body))
        );
    }

    public Domain.Goal prepare(String roomId, String userId, String key, JsonNode body) {
        return mutations.run(
            userId,
            key,
            "prepare:" + roomId,
            body,
            Domain.Goal.class,
            () -> rooms.authorize(roomId, userId),
            () -> rooms.prepare(roomId, userId, RoomRequests.Prepare.from(body))
        );
    }

    public SuccessResponse leave(String roomId, String userId, String key, JsonNode body) {
        return mutations.run(
            userId,
            key,
            "leave:" + roomId,
            body,
            SuccessResponse.class,
            () -> rooms.authorize(roomId, userId),
            () -> rooms.leave(roomId, userId)
        );
    }

    public Started start(String roomId, String userId, String key, JsonNode body) {
        return mutations.run(
            userId,
            key,
            "start:" + roomId,
            body,
            Started.class,
            () -> rooms.authorize(roomId, userId),
            () -> rooms.start(roomId, userId, RoomRequests.Start.from(body))
        );
    }

    public SavedRecord save(String roomId, String userId, String key, JsonNode body) {
        return mutations.run(
            userId,
            key,
            "record:" + roomId,
            body,
            SavedRecord.class,
            () -> rooms.authorize(roomId, userId),
            () -> records.save(roomId, userId, RoomRequests.SaveRecord.from(body))
        );
    }

    public Reminders claimReminders(String roomId, String userId, String key, JsonNode body) {
        Reminders result = mutations.run(
            userId,
            key,
            "reminders:" + roomId,
            body,
            Reminders.class,
            () -> rooms.authorize(roomId, userId),
            () -> reminders.claim(roomId, userId)
        );
        // A replay can be from another day, or a member may have recorded since it was claimed.
        var valid = result.date().equals(rooms.today())
            ? result
                .reminders()
                .stream()
                .filter(item -> reminders.reminderCurrent(roomId, item))
                .toList()
            : java.util.List.<Reminder>of();
        return new Reminders(true, rooms.today(), valid);
    }
}
