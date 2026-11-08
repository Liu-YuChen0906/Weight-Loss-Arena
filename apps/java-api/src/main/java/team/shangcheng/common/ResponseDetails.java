package team.shangcheng.common;

import java.util.LinkedHashMap;
import java.util.Map;

/** Builds extensible error details; business entities and success responses use typed records. */
public final class ResponseDetails {

    private ResponseDetails() {}

    public static Map<String, Object> map(Object... entries) {
        var out = new LinkedHashMap<String, Object>();
        for (int i = 0; i < entries.length; i += 2) out.put((String) entries[i], entries[i + 1]);
        return out;
    }
}
