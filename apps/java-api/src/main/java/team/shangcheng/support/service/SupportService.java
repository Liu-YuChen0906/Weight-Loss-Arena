package team.shangcheng.support.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import team.shangcheng.common.Input;
import team.shangcheng.common.Mutations;
import team.shangcheng.common.Problem;
import team.shangcheng.support.dto.SupportResponses.*;
import team.shangcheng.support.entity.SupportRequestEntity;
import team.shangcheng.support.mapper.SupportMapper;

@Service
@RequiredArgsConstructor
public class SupportService {

    private final SupportMapper mapper;
    private final Mutations mutations;
    private final Clock clock;

    public Created submit(String userId, String key, JsonNode body) {
        return mutations.run(
            userId,
            key,
            "support",
            body,
            Created.class,
            () -> {},
            () -> {
                String message = Input.text(body, "message", "", 1000);
                Problem.require(!message.isEmpty(), "请填写需要帮助的问题");
                String id = UUID.randomUUID().toString();
                var ticket = new SupportRequestEntity();
                ticket.setId(id);
                ticket.setUserId(userId);
                ticket.setMessage(message);
                ticket.setCreatedAt(clock.instant());
                ticket.setStatus("OPEN");
                mapper.insert(ticket);
                return new Created(id, "OPEN");
            }
        );
    }

    public Tickets list(String userId) {
        return new Tickets(
            mapper
                .selectList(
                    new LambdaQueryWrapper<SupportRequestEntity>()
                        .eq(SupportRequestEntity::getUserId, userId)
                        .orderByDesc(SupportRequestEntity::getCreatedAt)
                        .last("LIMIT 100")
                )
                .stream()
                .map(SupportService::ticket)
                .toList()
        );
    }

    public List<Ticket> listForOperator() {
        return mapper
            .selectList(
                new LambdaQueryWrapper<SupportRequestEntity>()
                    .orderByDesc(SupportRequestEntity::getCreatedAt)
                    .last("LIMIT 100")
            )
            .stream()
            .map(SupportService::ticket)
            .toList();
    }

    public int resolve(String id, String operator) {
        if (operator.isEmpty() || operator.length() > 100) {
            throw new IllegalArgumentException("operator is required");
        }

        return mapper.update(
            new LambdaUpdateWrapper<SupportRequestEntity>()
                .eq(SupportRequestEntity::getId, id)
                .eq(SupportRequestEntity::getStatus, "OPEN")
                .set(SupportRequestEntity::getStatus, "RESOLVED")
                .set(SupportRequestEntity::getResolvedAt, clock.instant())
                .set(SupportRequestEntity::getResolvedBy, operator)
        );
    }

    private static Ticket ticket(SupportRequestEntity entity) {
        return new Ticket(
            entity.getId(),
            entity.getMessage(),
            entity.getStatus(),
            entity.getCreatedAt()
        );
    }
}
