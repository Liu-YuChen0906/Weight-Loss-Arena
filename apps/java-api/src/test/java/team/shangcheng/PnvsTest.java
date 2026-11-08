package team.shangcheng;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import team.shangcheng.identity.PnvsClient;

class PnvsTest {

    private final ObjectMapper json = new ObjectMapper();

    private PnvsClient.Config config(int timeout) {
        return new PnvsClient.Config(
            "synthetic-key",
            "synthetic-secret",
            "合成签名",
            "100001",
            null,
            timeout
        );
    }

    @Test
    void platformGeneratesAndBindsTheCode() throws Exception {
        try (
            var client = new PnvsClient(
                config(500),
                (uri, headers, timeout) -> {
                    String query = java.net.URLDecoder.decode(
                        uri.getRawQuery(),
                        java.nio.charset.StandardCharsets.UTF_8
                    );
                    assertTrue(query.contains("ReturnVerifyCode=false"));
                    assertTrue(query.contains("AutoRetry=0"));
                    assertTrue(query.contains("##code##"));
                    assertFalse(query.contains("VerifyCode=654321"));
                    assertEquals("SendSmsVerifyCode", headers.get("x-acs-action"));
                    assertTrue(
                        headers
                            .get("Authorization")
                            .startsWith("ACS3-HMAC-SHA256 Credential=synthetic-key")
                    );
                    return new PnvsClient.Reply(
                        200,
                        json.readTree(
                            "{\"Code\":\"OK\",\"Success\":true,\"Model\":{\"BizId\":\"synthetic-biz\",\"OutId\":\"dispatch-1\"}}"
                        )
                    );
                },
                Clock.fixed(Instant.parse("2026-10-29T00:00:00Z"), ZoneOffset.UTC),
                () -> "synthetic-nonce"
            );
        ) {
            assertEquals(PnvsClient.Outcome.ACCEPTED, client.send("13900001001", "dispatch-1"));
        }
    }

    @Test
    void mismatchedDispatchCannotPass() throws Exception {
        try (
            var client = new PnvsClient(
                config(500),
                (u, h, t) ->
                    new PnvsClient.Reply(
                        200,
                        json.readTree(
                            "{\"Code\":\"OK\",\"Success\":true,\"Model\":{\"OutId\":\"other\",\"VerifyResult\":\"PASS\"}}"
                        )
                    ),
                Clock.systemUTC(),
                () -> "nonce"
            );
        ) {
            assertThrows(PnvsClient.ProviderFailure.class, () ->
                client.verify("13900001001", "654321", "dispatch-1")
            );
        }
    }

    @Test
    void latePassDoesNotTurnTimeoutIntoSuccess() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        try (
            var client = new PnvsClient(
                config(10),
                (u, h, t) -> {
                    calls.incrementAndGet();
                    try {
                        Thread.sleep(150);
                    } catch (InterruptedException ignored) {}
                    return new PnvsClient.Reply(
                        200,
                        json.readTree(
                            "{\"Code\":\"OK\",\"Success\":true,\"Model\":{\"OutId\":\"dispatch-1\",\"VerifyResult\":\"PASS\"}}"
                        )
                    );
                },
                Clock.systemUTC(),
                () -> "nonce"
            );
        ) {
            var failure = assertThrows(PnvsClient.ProviderFailure.class, () ->
                client.verify("13900001001", "654321", "dispatch-1")
            );
            assertEquals("UNKNOWN", failure.state);
            assertEquals(1, calls.get());
        }
    }

    @Test
    void providerInvalidIsNotAnOutage() throws Exception {
        try (
            var client = new PnvsClient(
                config(500),
                (u, h, t) ->
                    new PnvsClient.Reply(
                        200,
                        json.readTree(
                            "{\"Code\":\"OK\",\"Success\":true,\"Model\":{\"OutId\":\"dispatch-1\",\"VerifyResult\":\"UNKNOWN\"}}"
                        )
                    ),
                Clock.systemUTC(),
                () -> "nonce"
            );
        ) {
            assertEquals(
                PnvsClient.Outcome.INVALID,
                client.verify("13900001001", "654321", "dispatch-1")
            );
        }
    }

    @Test
    void balanceAndConfigStayExplicit() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> config(15001));
        assertEquals("PnvsConfig[redacted]", config(500).toString());
        try (
            var client = new PnvsClient(
                config(500),
                (u, h, t) ->
                    new PnvsClient.Reply(400, json.readTree("{\"Code\":\"RESOURCE_NOT_ENOUGH\"}")),
                Clock.systemUTC(),
                () -> "nonce"
            );
        ) {
            var failure = assertThrows(PnvsClient.ProviderFailure.class, () ->
                client.send("13900001001", "dispatch-1")
            );
            assertTrue(failure.balance);
            assertEquals("FAILED", failure.state);
        }
    }
}
