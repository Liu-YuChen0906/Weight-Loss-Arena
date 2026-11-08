package team.shangcheng.identity.controller;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.common.dto.SuccessResponse;
import team.shangcheng.identity.dto.IdentityResponses.Me;
import team.shangcheng.identity.service.UserService;
import team.shangcheng.identity.web.SessionIdentity;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class UserController {

    private final UserService users;
    private final SessionIdentity session;

    @GetMapping("/me")
    public Me me(HttpServletRequest request) {
        return users.me(session.requireUser(request), session.csrf(request));
    }

    @RequestMapping(
        value = { "/me/profile", "/me" },
        method = { RequestMethod.POST, RequestMethod.PATCH }
    )
    public SuccessResponse profile(
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return users.profile(session.uid(request), key, body);
    }
}
