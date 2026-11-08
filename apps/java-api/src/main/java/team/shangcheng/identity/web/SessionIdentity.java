package team.shangcheng.identity.web;

import jakarta.servlet.http.HttpServletRequest;
import java.time.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.web.csrf.*;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Component;
import team.shangcheng.common.Problem;
import team.shangcheng.identity.model.User;
import team.shangcheng.identity.service.UserService;

/** Servlet/session integration stays at the HTTP boundary, outside business services. */
@Component
@RequiredArgsConstructor
public class SessionIdentity {

    private final UserService users;
    private final Clock clock;
    private final FindByIndexNameSessionRepository<? extends Session> sessions;

    public User requireUser(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session == null || session.getAttribute("uid") == null) throw unauthenticated();
        Long issued = (Long) session.getAttribute("issuedAt");
        if (issued == null || clock.millis() - issued >= Duration.ofDays(7).toMillis()) {
            session.invalidate();
            throw unauthenticated();
        }
        User user = users.findById(session.getAttribute("uid").toString());
        if (user == null) {
            session.invalidate();
            throw unauthenticated();
        }
        return user;
    }

    public String uid(HttpServletRequest request) {
        return requireUser(request).id();
    }

    public String optionalUid(HttpServletRequest request) {
        try {
            return uid(request);
        } catch (Problem problem) {
            if (problem.status == 401) return null;
            throw problem;
        }
    }

    public User establish(String userId, HttpServletRequest request) {
        invalidate(request);
        var session = request.getSession(true);
        session.setAttribute("uid", userId);
        session.setAttribute("issuedAt", clock.millis());
        session.setAttribute(FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, userId);
        session.setMaxInactiveInterval(604800);
        var repository = new HttpSessionCsrfTokenRepository();
        repository.setHeaderName("X-CSRF-Token");
        var token = repository.generateToken(request);
        repository.saveToken(token, request, null);
        request.setAttribute(CsrfToken.class.getName(), token);
        request.setAttribute("_csrf", token);
        return requireUser(request);
    }

    public String csrf(HttpServletRequest request) {
        var token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        return token == null ? null : token.getToken();
    }

    public void invalidate(HttpServletRequest request) {
        var session = request.getSession(false);
        if (session != null) session.invalidate();
    }

    public void revokeAll(String userId) {
        for (var session : sessions.findByPrincipalName(userId).values())
            sessions.deleteById(session.getId());
    }

    private Problem unauthenticated() {
        return new Problem(401, "UNAUTHENTICATED", "请先登录");
    }
}
