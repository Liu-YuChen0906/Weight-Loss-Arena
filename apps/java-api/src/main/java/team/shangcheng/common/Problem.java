package team.shangcheng.common;

import java.util.Map;

public class Problem extends RuntimeException {

    public final int status;
    public final String code;
    public final Map<String, Object> details;

    public Problem(int status, String code, String message) {
        this(status, code, message, Map.of());
    }

    public Problem(int status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public static void require(boolean condition, String message) {
        if (!condition) throw new Problem(400, "VALIDATION", message);
    }
}
