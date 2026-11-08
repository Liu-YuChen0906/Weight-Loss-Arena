package team.shangcheng.room.service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import team.shangcheng.domain.Domain;
import team.shangcheng.room.dto.RoomResponses.*;
import team.shangcheng.room.mapper.MemberMapper;
import team.shangcheng.room.mapper.RoomMapper;
import team.shangcheng.room.mapper.WeightRecordMapper;

/** Read projections and statistics; no database writes. */
@Service
@RequiredArgsConstructor
public class RoomQueryService {

    private final RoomMapper roomMapper;
    private final MemberMapper membersMapper;
    private final WeightRecordMapper recordsMapper;
    private final RoomService rooms;

    public Snapshot snapshot(String roomId, String userId, int range) {
        rooms.authorize(roomId, userId);
        var room = rooms.requireRoom(roomId, false);
        var list = membersMapper.findMembersWithProfiles(roomId);
        List<MemberView> members = new ArrayList<>();
        List<Domain.RankInput> ranks = new ArrayList<>();
        for (var member : list) {
            var records = recordsMapper.findReadings(roomId, member.userId());
            var start = room.startDate() == null ? member.joinDate() : room.startDate();
            var summary = Domain.stats(
                start,
                room.days(),
                member.joinDate(),
                records,
                rooms.today(),
                range
            );
            var full = Domain.stats(
                start,
                room.days(),
                member.joinDate(),
                records,
                rooms.today(),
                90
            );
            ranks.add(
                new Domain.RankInput(
                    member.userId(),
                    member.joinedOrder(),
                    full.count(),
                    full.denominator()
                )
            );
            List<ChartPoint> points = new ArrayList<>(
                summary
                    .rows()
                    .stream()
                    .map(point ->
                        new ChartPoint(
                            point.date(),
                            point.weight(),
                            null,
                            point.change(),
                            point.percent()
                        )
                    )
                    .toList()
            );
            LocalDate joined = member.joinDate();
            if (
                member.startWeight() != null &&
                !joined.isBefore(summary.start()) &&
                !joined.isAfter(summary.anchor()) &&
                records.stream().noneMatch(p -> p.date().equals(joined))
            ) points.addFirst(
                new ChartPoint(joined, member.startWeight(), "preparation", null, null)
            );
            var last = records.isEmpty() ? null : records.getLast();
            boolean isLobby = "LOBBY".equals(room.status());
            members.add(
                new MemberView(
                    member.userId(),
                    member.userId(),
                    member.id(),
                    member.nickname(),
                    member.avatar(),
                    member.ready(),
                    member.startWeight(),
                    member.target(),
                    member.algorithm(),
                    isLobby ? null : joined,
                    member.joinedOrder(),
                    isLobby ? null : summary,
                    isLobby ? null : full,
                    isLobby ? List.of() : points,
                    isLobby ? List.of() : summary.rows(),
                    isLobby
                        ? 0
                        : ChronoUnit.DAYS.between(
                            last == null ? joined.minusDays(1) : last.date(),
                            rooms.today()
                        ),
                    last != null && last.date().equals(rooms.today()) ? last : null
                )
            );
        }
        var result = new Snapshot(
            new RoomView(
                roomId,
                room.name(),
                room.intro(),
                room.days(),
                room.intensity(),
                room.status(),
                room.ownerId(),
                room.inviteCode(),
                room.version(),
                room.startDate(),
                room.startDate() == null ? null : room.startDate().plusDays(room.days() - 1),
                room.startDate() == null
                    ? room.days()
                    : Domain.remaining(room.startDate(), room.days(), rooms.today())
            ),
            members,
            Domain.ranks(ranks),
            rooms.today(),
            range
        );
        return result;
    }

    public History history(String userId) {
        return new History(roomMapper.findHistory(userId));
    }
}
