# Legacy Final 功能等价矩阵

日期：2026-07-16

状态：Legacy 基线冻结清单；Codex Deck 正式切换前必须 100% 完成所有“必须迁移”项。

基线产品代码：`10a0663522bb765036ad340a7acbbab1a355247c`

计划标签：`legacy-final-v1.2.47-20260716`

## 1. 等价判定规则

- 等价按用户结果判断，不要求复制旧 UI、旧文件结构或旧进程结构。
- “必须迁移”表示首个正式 Codex Deck 缺少该能力时禁止切换。
- 无法触达的死代码、测试工具和未进入当前产品的上游功能不属于等价范围。
- 修复卡顿、资源泄漏、错误提示和不安全存储不算破坏等价。
- 删除、降级、合并任何可触达能力时，必须单独取得用户确认并更新本矩阵。
- 每项 Deck 验收同时需要自动化证据和真实业务链路证据。

状态值：

```text
baseline      Legacy 基线能力已识别
not_started   Deck 尚未实现
in_progress   Deck 正在实现，不能发布
verified      自动化与真实链路均通过
waived        用户明确同意不迁移，并附决策记录
```

## 2. Manager 与应用生命周期

| ID | Legacy 用户能力 | 主要证据 | Deck 目标模块 | 要求 | Deck 状态 |
| --- | --- | --- | --- | --- | --- |
| APP-001 | Manager 单实例、主窗口、托盘显示/隐藏/退出 | Tauri `run`、tray tests | manager + runtime | 必须迁移 | not_started |
| APP-002 | 启动时读取版本、更新提示和运行概览 | `backend_version`、`startup_options`、`load_overview` | application/query | 必须迁移 | not_started |
| APP-003 | 检测 Codex App 路径和版本 | overview、app_paths | codex adapter | 必须迁移 | not_started |
| APP-004 | 启动、重启、激活已有 Codex App | `launch_codex_plus`、`restart_codex_plus` | runtime supervisor | 必须迁移 | not_started |
| APP-005 | 自定义 Codex 路径和附加启动参数 | `codexAppPath`、`codexExtraArgs` | settings + codex adapter | 必须迁移 | not_started |
| APP-006 | 增强总开关关闭后仍可只做供应商/启动管理 | `enhancementsEnabled` | application policy | 必须迁移 | not_started |
| APP-007 | Manager 和 Runtime 健康状态、降级状态 | status、overview、diagnostics | observability | 必须迁移 | not_started |

## 3. 供应商、模型与配置

| ID | Legacy 用户能力 | 主要证据 | Deck 目标模块 | 要求 | Deck 状态 |
| --- | --- | --- | --- | --- | --- |
| PRO-001 | 加载、保存、重置设置并保留未知兼容字段 | `load_settings`、`save_settings`、settings tests | settings | 必须迁移 | not_started |
| PRO-002 | 多供应商创建、编辑、删除、选择和排序 | Manager relay UI | provider | 必须迁移 | not_started |
| PRO-003 | 官方登录模式 | `RelayMode::Official` | provider + codex config | 必须迁移 | not_started |
| PRO-004 | 官方登录混入 API | `officialMixApiKey`、relay tests | provider + secrets | 必须迁移 | not_started |
| PRO-005 | 纯 API 模式 | `RelayMode::PureApi` | provider + proxy | 必须迁移 | not_started |
| PRO-006 | Responses 与 Chat Completions 两种协议 | `RelayProtocol`、protocol proxy tests | proxy | 必须迁移 | not_started |
| PRO-007 | 聚合供应商 | aggregate profiles | provider + proxy | 必须迁移 | not_started |
| PRO-008 | 故障转移、按会话、按请求、权重轮转 | `AggregateRelayStrategy`、rotation tests | proxy/rotation | 必须迁移 | not_started |
| PRO-009 | 切换供应商前保存当前配置并创建备份 | `switch_relay_profile`、relay switch tests | application transaction | 必须迁移 | not_started |
| PRO-010 | 应用、清理 relay/pure API 注入 | `apply_relay_injection`、`apply_pure_api_injection`、`clear_relay_injection` | codex config adapter | 必须迁移 | not_started |
| PRO-011 | 配置预览、读取和保存 config/auth 文件 | `read_relay_files`、`save_relay_file` | codex config adapter | 必须迁移 | not_started |
| PRO-012 | 通用配置提取与合并 | `extract_relay_common_config` | provider/config | 必须迁移 | not_started |
| PRO-013 | 从当前 Codex 配置回填供应商 | `backfill_relay_profile_from_live` | codex config adapter | 必须迁移 | not_started |
| PRO-014 | 供应商连通性和模型测试 | `test_relay_profile` | provider diagnostics | 必须迁移 | not_started |
| PRO-015 | 延迟测量 | `measure_relay_latency` | provider diagnostics | 必须迁移 | not_started |
| PRO-016 | Provider Doctor | `diagnose_relay_profile` | provider diagnostics | 必须迁移 | not_started |
| PRO-017 | 拉取供应商模型列表 | `fetch_relay_profile_models` | model catalog | 必须迁移 | not_started |
| PRO-018 | 默认模型、测试模型、User-Agent | `RelayProfile` fields | provider | 必须迁移 | not_started |
| PRO-019 | 每模型上下文窗口和自动压缩阈值 | model suffix/catalog tests | model catalog | 必须迁移 | not_started |
| PRO-020 | 生成和切换 `model_catalog_json` | relay config/model catalog tests | codex config adapter | 必须迁移 | not_started |
| PRO-021 | 模型插入模式和模型列表文本格式 | `RelayModelInsertMode` | model catalog | 必须迁移 | not_started |
| PRO-022 | 按模型图像支持和图片剥离 | `stripImages`、`modelImageSupport` | proxy/transform | 必须迁移 | not_started |
| PRO-023 | 按模型 reasoning 支持和剥离 | `modelReasoningSupport` | proxy/transform | 必须迁移 | not_started |
| PRO-024 | VL 图片描述、模型、窗口、token 和协议设置 | `VisionRelayConfig` | proxy/vision | 必须迁移 | not_started |
| PRO-025 | cc-switch/TOML/链接供应商导入及待确认流程 | CCS/pending provider commands | legacy import + provider | 必须迁移 | not_started |

