package team.shangcheng.system.dto;

public final class SystemResponses {

    private SystemResponses() {}

    public record Health(boolean ok, String storage, String mode) {}

    public record Config(String mode, String login, boolean syntheticOnly, boolean realSms) {}
}
