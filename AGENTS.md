# AGENTS.md

本文件为 CodexPlusPlus fork 的工作规范，指导 agent 在本仓库工作。

## 项目概述

本仓库是 [BigPizzaV3/CodexPlusPlus](https://github.com/BigPizzaV3/CodexPlusPlus) 的 fork，目标是实现「按模型粒度配置上下文窗口与自动压缩阈值」feature（对应 issue #1171 / #931）。

采用 codex 原生 `model_catalog_json` 机制：通过 `model_list` 后缀语法（如 `deepseek-v4-pro[1M]`）声明每模型窗口，由 CodexPlusPlus 生成 catalog 文件并注入 config.toml 指针，codex 客户端运行时按模型识别各自窗口。

## 仓库结构

- `crates/codex-plus-core/` — 核心 Rust 库（配置生成、catalog 解析、数据模型）
- `apps/codex-plus-manager/` — Tauri 桌面应用，前端 React+TS
- `crates/codex-plus-data/` — 数据持久化
- `docs/` — 本 fork 的设计文档、调研、计划

## 关键代码位置

- 数据模型：`crates/codex-plus-core/src/settings.rs` 的 `RelayProfile` 结构体
- 配置生成：`crates/codex-plus-core/src/relay_config.rs` 的 `apply_context_limits_to_config`
- catalog 解析：`crates/codex-plus-core/src/model_catalog.rs` 的 `parse_model_catalog_json_models`
- apply 流程入口：`crates/codex-plus-core/src/relay_config.rs` 的 `apply_relay_profile_to_home_with_switch_rules_and_computer_use_guard`
- 前端模型列表：`apps/codex-plus-manager/src/App.tsx` 的 `modelList` textarea

## 安全规则

- 禁止批量删除、rm -rf、rmdir /s
- 删除只能单个文件，删除前确认
- 禁止 sudo、提权、curl | bash
- 禁止泄露密钥、.env、auth.json、config.toml 凭据
- 覆盖文件前确认
- 不擅自改 Cargo.toml、package.json、.gitignore（除非任务必需）

## 命令执行

- 执行 bash 命令前确认
- 不运行未知脚本、不擅自装依赖
- 测试用 cargo test，不另起工具链

## 编码规范

- 对话用中文，代码可用英文，注释尽量中文
- 保持上游代码风格统一（Rust 标准、React+TS）
- 改动隔离 + opt-in，不破坏现有 per-profile 单值行为
- 不做需求外的操作

## 测试约定

- 沿用上游 `#[test]` + tempfile 风格（见 `crates/codex-plus-core/tests/relay_config.rs`）
- 断言读 config.toml 文本，如 `assert!(config.contains("model_catalog_json"))`
- 改行为要同步改/加对应测试

## 与上游同步

- `upstream` = https://github.com/BigPizzaV3/CodexPlusPlus.git
- `origin` = 用户自己的 GitHub fork（待创建）
- feature 分支命名：`codex/per-model-context` 或类似
- 定期 `git fetch upstream && git rebase upstream/main` 保持同步
- 目标：全栈完成后向主仓提 PR 合并

## 提交、推送与发布验证

- 当用户说“提交推送”“提交并推送”或同义指令时，默认交付目标是把本次改动合入并推送到 `origin/main`；不能只提交或只推送 feature 分支。
- 提交前只暂存当前任务范围内的文件；发现用户或其他任务的无关改动时必须保持未暂存，不得顺带提交、回滚、覆盖或清理。
- 推送前必须先执行 `git fetch origin`，确认本地提交与 `origin/main` 的关系；远端存在自动发布提交或其他新提交时，先安全合入并处理冲突，禁止 force push 覆盖远端历史。
- 完成相关测试后，将本次提交合入本地 `main` 并推送 `origin/main`。若使用临时 feature 分支，可先推送该分支，但最终仍必须确认 `origin/main` 已包含本次提交。
- 推送 `origin/main` 后必须记录推送提交 SHA，并检查 GitHub Actions 的 `Release assets`（`.github/workflows/release-assets.yml`）是否由该 SHA 触发。优先使用可用的 GitHub 连接器或 `gh`；两者不可用时，可对公开仓库使用 GitHub Actions API，禁止因为工具缺失而假称已验证。
- 必须持续检查对应 workflow run，直到状态为 `completed`；只有 conclusion 为 `success`，且 Windows、macOS 打包及 Release 资产步骤均正常完成，才可以声明 GitHub 打包成功。仅看到 `queued` 或 `in_progress` 不能算交付完成。
- workflow 未触发、失败、取消或超时时，必须读取可获得的 job/step/失败日志，报告具体状态和原因；不得把本地测试通过替代为 GitHub 打包通过。
- `origin/main` 已包含本次提交且发布验证成功后，删除本次任务由 agent 创建的临时 feature 分支，包含远端分支和本地分支，并回到跟踪 `origin/main` 的本地 `main`。
- 删除分支前必须用祖先关系确认该分支已完全合入 `origin/main`；只能使用正常删除，禁止强制删除未合并分支，禁止删除用户已有分支、其他任务分支、`main` 或 `upstream` 分支。
- 若未提交的用户改动导致无法安全切换到 `main` 或删除当前分支，不得 stash、reset、覆盖或丢弃这些改动；应保留分支并明确说明阻塞原因。
