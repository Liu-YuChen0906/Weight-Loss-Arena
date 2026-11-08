package team.shangcheng.domain;

import static team.shangcheng.common.Problem.require;

import java.math.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;

public final class Domain {

    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    public static final String ALGORITHM = "bmi22-piecewise-v1";
    private static final MathContext MC = MathContext.DECIMAL128;

    private Domain() {}

    public static LocalDate today(Clock clock) {
        return LocalDate.now(clock.withZone(ZONE));
    }

    public static BigDecimal round(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }

    public static BigDecimal factor(int days) {
        require(days >= 14 && days <= 90, "周期须为14至90天");
        if (days <= 28) return new BigDecimal("0.6").add(
            new BigDecimal(days - 14).multiply(new BigDecimal("0.4")).divide(new BigDecimal(14), MC)
        );
        if (days <= 56) return BigDecimal.ONE.add(
            new BigDecimal(days - 28).multiply(new BigDecimal("0.8")).divide(new BigDecimal(28), MC)
        );
        return new BigDecimal("1.8").add(
            new BigDecimal(days - 56).multiply(new BigDecimal("0.8")).divide(new BigDecimal(34), MC)
        );
    }

    public record Goal(BigDecimal target, BigDecimal loss, String algorithm) {}

    public static Goal goal(BigDecimal height, BigDecimal weight, int days, String intensity) {
        require(
            height.compareTo(new BigDecimal(80)) >= 0 && height.compareTo(new BigDecimal(250)) <= 0,
            "身高须为80至250厘米"
        );
        checkWeight(weight);
        BigDecimal d = switch (intensity) {
            case "低" -> new BigDecimal("0.02");
            case "中" -> new BigDecimal("0.03");
            case "高" -> new BigDecimal("0.04");
            case "极高" -> new BigDecimal("0.05");
            default -> throw new team.shangcheng.common.Problem(400, "VALIDATION", "强度无效");
        };
        var h = height.movePointLeft(2);
        var s = weight
            .divide(h.multiply(h), MC)
            .divide(new BigDecimal(22), MC)
            .max(new BigDecimal("0.75"))
            .min(new BigDecimal("1.25"));
        var target = round(weight.subtract(weight.multiply(d).multiply(s).multiply(factor(days))));
        return new Goal(target, round(weight.subtract(target)), ALGORITHM);
    }

    private static void checkWeight(BigDecimal w) {
        require(
            w.compareTo(new BigDecimal(20)) >= 0 && w.compareTo(new BigDecimal(300)) <= 0,
            "体重须为20至300公斤"
        );
    }

    public static BigDecimal weight(BigDecimal value, String unit) {
        require(unit.equals("kg") || unit.equals("jin"), "单位无效");
        var kg = unit.equals("jin") ? value.divide(new BigDecimal(2)) : value;
        checkWeight(kg);
        return round(kg);
    }

    public static int remaining(LocalDate start, int days, LocalDate today) {
        return Math.max(0, (int) ChronoUnit.DAYS.between(today, start.plusDays(days)));
    }

    public record Reading(LocalDate date, BigDecimal weight, int version) {}

    public record Point(LocalDate date, BigDecimal weight, BigDecimal change, BigDecimal percent) {}

    public record Summary(
        LocalDate start,
        LocalDate anchor,
        int count,
        int denominator,
        BigDecimal coverage,
        BigDecimal first,
        Reading latest,
        BigDecimal change,
        List<Point> rows
    ) {}

    public static Summary stats(
        LocalDate start,
        int days,
        LocalDate joined,
        List<Reading> input,
        LocalDate today,
        int range
    ) {
        require(Set.of(7, 28, 90).contains(range), "范围须为7、28或90天");
        var anchor = today.isBefore(start.plusDays(days - 1)) ? today : start.plusDays(days - 1);
        var from = Collections.max(List.of(anchor.minusDays(range - 1), start, joined));
        int denominator = Math.max(0, (int) ChronoUnit.DAYS.between(from, anchor) + 1);
        var all = input
            .stream()
            .filter(
                r -> !r.date.isBefore(start) && !r.date.isBefore(joined) && !r.date.isAfter(anchor)
            )
            .sorted(Comparator.comparing(Reading::date))
            .toList();
        BigDecimal first = all.isEmpty() ? null : all.getFirst().weight;
        var visible = all
            .stream()
            .filter(r -> !r.date.isBefore(from))
            .toList();
        var rows = visible
            .stream()
            .map(r -> {
                var change = r.weight.subtract(first);
                return new Point(
                    r.date,
                    r.weight,
                    round(change),
                    round(change.multiply(new BigDecimal(100)).divide(first, MC))
                );
            })
            .toList();
        var latest = all.isEmpty() ? null : all.getLast();
        return new Summary(
            from,
            anchor,
            visible.size(),
            denominator,
            denominator == 0
                ? null
                : round(
                    new BigDecimal(visible.size() * 100).divide(new BigDecimal(denominator), MC)
                ),
            first,
            latest,
            all.size() < 2 ? null : round(latest.weight.subtract(first)),
            rows
        );
    }

    public record RankInput(String id, int order, int count, int denominator) {}

    private static int compare(RankInput a, RankInput b) {
        return Long.compare(
            (long) b.count * Math.max(1, a.denominator),
            (long) a.count * Math.max(1, b.denominator)
        );
    }

    public static Map<String, Integer> ranks(List<RankInput> input) {
        var sorted = input
            .stream()
            .sorted((a, b) -> {
                int c = compare(a, b);
                return c == 0 ? Integer.compare(a.order, b.order) : c;
            })
            .toList();
        var out = new LinkedHashMap<String, Integer>();
        int rank = 0;
        for (int i = 0; i < sorted.size(); i++) {
            if (i == 0 || compare(sorted.get(i), sorted.get(i - 1)) != 0) rank = i + 1;
            out.put(sorted.get(i).id, rank);
        }
        return out;
    }
}
