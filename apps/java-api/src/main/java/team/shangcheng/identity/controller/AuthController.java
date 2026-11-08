package team.shangcheng.identity.controller;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.common.Input;
import team.shangcheng.common.dto.SuccessResponse;
import team.shangcheng.identity.dto.IdentityRequests;
import team.shangcheng.identity.dto.IdentityResponses;
import team.shangcheng.identity.service.AuthService;
import team.shangcheng.identity.service.UserService;
import team.shangcheng.identity.web.SessionIdentity;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService auth;
    private final UserService users;
    private final SessionIdentity session;

    @PostMapping("/code")
    public IdentityResponses.Code code(@RequestBody JsonNode body, HttpServletRequest request) {
        return auth.send(IdentityRequests.SendCode.from(body), request.getRemoteAddr());
    }

    @PostMapping("/login")
    public IdentityResponses.Login login(@RequestBody JsonNode body, HttpServletRequest request) {
        String userId = auth.login(IdentityRequests.Login.from(body), request.getRemoteAddr());
        return establish(userId, request);
    }

    @PostMapping("/test-login")
    public IdentityResponses.Login testLogin(
        @RequestBody JsonNode body,
        HttpServletRequest request
    ) {
        String userId = auth.testLogin(Input.text(body, "code", "", 100), request.getRemoteAddr());
        return establish(userId, request);
    }

    @PostMapping("/logout")
    public SuccessResponse logout(HttpServletRequest request) {
        session.requireUser(request);
        session.invalidate(request);
        return SuccessResponse.success();
    }

    private IdentityResponses.Login establish(String userId, HttpServletRequest request) {
        var user = session.establish(userId, request);
        return new IdentityResponses.Login(users.view(user, session.csrf(request)));
    }
}
