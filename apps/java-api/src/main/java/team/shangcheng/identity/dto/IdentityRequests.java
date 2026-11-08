package team.shangcheng.identity.dto;

import com.fasterxml.jackson.databind.JsonNode;
import team.shangcheng.common.Input;
import team.shangcheng.common.Problem;

public final class IdentityRequests {

    private IdentityRequests() {}

    public record SendCode(String phone) {
        public static SendCode from(JsonNode body) {
            return new SendCode(phoneNumber(body));
        }
    }

    public record Login(String phone, String code) {
        public static Login from(JsonNode body) {
            String phone = phoneNumber(body);
            String code = Input.text(body, "code", "", 6);
            Problem.require(code.matches("\\d{6}"), "验证码须为6位数字");
            return new Login(phone, code);
        }
    }

    public record Profile(String nickname, String avatar, boolean adult, boolean sensitiveConsent) {
        public static Profile from(JsonNode body) {
            return new Profile(
                Input.text(body, "nickname", "", 20),
                Input.text(body, "avatar", "🌱", 4),
                Input.yes(body, "adult"),
                Input.yes(body, "sensitiveConsent")
            );
        }
    }

    private static String phoneNumber(JsonNode body) {
        String phone = Input.text(body, "phone", "", 11);
        Problem.require(phone.matches("^1[3-9]\\d{9}$"), "请输入有效的手机号");
        return phone;
    }
}
