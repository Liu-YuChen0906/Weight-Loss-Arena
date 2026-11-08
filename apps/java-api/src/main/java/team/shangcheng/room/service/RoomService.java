package team.shangcheng.room.service;

import static team.shangcheng.common.ResponseDetails.map;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import team.shangcheng.common.Problem;
import team.shangcheng.common.dto.SuccessResponse;
import team.shangcheng.domain.Domain;
import team.shangcheng.identity.service.UserService;
import team.shangcheng.room.dto.RoomRequests;
import team.shangcheng.room.dto.RoomResponses.*;
import team.shangcheng.room.entity.ActiveMembershipEntity;
import team.shangcheng.room.entity.MemberEntity;
import team.shangcheng.room.entity.RoomEntity;
import team.shangcheng.room.mapper.ActiveMembershipMapper;
import team.shangcheng.room.mapper.MemberMapper;
import team.shangcheng.room.mapper.RoomMapper;
import team.shangcheng.room.mapper.StartPreviewMapper;
import team.shangcheng.room.model.Member;
import team.shangcheng.room.model.Room;

@Service
@RequiredArgsConstructor
public class RoomService {

    private final RoomMapper roomMapper;
    private final MemberMapper memberMapper;
    private final ActiveMembershipMapper membershipMapper;
    private final StartPreviewMapper previewMapper;
    private final Clock clock;
    private final UserService users;

    public LocalDate today() {
        return Domain.today(clock);
    }

    @Transactional
    public void expire() {
        var expired = roomMapper.lockExpiredRooms(today());
        for (var room : expired) {
            roomMapper.endRoom(room);
            membershipMapper.delete(
                new LambdaQueryWrapper<ActiveMembershipEntity>().eq(
                    ActiveMembershipEntity::getRoomId,
                    room
                )
            );
        }
    }

    public Room requireRoom(String id, boolean lock) {
        var room = roomMapper.findRoom(id, lock);
        if (room == null) throw new Problem(404, "NOT_FOUND", "小组不存在");
        return room;
    }

    public Member requireMember(String roomId, String userId) {
        var member = memberMapper.findMember(roomId, userId);
        if (member == null) throw new Problem(403, "FORBIDDEN", "你无法访问此小组");
        return member;
    }

    public void authorize(String roomId, String userId) {
        requireMember(roomId, userId);
    }

    private void lobby(Room room) {
        if (!"LOBBY".equals(room.status())) throw new Problem(
            409,
            "ROOM_LOCKED",
            "小组当前不允许此操作"
        );
    }

    public void requireActive(Room room) {
        if (
            !"ACTIVE".equals(room.status()) ||
            Domain.remaining(room.startDate(), room.days(), today()) <= 0
        ) throw new Problem(409, "ROOM_LOCKED", "本期已结束或尚未开始");
    }

    private void owner(Room room, String userId) {
        if (!userId.equals(room.ownerId())) throw new Problem(
            403,
            "FORBIDDEN",
            "只有当前发起人可以操作"
        );
    }

    private void version(Room room, int expectedVersion) {
        if (room.version() != expectedVersion) throw new Problem(
            409,
            "VERSION_CONFLICT",
            "小组信息已更新，请重新确认"
        );
    }

    private void touch(String roomId) {
        roomMapper.incrementVersion(roomId);
    }

