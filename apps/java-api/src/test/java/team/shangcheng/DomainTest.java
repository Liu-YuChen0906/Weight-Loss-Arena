package team.shangcheng;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.stream.*;
import org.junit.jupiter.api.*;
import team.shangcheng.common.*;
import team.shangcheng.domain.Domain;

class DomainTest {

    private static final ObjectMapper JSON = new ObjectMapper()
        .findAndRegisterModules()
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    private JsonNode fixture() throws Exception {
        return JSON.readTree(getClass().getResourceAsStream("/domain-cases.json"));
    }

    @TestFactory
    Stream<DynamicTest> goals() throws Exception {
        return StreamSupport.stream(fixture().path("goals").spliterator(), false).map(c ->
                DynamicTest.dynamicTest("J12 goal " + c.get("input"), () -> {
                    var b = c.get("input");
                    var goal = Domain.goal(
                        Input.number(b, "height"),
                        Input.number(b, "weight"),
                        Input.integer(b, "days"),
                        b.get("intensity").asText()
                    );
                    assertEquals(
                        0,
                        goal.target().compareTo(c.path("expected").get("target").decimalValue())
                    );
                    assertEquals(
                        0,
                        goal.loss().compareTo(c.path("expected").get("loss").decimalValue())
                    );
                    assertEquals(c.path("expected").get("algorithm").asText(), goal.algorithm());
                })
            );
    }

    @TestFactory
    Stream<DynamicTest> factors() throws Exception {
        return StreamSupport.stream(fixture().path("timeFactors").spliterator(), false).map(c ->
            DynamicTest.dynamicTest("J12 factor " + c.get("days"), () ->
                assertEquals(
                    c.get("expected").asDouble(),
                    Domain.factor(c.get("days").asInt()).doubleValue(),
                    1e-12
                )
            )
        );
    }

    @TestFactory
    Stream<DynamicTest> dates() throws Exception {
        return StreamSupport.stream(fixture().path("dates").spliterator(), false).map(c ->
            DynamicTest.dynamicTest("J17 Shanghai date " + c.get("timestamp"), () ->
                assertEquals(
                    c.get("expected").asText(),
                    Domain.today(
                        Clock.fixed(Instant.parse(c.get("timestamp").asText()), ZoneOffset.UTC)
                    ).toString()
                )
            )
        );
    }

    @TestFactory
    Stream<DynamicTest> weights() throws Exception {
        return StreamSupport.stream(fixture().path("weights").spliterator(), false).map(c ->
            DynamicTest.dynamicTest("J17 weight " + c.get("input"), () ->
                assertEquals(
                    0,
                    c
                        .get("expected")
                        .decimalValue()
                        .compareTo(
                            Domain.weight(
                                c.path("input").get("weight").decimalValue(),
                                c.path("input").get("unit").asText()
                            )
                        )
                )
            )
        );
    }

    @TestFactory
    Stream<DynamicTest> statistics() throws Exception {
        return StreamSupport.stream(fixture().path("statistics").spliterator(), false).map(c ->
                DynamicTest.dynamicTest("J21 " + c.get("id").asText(), () -> {
                    var readings = new ArrayList<Domain.Reading>();
                    for (var r : c.get("records"))
                        readings.add(
                            new Domain.Reading(
                                LocalDate.parse(r.get("date").asText()),
                                r.get("weight").decimalValue(),
                                1
                            )
                        );
                    var actual = Domain.stats(
                        LocalDate.parse(c.path("room").get("start_date").asText()),
                        c.path("room").get("days").asInt(),
                        LocalDate.parse(c.path("member").get("join_date").asText()),
                        readings,
                        LocalDate.parse(c.get("today").asText()),
                        c.get("range").asInt()
                    );
                    var tree = JSON.valueToTree(actual);
                    var expected = c.get("expected");
                    for (String key : List.of(
                        "start",
                        "anchor",
                        "count",
                        "denominator",
                        "coverage",
                        "first",
                        "change"
                    ))
                        assertNode(expected.get(key), tree.get(key));
                    assertEquals(expected.get("rows").size(), tree.get("rows").size());
                    for (int i = 0; i < expected.get("rows").size(); i++) for (String key : List.of(
                        "date",
                        "weight",
                        "change",
                        "percent"
                    ))
                        assertNode(
                            expected.get("rows").get(i).get(key),
                            tree.get("rows").get(i).get(key)
                        );
                })
            );
    }

    private void assertNode(JsonNode expected, JsonNode actual) {
        if (expected.isNumber()) assertEquals(
            0,
            expected.decimalValue().compareTo(actual.decimalValue())
        );
        else assertEquals(expected, actual);
    }

    @Test
    void ranking() {
        var ranks = Domain.ranks(
            List.of(
                new Domain.RankInput("a", 1, 2, 3),
                new Domain.RankInput("b", 2, 4, 6),
                new Domain.RankInput("c", 3, 1, 3)
            )
        );
        assertEquals(List.of(1, 1, 3), new ArrayList<>(ranks.values()));
    }

    @TestFactory
    Stream<DynamicTest> invalid() throws Exception {
        return StreamSupport.stream(fixture().path("invalid").spliterator(), false).map(c ->
                DynamicTest.dynamicTest("invalid " + c.get("id").asText(), () -> {
                    var b = c.get("input");
                    var error = assertThrows(Problem.class, () -> {
                        if (c.get("operation").asText().equals("normalizeWeight")) Domain.weight(
                            Input.number(b, "weight"),
                            b.get("unit").asText()
                        );
                        else Domain.goal(
                            Input.number(b, "height"),
                            Input.number(b, "weight"),
                            Input.integer(b, "days"),
                            b.get("intensity").asText()
                        );
                    });
                    assertEquals(400, error.status);
                    assertEquals("VALIDATION", error.code);
                })
            );
    }

    @Test
    void joiningBoundary() {
        assertEquals(
            14,
            Domain.remaining(LocalDate.parse("2026-10-01"), 28, LocalDate.parse("2026-10-15"))
        );
        assertEquals(
            13,
            Domain.remaining(LocalDate.parse("2026-10-01"), 28, LocalDate.parse("2026-10-16"))
        );
        assertEquals(
            0,
            Domain.remaining(LocalDate.parse("2026-10-01"), 28, LocalDate.parse("2026-10-29"))
        );
    }

    @Test
    void futureJoinHasNoDenominator() {
        var summary = Domain.stats(
            LocalDate.parse("2026-10-01"),
            28,
            LocalDate.parse("2026-10-05"),
            List.of(),
            LocalDate.parse("2026-10-03"),
            28
        );
        assertEquals(0, summary.denominator());
        assertNull(summary.coverage());
    }
}
