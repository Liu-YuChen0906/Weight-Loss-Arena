package team.shangcheng.support.dto;

import java.time.Instant;
import java.util.List;

public final class SupportResponses {

    private SupportResponses() {}

    public record Created(String supportRequestId, String status) {}

    public record Ticket(String id, String message, String status, Instant createdAt) {}

    public record Tickets(List<Ticket> requests) {}
}
