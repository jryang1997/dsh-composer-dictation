# Domain Docs

采用 single-context：根目录 CONTEXT.md 与 docs/adr/。

探索代码前读取 CONTEXT.md，以及与当前工作有关的 docs/adr/ 记录。
若以后存在 CONTEXT-MAP.md，按其指针读取相关上下文。
文件不存在时直接继续，不预先创建空文档；
由 domain-modeling 等技能在实际明确术语或决策时按需创建。
涉及领域概念时沿用 CONTEXT.md 中的术语。
若方案与现有决策记录冲突，明确指出冲突后再处理。
