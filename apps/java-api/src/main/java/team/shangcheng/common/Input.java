package team.shangcheng.common;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;

public final class Input {

    private Input() {}

    public static String text(JsonNode n, String key, String fallback, int max) {
        var v = n.get(key);
        Problem.require(v == null || v.isTextual(), key + "须为文字");
        String s = v == null ? fallback : v.textValue().strip();
        Problem.require(s.codePointCount(0, s.length()) <= max, key + "过长");
        return s;
    }

    public static BigDecimal number(JsonNode n, String key) {
        var v = n.get(key);
        Problem.require(v != null && v.isNumber(), key + "须为数字");
        var d = v.decimalValue();
        Problem.require(d.precision() <= 18 && Math.abs(d.scale()) <= 8, key + "精度过高");
        return d;
    }

    public static int integer(JsonNode n, String key) {
        var d = number(n, key);
        try {
            return d.intValueExact();
        } catch (ArithmeticException e) {
            throw new Problem(400, "VALIDATION", key + "须为整数");
        }
    }

    public static boolean yes(JsonNode n, String key) {
        return n.has(key) && n.get(key).isBoolean() && n.get(key).booleanValue();
    }
}
