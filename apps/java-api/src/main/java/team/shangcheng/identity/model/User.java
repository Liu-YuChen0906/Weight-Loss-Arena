package team.shangcheng.identity.model;

/** Internal account data. Never return this entity directly from an HTTP endpoint. */
public record User(String id, String phone, String nickname, String avatar, String consentVersion) {
    public boolean hasConsent() {
        return consentVersion != null;
    }
}
