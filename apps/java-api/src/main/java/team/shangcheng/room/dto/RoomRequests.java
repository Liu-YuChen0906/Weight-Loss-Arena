package team.shangcheng.room.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import team.shangcheng.common.Input;
import team.shangcheng.common.Problem;

/** Strict boundary decoding preserves the API's numeric types and existing defaults. */
public final class RoomRequests {

    private RoomRequests() {}

    public record Create(
        String name,
        String intro,
        int days,
        String intensity,
        boolean sharingConsent,
        boolean extremeConfirmed
    ) {
        public static Create from(JsonNode body) {
            return new Create(
                Input.text(body, "name", "", 24),
                Input.text(body, "intro", "", 200),
                Input.integer(body, "days"),
                Input.text(body, "intensity", "低", 2),
                Input.yes(body, "sharingConsent"),
                Input.yes(body, "extremeConfirmed")
            );
        }
    }

    public record Join(
        boolean sharingConsent,
        String date,
        Integer version,
        BigDecimal height,
        BigDecimal weight
    ) {
        public static Join from(JsonNode body) {
            return new Join(
                Input.yes(body, "sharingConsent"),
                Input.text(body, "date", "", 10),
                body.has("version") ? Input.integer(body, "version") : null,
                body.has("height") ? Input.number(body, "height") : null,
                body.has("weight") ? Input.number(body, "weight") : null
            );
        }

        public void requireActiveFields() {
            Problem.require(version != null, "version须为数字");
            Problem.require(height != null, "height须为数字");
            Problem.require(weight != null, "weight须为数字");
        }
    }

    public record Prepare(BigDecimal height, BigDecimal weight, int version) {
        public static Prepare from(JsonNode body) {
            return new Prepare(
                Input.number(body, "height"),
                Input.number(body, "weight"),
                Input.integer(body, "version")
            );
        }
    }

    public record Edit(String name, String intro, int days, int version) {
        public static Edit from(JsonNode body) {
            return new Edit(
                body.has("name") ? Input.text(body, "name", "", 24) : null,
                body.has("intro") ? Input.text(body, "intro", "", 200) : null,
                Input.integer(body, "days"),
                Input.integer(body, "version")
            );
        }
    }

    public record Start(String date, int version, long expiresAt) {
        public static Start from(JsonNode body) {
            long expiresAt;
            try {
                expiresAt = Input.number(body, "expiresAt").longValueExact();
            } catch (ArithmeticException e) {
                throw new Problem(400, "VALIDATION", "预览时间无效");
            }
            return new Start(
                Input.text(body, "date", "", 10),
                Input.integer(body, "version"),
                expiresAt
            );
        }
    }

    public record SaveRecord(
        String date,
        BigDecimal weight,
        String unit,
        int version,
        boolean overwrite
    ) {
        public static SaveRecord from(JsonNode body) {
            return new SaveRecord(
                Input.text(body, "date", "", 10),
                Input.number(body, "weight"),
                Input.text(body, "unit", "kg", 3),
                Input.integer(body, "version"),
                Input.yes(body, "overwrite")
            );
        }
    }
}
