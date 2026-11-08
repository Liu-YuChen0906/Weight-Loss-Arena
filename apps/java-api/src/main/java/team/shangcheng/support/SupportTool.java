package team.shangcheng.support;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import team.shangcheng.privacy.journal.PrivacyJournal;
import team.shangcheng.support.service.SupportService;

/** Operator tool is only activated by explicit process arguments; no HTTP administration routes. */
@Component
@ConditionalOnProperty(name = "tool.support")
@RequiredArgsConstructor
public class SupportTool implements ApplicationRunner {

    private final SupportService service;
    private final PrivacyJournal journal;
    private final Environment env;
    private final ConfigurableApplicationContext context;

    @Override
    public void run(ApplicationArguments args) {
        try (var gate = journal.enter()) {
            switch (env.getRequiredProperty("tool.support")) {
                case "list" -> service.listForOperator().forEach(System.out::println);
                case "resolve" -> {
                    String id = env.getRequiredProperty("tool.id"),
                        operator = env.getRequiredProperty("tool.operator").strip();
                    int changed = service.resolve(id, operator);
                    System.out.println(
                        changed == 1 ? "RESOLVED" : "No open request matched that business ID"
                    );
                }
                default -> throw new IllegalArgumentException(
                    "tool.support must be list or resolve"
                );
            }
        } finally {
            context.close();
        }
    }
}
