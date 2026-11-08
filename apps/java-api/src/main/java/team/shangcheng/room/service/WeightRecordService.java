package team.shangcheng.room.service;

import static team.shangcheng.common.ResponseDetails.map;

import java.time.Clock;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.shangcheng.common.Problem;
import team.shangcheng.domain.Domain;
import team.shangcheng.identity.service.UserService;
import team.shangcheng.room.dto.RoomRequests;
import team.shangcheng.room.dto.RoomResponses.SavedRecord;
import team.shangcheng.room.mapper.RoomMapper;
import team.shangcheng.room.mapper.WeightRecordMapper;

@Service
@RequiredArgsConstructor
public class WeightRecordService {

    private final RoomService rooms;
    private final UserService users;
    private final WeightRecordMapper records;
    private final RoomMapper roomMapper;
    private final Clock clock;

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public SavedRecord save(String roomId, String userId, RoomRequests.SaveRecord request) {
        users.consent(userId);
        var room = rooms.requireRoom(roomId, true);
        rooms.requireActive(room);
        rooms.requireMember(roomId, userId);
        if (!rooms.today().toString().equals(request.date())) throw new Problem(
            409,
            "BUSINESS_DATE_CHANGED",
            "日期已变化，请重新确认",
            map("today", rooms.today())
        );
        var kilograms = Domain.weight(request.weight(), request.unit());
        int version = request.version();
        var old = records.lockRecord(roomId, userId, rooms.today());
        if ((old == null ? 0 : old.version()) != version) throw new Problem(
            409,
            "VERSION_CONFLICT",
            "今日记录已更新，请核对最新数值",
            map(
                "latest",
                old == null ? null : map("weight", old.weight(), "version", old.version())
            )
        );
        if (old != null && !request.overwrite()) throw new Problem(
            409,
            "OVERWRITE_REQUIRED",
            "请确认修改今日记录"
        );
        if (old == null) records.insertRecord(
            roomId,
            userId,
            rooms.today(),
            kilograms,
            clock.instant()
        );
        else records.updateRecord(
            kilograms,
            clock.instant(),
            roomId,
            userId,
            rooms.today(),
            version
        );
        roomMapper.incrementVersion(roomId);
        return new SavedRecord(rooms.today(), kilograms, version + 1);
    }
}
