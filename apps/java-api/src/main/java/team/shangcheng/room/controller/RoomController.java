package team.shangcheng.room.controller;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.common.dto.SuccessResponse;
import team.shangcheng.domain.Domain;
import team.shangcheng.identity.web.SessionIdentity;
import team.shangcheng.room.dto.RoomResponses.*;
import team.shangcheng.room.service.ReminderService;
import team.shangcheng.room.service.RoomApplicationService;
import team.shangcheng.room.service.RoomQueryService;
import team.shangcheng.room.service.RoomService;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class RoomController {

    private final RoomService rooms;
    private final RoomQueryService queries;
    private final RoomApplicationService commands;
    private final SessionIdentity session;
    private final ReminderService reminderService;

    @PostMapping("/rooms")
    public RoomId create(
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return commands.create(session.uid(request), key, body);
    }

    @PostMapping("/invites/{code}")
    public RoomId join(
        @PathVariable String code,
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return commands.join(code, session.uid(request), key, body);
    }

    @PatchMapping("/rooms/{id}")
    public Edited edit(
        @PathVariable String id,
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return commands.edit(id, session.uid(request), key, body);
    }

    @PutMapping("/rooms/{id}/preparation")
    public Domain.Goal prepare(
        @PathVariable String id,
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return commands.prepare(id, session.uid(request), key, body);
    }

    @PostMapping("/rooms/{id}/leave")
    public SuccessResponse leave(
        @PathVariable String id,
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return commands.leave(id, session.uid(request), key, body);
    }

    @PostMapping("/rooms/{id}/start")
    public Started start(
        @PathVariable String id,
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return commands.start(id, session.uid(request), key, body);
    }

    @PutMapping("/rooms/{id}/records")
    public SavedRecord saveRecord(
        @PathVariable String id,
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return commands.save(id, session.uid(request), key, body);
    }

    @PostMapping("/rooms/{id}/reminders")
    public Reminders claimReminders(
        @PathVariable String id,
        @RequestBody JsonNode body,
        HttpServletRequest request,
        @RequestHeader(value = "Idempotency-Key", required = false) String key
    ) {
        return commands.claimReminders(id, session.uid(request), key, body);
    }

    @GetMapping("/rooms/{id}")
    public Snapshot snapshot(
        @PathVariable String id,
        @RequestParam(defaultValue = "28") int range,
        HttpServletRequest request
    ) {
        return queries.snapshot(id, session.uid(request), range);
    }

    @GetMapping("/rooms/{id}/preparation")
    public Preparation preparation(@PathVariable String id, HttpServletRequest request) {
        return rooms.prepareGet(id, session.uid(request));
    }

    @GetMapping("/rooms/{id}/start-preview")
    public Preview preview(@PathVariable String id, HttpServletRequest request) {
        return rooms.preview(id, session.uid(request));
    }

    @GetMapping("/rooms/{id}/reminders")
    public Reminders reminders(@PathVariable String id, HttpServletRequest request) {
        return reminderService.list(id, session.uid(request));
    }

    @GetMapping("/history")
    public History history(HttpServletRequest request) {
        return queries.history(session.uid(request));
    }
}
