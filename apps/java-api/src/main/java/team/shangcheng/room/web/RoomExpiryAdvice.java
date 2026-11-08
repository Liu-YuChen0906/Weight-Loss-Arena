package team.shangcheng.room.web;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.room.service.RoomService;

/** Preserve request-time expiry for every API endpoint after splitting the old controller. */
@ControllerAdvice(
    basePackages = {
        "team.shangcheng.identity.controller",
        "team.shangcheng.room.controller",
        "team.shangcheng.privacy.controller",
        "team.shangcheng.support.controller",
        "team.shangcheng.system.controller",
    }
)
@RequiredArgsConstructor
public class RoomExpiryAdvice {

    private final RoomService rooms;

    @ModelAttribute
    public void expire(HttpServletRequest request) {
        if (!request.getRequestURI().equals("/api/v1/health")) rooms.expire();
    }
}
