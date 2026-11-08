# 代码可读性

- 正常换行和缩进，不把多个语句、方法、Vue 模板元素或 CSS 规则压在一行。
- 相邻但职责不同的逻辑之间留空行；复杂条件和较长的参数列表分行书写。
- Java 使用 4 个空格缩进，Vue／TypeScript／CSS 使用 2 个空格缩进。
- 遵循根目录 `.prettierrc.json` 和 `.editorconfig`；修改后运行 `pnpm run format`，用 `pnpm run format:check` 检查格式。
- 已执行的 Flyway 迁移脚本具有内容校验，不能仅为排版修改其原文；数据库变更使用新的迁移版本。
