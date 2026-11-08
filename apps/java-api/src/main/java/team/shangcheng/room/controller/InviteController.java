package team.shangcheng.room.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.common.Mutations;
import team.shangcheng.identity.service.RateLimitService;
import team.shangcheng.identity.web.SessionIdentity;
import team.shangcheng.room.dto.RoomResponses.Invitation;
import team.shangcheng.room.service.RoomService;

@RestController
@RequestMapping("/api/v1/invites")
@RequiredArgsConstructor
public class InviteController {

    private final RoomService rooms;
    private final RateLimitService limits;
    private final SessionIdentity session;

    @GetMapping("/{code}")
    public Invitation invite(@PathVariable String code, HttpServletRequest request) {
        limits.check("invite:" + Mutations.hash(request.getRemoteAddr()), 100, 3600);
        return rooms.invite(code, session.optionalUid(request));
    }
}