## 4. 会话管理

| ID | Legacy 用户能力 | 主要证据 | Deck 目标模块 | 要求 | Deck 状态 |
| --- | --- | --- | --- | --- | --- |
| SES-001 | 扫描当前和兼容 schema 的本地会话 | `list_local_sessions`、codex_sqlite tests | session adapter | 必须迁移 | not_started |
| SES-002 | 会话搜索、筛选、分页和详情展示 | Manager sessions route | session query | 必须迁移 | not_started |
| SES-003 | 单条和批量删除会话 | `delete_local_session`、bridge routes | session command | 必须迁移 | not_started |
| SES-004 | Markdown 导出 | renderer/bridge export | session export | 必须迁移 | not_started |
| SES-005 | Token 用量历史及模型后缀清理 | local storage/sqlite sanitation | session adapter | 必须迁移 | not_started |
| SES-006 | Provider metadata 目标发现和同步 | `load_provider_sync_targets`、`sync_providers_now` | session/provider sync | 必须迁移 | not_started |
| SES-007 | Provider 同步前备份和逐项结果 | codex-plus-data provider_sync | session transaction | 必须迁移 | not_started |
| SES-008 | 会话索引清理预览和应用 | preview/apply index cleanup | session maintenance | 必须迁移 | not_started |
| SES-009 | 项目归属和项目间移动 | renderer project move | session/project | 必须迁移 | not_started |
| SES-010 | 不复制 Codex 原生会话库，以其为唯一事实来源 | 已确认架构决策 | session adapter | 必须保持 | not_started |

## 5. MCP、Skills、Plugins 与用户脚本

| ID | Legacy 用户能力 | 主要证据 | Deck 目标模块 | 要求 | Deck 状态 |
| --- | --- | --- | --- | --- | --- |
| CTX-001 | 全局列出 MCP、Skills、Plugins | context route | context packages | 必须迁移 | not_started |
| CTX-002 | 读取当前 Codex live context | `read_live_context_entries` | codex config adapter | 必须迁移 | not_started |
| CTX-003 | 同步 live context 与通用配置 | `sync_live_context_entries` | context transaction | 必须迁移 | not_started |
| CTX-004 | 新增、编辑、启停和删除 context 项 | upsert/delete commands | context packages | 必须迁移 | not_started |
| CTX-005 | 供应商切换时合并全局 context | relay context tests | application policy | 必须迁移 | not_started |
| CTX-006 | 插件市场状态和本地修复 | marketplace status/repair | plugin adapter | 必须迁移 | not_started |
| CTX-007 | 远程插件市场状态和修复 | remote marketplace commands | plugin adapter | 必须迁移 | not_started |
| SCR-001 | 用户脚本清单、市场刷新和安装 | script market commands | script packages | 必须迁移 | not_started |
| SCR-002 | 用户脚本启停、删除和元数据 | script manager tests | script packages | 必须迁移 | not_started |
| SCR-003 | 用户脚本热重载设置 | `userScriptHotReload` | enhancement runtime | 必须迁移 | not_started |

