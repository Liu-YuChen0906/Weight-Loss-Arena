package team.shangcheng.identity;

import com.fasterxml.jackson.databind.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import lombok.RequiredArgsConstructor;
import team.shangcheng.common.Mutations;

/** Offline-testable provider boundary. Not activated by the local/test application. */
@RequiredArgsConstructor
public final class PnvsClient implements AutoCloseable {

    public record Config(
        String accessKeyId,
        String accessKeySecret,
        String signName,
        String templateCode,
        String securityToken,
        int timeoutMs
    ) {
        public Config {
            for (String value : List.of(accessKeyId, accessKeySecret, signName, templateCode))
                if (
                    value.isBlank() ||
                    !value.equals(value.strip()) ||
                    value.contains("\r") ||
                    value.contains("\n")
                ) throw new IllegalArgumentException("Invalid PNVS configuration");
            if (
                !templateCode.matches("\\d+") || timeoutMs < 1 || timeoutMs > 15000
            ) throw new IllegalArgumentException("Invalid PNVS configuration");
            if (
                securityToken != null && securityToken.chars().anyMatch(Character::isWhitespace)
            ) throw new IllegalArgumentException("Invalid PNVS configuration");
        }

        @Override
        public String toString() {
            return "PnvsConfig[redacted]";
        }
    }

    public record Reply(int status, JsonNode body) {}

    @FunctionalInterface
    public interface Transport {
        Reply send(URI uri, Map<String, String> headers, int timeoutMs) throws Exception;
    }

    public enum Outcome {
        ACCEPTED,
        PASS,
        INVALID,
    }

    public static final class ProviderFailure extends RuntimeException {

        public final String state;
        public final boolean balance;

        ProviderFailure(String state, boolean balance) {
            super("SMS provider unavailable");
            this.state = state;
            this.balance = balance;
        }
    }

    private final Config config;
    private final Transport transport;
    private final Clock clock;
    private final Supplier<String> nonce;
    // A bounded queue prevents an uncooperative adapter from creating unlimited late work.
    private final ExecutorService executor = new ThreadPoolExecutor(
        2,
        2,
        30,
        TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(8),
        r -> {
            var t = new Thread(r, "pnvs-bounded");
            t.setDaemon(true);
            return t;
        },
        new ThreadPoolExecutor.AbortPolicy()
    );

    public static Transport http(ObjectMapper json) {
        var client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
        return (uri, headers, timeout) -> {
            var request = HttpRequest.newBuilder(uri)
                .timeout(Duration.ofMillis(timeout))
                .POST(HttpRequest.BodyPublishers.noBody());
            headers.forEach((k, v) -> {
                if (!k.equals("host")) request.header(k, v);
            });
            var result = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (result.body().length() > 65536) throw new ProviderFailure("UNKNOWN", false);
            return new Reply(result.statusCode(), json.readTree(result.body()));
        };
    }

    public Outcome send(String phone, String dispatch) {
        validate(phone, dispatch);
        var params = new TreeMap<String, String>();
        params.putAll(
            Map.of(
                "CountryCode",
                "86",
                "PhoneNumber",
                phone,
                "SignName",
                config.signName,
                "TemplateCode",
                config.templateCode,
                "TemplateParam",
                "{\"code\":\"##code##\",\"min\":\"5\"}",
                "CodeType",
                "1",
                "CodeLength",
                "6",
                "ValidTime",
                "300",
                "DuplicatePolicy",
                "1",
                "Interval",
                "60"
            )
        );
        params.put("ReturnVerifyCode", "false");
        params.put("AutoRetry", "0");
        params.put("OutId", dispatch);
        var model = call("SendSmsVerifyCode", params);
        if (
            model == null ||
            !model.path("BizId").isTextual() ||
            model.path("BizId").asText().isBlank() ||
            !dispatch.equals(model.path("OutId").asText())
        ) throw new ProviderFailure("UNKNOWN", false);
        return Outcome.ACCEPTED;
    }

