package team.shangcheng.common.dto;

public record SuccessResponse(boolean ok) {
    public static SuccessResponse success() {
        return new SuccessResponse(true);
    }
}
