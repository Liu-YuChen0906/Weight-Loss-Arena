package team.shangcheng.system.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import team.shangcheng.system.dto.SystemResponses;
import team.shangcheng.system.service.SystemService;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class SystemController {

    private final SystemService system;

    @GetMapping("/health")
    public SystemResponses.Health health() {
        return system.health();
    }

    @GetMapping("/config")
    public SystemResponses.Config config() {
        return system.config();
    }
}
