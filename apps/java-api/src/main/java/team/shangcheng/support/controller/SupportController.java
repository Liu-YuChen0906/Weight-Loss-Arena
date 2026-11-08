package team.shangcheng.support.controller;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.identity.web.SessionIdentity;
import team.shangcheng.support.dto.SupportResponses.*;
import team.shangcheng.support.service.SupportService;

@RestController
@RequestMapping("/api/v1/support")
@RequiredArgsConstructor
public class SupportController {

    private final SupportService support;
    private final SessionIdentity session;

    @PostMapping
    public Created submit(
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return support.submit(session.uid(request), key, body);
    }

    @GetMapping
    public Tickets list(HttpServletRequest request) {
        return support.list(session.uid(request));
    }
}
