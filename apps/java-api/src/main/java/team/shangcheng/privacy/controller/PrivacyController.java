package team.shangcheng.privacy.controller;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.*;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.common.Input;
import team.shangcheng.identity.web.SessionIdentity;
import team.shangcheng.privacy.dto.PrivacyResponses.*;
import team.shangcheng.privacy.service.PrivacyService;

@RestController
@RequestMapping("/api/v1/me")
@RequiredArgsConstructor
public class PrivacyController {

    private final PrivacyService privacy;
    private final SessionIdentity session;

    @GetMapping("/export")
    public Export export(HttpServletRequest request, HttpServletResponse response) {
        var user = session.requireUser(request);
        response.setHeader("Content-Disposition", "attachment; filename=\"my-data.json\"");
        return privacy.export(user);
    }

    @DeleteMapping
    public Deleted delete(@RequestBody JsonNode body, HttpServletRequest request) {
        String userId = session.uid(request);
        Deleted result = privacy.delete(userId, Input.text(body, "confirm", "", 30));
        session.revokeAll(userId);
        session.invalidate(request);
        return result;
    }
}
