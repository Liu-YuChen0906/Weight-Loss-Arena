package team.shangcheng.privacy.service;

import java.time.Clock;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import team.shangcheng.common.Problem;
import team.shangcheng.identity.model.User;
import team.shangcheng.privacy.dto.PrivacyResponses.*;
import team.shangcheng.privacy.journal.PrivacyJournal;
import team.shangcheng.privacy.mapper.ExportMapper;

@Service
@RequiredArgsConstructor
public class PrivacyService {

    private final ExportMapper exports;
    private final PrivacyJournal journal;
    private final Clock clock;

    public Export export(User user) {
        return new Export(
            clock.instant(),
            new ExportUser(
                user.id(),
                user.nickname(),
                user.avatar(),
                user.phone().startsWith("test:") ? "测试身份" : user.phone()
            ),
            exports.memberships(user.id()),
            exports.records(user.id())
        );
    }

    public Deleted delete(String userId, String confirmation) {
        if (!"注销并删除我的数据".equals(confirmation)) throw new Problem(
            400,
            "CONFIRM_REQUIRED",
            "请输入完整的注销确认文字"
        );
        String event = journal.delete(userId);
        return new Deleted(true, new Deletion(event, "COMPLETED", "REPLAY_REQUIRED"));
    }
}