## 6. Codex Renderer 增强

| ID | Legacy 用户能力 | 主要证据 | Deck 目标模块 | 要求 | Deck 状态 |
| --- | --- | --- | --- | --- | --- |
| ENH-001 | 各增强独立开关和运行时设置同步 | BackendSettings、cdp tests | feature registry | 必须迁移 | not_started |
| ENH-002 | 插件市场解锁和兼容版本门控 | renderer/cdp tests | plugin feature | 必须迁移 | not_started |
| ENH-003 | 插件自动展开 | renderer tests | plugin feature | 必须迁移 | not_started |
| ENH-004 | 自定义模型白名单和模型元数据 | model patches | model feature | 必须迁移 | not_started |
| ENH-005 | 会话删除、批量删除和更多菜单动作 | renderer actions tests | session feature | 必须迁移 | not_started |
| ENH-006 | Markdown 导出和保存路径选择 | renderer export tests | session feature | 必须迁移 | not_started |
| ENH-007 | 富文本粘贴转纯文本 | paste fix tests | composer feature | 必须迁移 | not_started |
| ENH-008 | 强制中文界面 | locale tests | locale feature | 必须迁移 | not_started |
| ENH-009 | 快速启动 | fast startup script | bootstrap feature | 必须迁移 | not_started |
| ENH-010 | 原生菜单位置和本地化 | native menu tests | native menu feature | 必须迁移 | not_started |
| ENH-011 | 项目移动和 projectless 窗口保护 | renderer/app-state tests | project feature | 必须迁移 | not_started |
| ENH-012 | 线程 ID 徽标 | renderer tests | session feature | 必须迁移 | not_started |
| ENH-013 | 会话宽度 | renderer tests | layout feature | 必须迁移 | not_started |
| ENH-014 | 会话滚动位置恢复 | renderer tests | scroll feature | 必须迁移 | not_started |
| ENH-015 | 服务层级选择、请求覆盖和徽标 | service tier tests | composer/protocol feature | 必须迁移 | not_started |
| ENH-016 | Goals 和压缩后续跑保护 | goal guard tests | goal feature | 必须迁移 | not_started |
| ENH-017 | Stepwise 建议、刷新、直发及独立 API 设置 | stepwise tests | stepwise feature | 必须迁移 | not_started |
| ENH-018 | 自定义图片覆盖层及 fit/opacity | overlay tests | overlay feature | 必须迁移 | not_started |
| ENH-019 | Windows 实时鼠标查看覆盖图能力 | pet real mouse tests | platform feature | 必须迁移 | not_started |
| ENH-020 | Upstream 分支下拉和 worktree 创建 | upstream worktree tests | worktree feature | 必须迁移 | not_started |
| ENH-021 | Zed Remote 项目发现、打开、记忆和策略 | Zed commands/tests | zed adapter | 必须迁移 | not_started |
| ENH-022 | bridge 请求错误、超时和降级提示 | bridge/cdp tests | renderer transport | 必须迁移并改进 | not_started |
| ENH-023 | 关闭功能时释放 observer、timer、listener 和连接 | 新架构硬门槛 | feature lifecycle | 必须新增守卫 | not_started |

## 7. 安装、更新与维护

| ID | Legacy 用户能力 | 主要证据 | Deck 目标模块 | 要求 | Deck 状态 |
| --- | --- | --- | --- | --- | --- |
| OPS-001 | Windows/macOS 入口安装与卸载 | install commands/tests | platform installer | 必须迁移 | not_started |
| OPS-002 | 快捷方式修复 | `repair_shortcuts` | platform installer | 必须迁移 | not_started |
| OPS-003 | Watcher 安装、卸载、启用和禁用 | watcher commands/tests | runtime/platform | 必须迁移 | not_started |
| OPS-004 | 环境冲突检测和选择性移除 | env conflict commands/tests | diagnostics | 必须迁移 | not_started |
| OPS-005 | 最新日志查看 | `read_latest_logs` | observability | 必须迁移 | not_started |
| OPS-006 | 脱敏诊断复制/导出 | `copy_diagnostics` | observability | 必须迁移并改进 | not_started |
| OPS-007 | 前端诊断事件写入 | `write_diagnostic_event` | observability | 必须迁移并限流 | not_started |
| OPS-008 | 设置和图片覆盖层设置重置 | reset commands | settings | 必须迁移 | not_started |
| OPS-009 | Release 更新检查和执行 | update commands/tests | update adapter | 必须迁移 | not_started |
| OPS-010 | Windows NSIS、macOS x64/arm64 DMG | workflows/installers | release | 必须迁移 | not_started |
| OPS-011 | 系统代理、代理失败直连、本地回环直连 | HTTP/update tests | infrastructure/http | 必须迁移 | not_started |
| OPS-012 | 日志异步、有界、轮转和脱敏 | 新架构硬门槛 | observability | 必须改进 | not_started |

