package team.shangcheng.common;

import com.fasterxml.jackson.databind.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Clock;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import team.shangcheng.common.idempotency.mapper.IdempotencyMapper;

@Component
public class Mutations {

    private final IdempotencyMapper mapper;
    private final ObjectMapper json;
    private final Clock clock;
    private final TransactionTemplate tx;

    public Mutations(
        IdempotencyMapper mapper,
        ObjectMapper json,
        Clock clock,
        PlatformTransactionManager manager
    ) {
        this.mapper = mapper;
        this.json = json;
        this.clock = clock;
        this.tx = new TransactionTemplate(manager);
    }

    /** The user lock, authorization, business writes and replay record share ONE transaction. */
    public <T> T run(
        String userId,
        String key,
        String operation,
        JsonNode body,
        Class<T> responseType,
        Runnable authorization,
        Supplier<T> action
    ) {
        if (key == null || !key.matches("^[a-zA-Z0-9_-]{8,100}$")) throw new Problem(
            400,
            "IDEMPOTENCY_REQUIRED",
            "缺少有效的请求编号"
        );
        String bodyHash = hash(canonical(body));
        return tx.execute(status -> {
            if (mapper.lockUser(userId) == null) throw new Problem(
                401,
                "UNAUTHENTICATED",
                "请重新登录"
            );
            authorization.run();
            var old = mapper.find(userId, key);
            if (old != null) {
                if (
                    !operation.equals(old.operation()) || !bodyHash.equals(old.bodyHash())
                ) throw new Problem(409, "IDEMPOTENCY_CONFLICT", "请求编号已用于其他操作");
                try {
                    return json.readValue(old.resultJson(), responseType);
                } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
                    throw new IllegalStateException(e);
                }
            }
            T result = action.get();
            try {
                mapper.insert(
                    userId,
                    key,
                    operation,
                    bodyHash,
                    json.writeValueAsString(result),
                    clock.instant()
                );
            } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
                throw new IllegalStateException(e);
            }
            return result;
        });
    }

    public static String hash(String value) {
        try {
            return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))
            );
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private String canonical(JsonNode node) {
        if (node.isObject()) {
            var keys = new TreeSet<String>();
            node.fieldNames().forEachRemaining(keys::add);
            var b = new StringBuilder("{");
            for (var key : keys)
                b
                    .append(json.valueToTree(key).toString())
                    .append(':')
                    .append(canonical(node.get(key)))
                    .append(',');
            return b.append('}').toString();
        }
        if (node.isArray()) {
            var b = new StringBuilder("[");
            node.forEach(v -> b.append(canonical(v)).append(','));
            return b.append(']').toString();
        }
        return node.isNumber()
            ? node.decimalValue().stripTrailingZeros().toPlainString()
            : node.toString();
    }
}