    private void freeSlot(String userId) {
        if (membershipMapper.selectById(userId) != null) throw new Problem(
            409,
            "ALREADY_IN_ROOM",
            "你已有一个未结束小组"
        );
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public RoomId create(String userId, RoomRequests.Create request) {
        users.consent(userId);
        freeSlot(userId);
        Problem.require(request.sharingConsent(), "请确认组内数据共享");
        int days = request.days();
        Domain.factor(days);
        String intensity = request.intensity();
        Problem.require(Set.of("低", "中", "高", "极高").contains(intensity), "强度无效");
        if (intensity.equals("极高") && !request.extremeConfirmed()) throw new Problem(
            400,
            "EXTREME_CONFIRMATION",
            "请单独确认极高强度"
        );
        String name = request.name();
        if (name.isEmpty()) name = "晚饭后散步小队";
        String roomId = UUID.randomUUID().toString();
        String code = UUID.randomUUID()
            .toString()
            .replace("-", "")
            .substring(0, 12)
            .toUpperCase(Locale.ROOT);
        var room = new RoomEntity();
        room.setId(roomId);
        room.setName(name);
        room.setIntro(request.intro());
        room.setDays(days);
        room.setIntensity(intensity);
        room.setStatus("LOBBY");
        room.setOwnerId(userId);
        room.setInviteCode(code);
        room.setCreatedAt(clock.instant());
        roomMapper.insert(room);
        addMember(roomId, userId);
        return new RoomId(roomId);
    }

    private String addMember(String roomId, String userId) {
        String id = UUID.randomUUID().toString();
        var member = new MemberEntity();
        member.setId(id);
        member.setRoomId(roomId);
        member.setUserId(userId);
        member.setJoinDate(today());
        member.setJoinedAt(clock.instant());
        memberMapper.insert(member);
        var membership = new ActiveMembershipEntity();
        membership.setUserId(userId);
        membership.setRoomId(roomId);
        membership.setMemberId(id);
        membershipMapper.insert(membership);
        return id;
    }

    private Room byCode(String code, boolean lock) {
        if (!code.matches("[A-Fa-f0-9]{12}")) throw new Problem(
            404,
            "INVITE_INVALID",
            "邀请码无效"
        );
        var room = roomMapper.findByInviteCode(code.toUpperCase(Locale.ROOT), lock);
        if (room == null || "CANCELLED".equals(room.status())) throw new Problem(
            404,
            "INVITE_INVALID",
            "邀请已失效"
        );
        return room;
    }

    public Invitation invite(String code, String userId) {
        var room = byCode(code, false);
        String roomId = room.id();
        if (
            userId != null && memberMapper.findJoinedMemberId(roomId, userId) != null
        ) return new Invitation(new ExistingInvite(room.inviteCode(), roomId));
        if ("ENDED".equals(room.status())) throw new Problem(404, "INVITE_INVALID", "邀请已结束");
        int count = countMembers(roomId);
        int remaining = "ACTIVE".equals(room.status())
            ? Domain.remaining(room.startDate(), room.days(), today())
            : room.days();
        return new Invitation(
            new Invite(
                room.inviteCode(),
                room.name(),
                room.intro(),
                room.days(),
                room.intensity(),
                room.status(),
                count,
                remaining,
                count < 8 && remaining >= 14,
                today(),
                room.version()
            )
        );
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public RoomId join(String code, String userId, RoomRequests.Join request) {
        users.consent(userId);
        var room = byCode(code, true);
        String roomId = room.id();
        if (memberMapper.findJoinedMemberId(roomId, userId) != null) return new RoomId(roomId);
        freeSlot(userId);
        Problem.require(request.sharingConsent(), "请确认组内数据共享");
        int count = countMembers(roomId);
        if (count >= 8) throw new Problem(409, "ROOM_FULL", "小组已满8人");
        if ("ACTIVE".equals(room.status())) {
            request.requireActiveFields();
            requireActive(room);
            if (Domain.remaining(room.startDate(), room.days(), today()) < 14) throw new Problem(
                409,
                "JOIN_WINDOW_CLOSED",
                "剩余不足14天，无法中途加入"
            );
            if (!today().toString().equals(request.date())) throw new Problem(
                409,
                "BUSINESS_DATE_CHANGED",
                "日期已变化，请重新确认",
                map("today", today())
            );
            if (room.version() != request.version()) throw new Problem(
                409,
                "INVITE_CHANGED",
                "小组已变化，请重新确认"
            );
            var height = request.height();
            var weight = request.weight();
            var goal = Domain.goal(
                height,
                weight,
                Domain.remaining(room.startDate(), room.days(), today()),
                room.intensity()
            );
            String memberId = addMember(roomId, userId);
            setPreparation(memberId, height, weight, goal);
        } else {
            lobby(room);
            addMember(roomId, userId);
        }
        touch(roomId);
        return new RoomId(roomId);
    }

    public Preparation prepareGet(String roomId, String userId) {
        var room = requireRoom(roomId, false);
        lobby(room);
        var member = requireMember(roomId, userId);
        return new Preparation(
            member.height(),
            member.startWeight(),
            member.target(),
            member.ready(),
            room.version()
        );
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public Domain.Goal prepare(String roomId, String userId, RoomRequests.Prepare request) {
        users.consent(userId);
        var room = requireRoom(roomId, true);
        lobby(room);
        version(room, request.version());
        var member = requireMember(roomId, userId);
        var height = request.height();
        var weight = request.weight();
        var goal = Domain.goal(height, weight, room.days(), room.intensity());
        setPreparation(member.id(), height, weight, goal);
        touch(roomId);
        return goal;
    }

    private void setPreparation(String id, BigDecimal height, BigDecimal weight, Domain.Goal goal) {
        memberMapper.update(
            new LambdaUpdateWrapper<MemberEntity>()
                .eq(MemberEntity::getId, id)
                .set(MemberEntity::getReady, true)
                .set(MemberEntity::getHeight, height)
                .set(MemberEntity::getStartWeight, weight)
                .set(MemberEntity::getTarget, goal.target())
                .set(MemberEntity::getAlgorithm, goal.algorithm())
        );
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public Edited edit(String roomId, String userId, RoomRequests.Edit request) {
        var room = requireRoom(roomId, true);
        lobby(room);
        owner(room, userId);
        version(room, request.version());
        int days = request.days();
        Domain.factor(days);
        String name = (request.name() == null ? room.name() : request.name());
        if (name.isEmpty()) name = "晚饭后散步小队";
        boolean changed = days != room.days();
        roomMapper.updateRoom(
            name,
            (request.intro() == null ? room.intro() : request.intro()),
            days,
            roomId
        );
        if (changed) clearPreparation(roomId);
        return new Edited(true, changed);
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public SuccessResponse leave(String roomId, String userId) {
        var room = requireRoom(roomId, true);
        lobby(room);
        requireMember(roomId, userId);
        membershipMapper.deleteById(userId);
        leaveMember(roomId, userId);
        var nextOwnerId = memberMapper.findNextOwner(roomId);
        if (nextOwnerId == null) roomMapper.cancelRoom(roomId);
        else if (userId.equals(room.ownerId())) roomMapper.transferOwner(nextOwnerId, roomId);
        else touch(roomId);
        return new SuccessResponse(true);
    }

    private void canStart(Room room, String userId) {
        lobby(room);
        owner(room, userId);
        var members = memberMapper.findReadiness(room.id());
        if (members.size() < 2 || members.stream().anyMatch(ready -> !ready)) throw new Problem(
            409,
            "NOT_READY",
            "至少2人且全员准备后才能开始"
        );
    }

    @Transactional
    public Preview preview(String roomId, String userId) {
        var room = requireRoom(roomId, false);
        canStart(room, userId);
        long expires = clock.millis() + 120000;
        previewMapper.saveStartPreview(roomId, userId, room.version(), today(), expires);
        return new Preview(
            roomId,
            room.name(),
            room.intro(),
            room.days(),
            room.intensity(),
            room.version(),
            today(),
            today().plusDays(room.days() - 1),
            expires
        );
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public Started start(String roomId, String userId, RoomRequests.Start request) {
        var room = requireRoom(roomId, true);
        canStart(room, userId);
        long expires = request.expiresAt();
        var grant = previewMapper.findStartPreview(roomId, userId);
        if (
            grant == null ||
            grant.expiresAt() != expires ||
            grant.version() != room.version() ||
            room.version() != request.version() ||
            !today().equals(grant.businessDate()) ||
            !today().toString().equals(request.date()) ||
            expires <= clock.millis()
        ) throw new Problem(409, "PREVIEW_STALE", "预览已过期或小组已变化，请重新确认");
        roomMapper.startRoom(today(), roomId);
        memberMapper.update(
            new LambdaUpdateWrapper<MemberEntity>()
                .eq(MemberEntity::getRoomId, roomId)
                .eq(MemberEntity::getState, "JOINED")
                .set(MemberEntity::getJoinDate, today())
        );
        previewMapper.deleteStartPreview(roomId);
        return new Started(roomId, today());
    }

    private void clearPreparation(String roomId) {
        memberMapper.update(
            new LambdaUpdateWrapper<MemberEntity>()
                .eq(MemberEntity::getRoomId, roomId)
                .eq(MemberEntity::getState, "JOINED")
                .set(MemberEntity::getReady, false)
                .set(MemberEntity::getTarget, null)
                .set(MemberEntity::getAlgorithm, null)
        );
    }

    private void leaveMember(String roomId, String userId) {
        memberMapper.update(
            new LambdaUpdateWrapper<MemberEntity>()
                .eq(MemberEntity::getRoomId, roomId)
                .eq(MemberEntity::getUserId, userId)
                .eq(MemberEntity::getState, "JOINED")
                .set(MemberEntity::getState, "LEFT")
                .set(MemberEntity::getReady, false)
                .set(MemberEntity::getHeight, null)
                .set(MemberEntity::getStartWeight, null)
                .set(MemberEntity::getTarget, null)
                .set(MemberEntity::getAlgorithm, null)
        );
    }

    private int countMembers(String roomId) {
        return Math.toIntExact(
            memberMapper.selectCount(
                new LambdaQueryWrapper<MemberEntity>()
                    .eq(MemberEntity::getRoomId, roomId)
                    .eq(MemberEntity::getState, "JOINED")
            )
        );
    }
}