    public Outcome verify(String phone, String code, String dispatch) {
        validate(phone, dispatch);
        if (code == null || !code.matches("\\d{6}")) throw new ProviderFailure("FAILED", false);
        var model = call(
            "CheckSmsVerifyCode",
            new TreeMap<>(
                Map.of(
                    "CountryCode",
                    "86",
                    "PhoneNumber",
                    phone,
                    "VerifyCode",
                    code,
                    "OutId",
                    dispatch
                )
            )
        );
        if (
            model == null || !dispatch.equals(model.path("OutId").asText())
        ) throw new ProviderFailure("UNKNOWN", false);
        return switch (model.path("VerifyResult").asText()) {
            case "PASS" -> Outcome.PASS;
            case "UNKNOWN" -> Outcome.INVALID;
            default -> throw new ProviderFailure("UNKNOWN", false);
        };
    }

    private static void validate(String phone, String dispatch) {
        if (
            phone == null ||
            !phone.matches("^1[3-9]\\d{9}$") ||
            dispatch == null ||
            !dispatch.matches("[a-zA-Z0-9-]{1,64}")
        ) throw new ProviderFailure("FAILED", false);
    }

    private JsonNode call(String action, SortedMap<String, String> parameters) {
        var query = new StringJoiner("&");
        parameters.forEach((k, v) -> query.add(encode(k) + "=" + encode(v)));
        var headers = new TreeMap<String, String>();
        headers.put("host", "dypnsapi.aliyuncs.com");
        headers.put("x-acs-action", action);
        headers.put("x-acs-version", "2017-05-25");
        headers.put(
            "x-acs-date",
            DateTimeFormatter.ISO_INSTANT.format(clock.instant().truncatedTo(ChronoUnit.SECONDS))
        );
        headers.put("x-acs-signature-nonce", nonce.get());
        headers.put("x-acs-content-sha256", Mutations.hash(""));
        if (config.securityToken != null && !config.securityToken.isBlank()) headers.put(
            "x-acs-security-token",
            config.securityToken
        );
        headers.put(
            "Authorization",
            authorization(config.accessKeyId, config.accessKeySecret, headers, query.toString())
        );
        Future<Reply> future;
        try {
            future = executor.submit(() ->
                transport.send(
                    URI.create("https://dypnsapi.aliyuncs.com/?" + query),
                    headers,
                    config.timeoutMs
                )
            );
        } catch (RejectedExecutionException e) {
            throw new ProviderFailure("UNKNOWN", false);
        }
        Reply reply;
        try {
            reply = future.get(config.timeoutMs, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            future.cancel(true);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new ProviderFailure("UNKNOWN", false);
        }
        var body = reply.body;
        if (
            body != null &&
            reply.status >= 200 &&
            reply.status < 300 &&
            "OK".equals(body.path("Code").asText()) &&
            body.path("Success").asBoolean()
        ) return body.get("Model");
        if (
            body != null &&
            reply.status < 500 &&
            body.path("Code").isTextual() &&
            !"OK".equals(body.path("Code").asText())
        ) throw new ProviderFailure(
            "FAILED",
            Set.of("RESOURCE_NOT_ENOUGH", "isv.OUT_OF_SERVICE").contains(body.path("Code").asText())
        );
        throw new ProviderFailure("UNKNOWN", false);
    }

    static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
            .replace("+", "%20")
            .replace("*", "%2A")
            .replace("%7E", "~");
    }

    public static String authorization(
        String key,
        String secret,
        SortedMap<String, String> headers,
        String query
    ) {
        String signed = String.join(";", headers.keySet());
        var canonicalHeaders = new StringBuilder();
        headers.forEach((k, v) ->
            canonicalHeaders.append(k).append(':').append(v.strip()).append('\n')
        );
        String canonical = String.join(
            "\n",
            "POST",
            "/",
            query,
            canonicalHeaders,
            signed,
            Mutations.hash("")
        );
        try {
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String signature = HexFormat.of().formatHex(
                mac.doFinal(
                    ("ACS3-HMAC-SHA256\n" + Mutations.hash(canonical)).getBytes(
                        StandardCharsets.UTF_8
                    )
                )
            );
            return (
                "ACS3-HMAC-SHA256 Credential=" +
                key +
                ",SignedHeaders=" +
                signed +
                ",Signature=" +
                signature
            );
        } catch (Exception e) {
            throw new IllegalStateException("Signer unavailable");
        }
    }

    @Override
    public void close() {
        executor.shutdownNow();
    }
}