## 8. Legacy 一次性导入

| ID | 导入能力 | Deck 验收标准 | 要求 | Deck 状态 |
| --- | --- | --- | --- | --- |
| IMP-001 | 只读发现 `.codex-session-delete` 和 Legacy schema | 不修改来源数据 | 必须实现 | not_started |
| IMP-002 | 总预览和冲突报告 | 显示来源、目标、动作和风险 | 必须实现 | not_started |
| IMP-003 | 自动转换非敏感设置 | 供应商、模型、通用配置、增强和 UI 偏好完整 | 必须实现 | not_started |
| IMP-004 | 可执行内容逐项确认 | MCP、skills、plugins、脚本、路径和集成不静默执行 | 必须实现 | not_started |
| IMP-005 | secrets 逐项确认并写入平台安全存储 | 普通 JSON、日志和诊断包无明文 | 必须实现 | not_started |
| IMP-006 | Codex 原生会话不复制 | Session Adapter 直接适配原生事实来源 | 必须实现 | not_started |
| IMP-007 | 快照、临时事务区、原子提交和失败回滚 | 任一步失败恢复导入前状态 | 必须实现 | not_started |
| IMP-008 | 可重试 ledger | 区分未导入、成功、跳过、失败 | 必须实现 | not_started |
| IMP-009 | 不导入日志、缓存、PID、端口、锁和临时文件 | 数 GB Legacy 日志不进入 Deck | 必须实现 | not_started |
| IMP-010 | 导入完成后不双写 | Deck 不再运行时依赖 Legacy 数据 | 必须实现 | not_started |

## 9. Tauri 命令面基线

当前 Manager 注册 66 个业务/维护命令和 3 个窗口生命周期命令。Deck 可以重新设计 RPC 名称，但功能矩阵必须覆盖这些用户结果：

```text
backend_version
startup_options
load_overview
launch_codex_plus
restart_codex_plus
load_settings
save_settings
load_ccs_providers
import_ccs_providers
load_pending_provider_import
confirm_pending_provider_import
dismiss_pending_provider_import
list_local_sessions
list_zed_remote_projects
open_zed_remote
forget_zed_remote_project
delete_local_session
load_provider_sync_targets
preview_session_index_cleanup
apply_session_index_cleanup
sync_providers_now
refresh_script_market
install_market_script
set_user_script_enabled
delete_user_script
open_external_url
install_entrypoints
uninstall_entrypoints
repair_shortcuts
plugin_marketplace_status
repair_plugin_marketplace
remote_plugin_marketplace_status
repair_remote_plugin_marketplace
check_update
perform_update
load_watcher_state
install_watcher
uninstall_watcher
enable_watcher
disable_watcher
read_latest_logs
copy_diagnostics
reset_settings
reset_image_overlay_settings
relay_status
read_relay_files
check_env_conflicts
remove_env_conflicts
save_relay_file
write_diagnostic_event
backfill_relay_profile_from_live
list_context_entries
read_live_context_entries
sync_live_context_entries
upsert_context_entry
delete_context_entry
extract_relay_common_config
test_relay_profile
measure_relay_latency
diagnose_relay_profile
test_stepwise_settings
fetch_relay_profile_models
switch_relay_profile
apply_relay_injection
apply_pure_api_injection
clear_relay_injection
manager_exit_app
manager_hide_to_tray
update_tray_labels
```

## 10. 正式切换总门槛

- 本文所有“必须迁移”项状态为 `verified` 或带用户决策记录的 `waived`。
- `not_started`、`in_progress` 或只有自动化没有真实链路证据时禁止切换。
- Windows、macOS、导入、回滚、2 小时稳定运行和 100 次会话切换满足架构计划的严格门槛。
- P0、P1 未解决缺陷均为 0。
- 用户审阅总验收报告并明确批准正式切换。
