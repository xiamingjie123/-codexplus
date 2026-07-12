# Agent Handoff Report — 2026-07-13 Response 格式 pureApi 自动走 proxy

> 日期：2026-07-13
> 分支：`strip-images-feature`
> 前序交接：`docs/handoff/2026-07-12-reasoning-strip-handoff.md`
> 关联 spec：`docs/specs/2026-07-12-strip-images-followup-bugfix-design.md`

---

## 一、当前任务完整状态

### 背景

用户测试发现：Responses 协议 + pureApi 模式时，per-model 的 strip 不生效：
- deepseek-v4-flash（纯文本）收到图片 → Ark 报 "Model do not support image input"
- kimi-k2.6（不支持推理）收到 reasoning → Ark 报 "reasoning is not supported"

**根因**：pureApi 模式下 `config.toml` 的 `base_url` 直连 Ark，proxy 被跳过。
strip/VL 逻辑已写好（`stripi_input_images_in_place`、`strip_reasoning_in_place`、`apply_vl_with_fallback`），但请求没经过 proxy，永远不会执行。

Chat 格式正常（因为必须走 proxy 做协议转换），Responses 格式缺失这一步。

### 本次 turn 做了什么

| 序号 | 任务 | 状态 |
|------|------|------|
| 1 | `lookup_model_bool_support` 改为 pub | ✅ 已完成 |
| 2 | 新增 `model_needs_strip(image_map, reasoning_map, model) -> bool` | ✅ 已完成 |
| 3 | `codex_base_url_for_protocol` 加 `needs_proxy` 参数 | ✅ 已完成 |
| 4 | `apply_pure_api_config_to_home_with_protocol_and_needs_proxy`（新重载） | ✅ 已完成 |
| 5 | `complete_relay_profile_config` 里按当前 model 计算 needs_proxy | ✅ 已完成 |
| 6 | `commands.rs:apply_pure_api_injection` 改为走新重载 + needs_proxy | ✅ 已完成 |
| 7 | model watchdog（Phase 2）：自动监听 model 切换并重新 patch | ❌ 未开始 |

### 验证状态

| 检查项 | 结果 |
|--------|------|
| protocol_proxy 测试 (82 个) | ✅ 全通过 |
| relay_config 测试 (93 个) | ✅ 全通过 |
| launcher 测试 (60 个) | ✅ 全通过 |
| `cargo build --bin codex-plus-plus --bin codex-plus-plus-manager` | ✅ 编译成功 |
| `npx tsc --noEmit` | ✅ 0 error |
| 前端 vitest | ⚠️ 未跑（classifier 限流 blocked） |
| 用户实机测试 | ⚠️ 未测（Ark API 限流，等恢复） |

---

## 二、已修改的所有文件

### 本次 turn 新增修改（与 HEAD 的 diff）

| 文件 | 改动 | 说明 |
|------|------|------|
| `crates/codex-plus-core/src/protocol_proxy.rs` | +533 行 | `lookup_model_bool_support` → pub；新增 `model_needs_strip` |
| `crates/codex-plus-core/src/relay_config.rs` | +39/-23 行 | `codex_base_url_for_protocol` 加 `needs_proxy`；新增 `apply_pure_api_config_to_home_with_protocol_and_needs_proxy`；`complete_relay_profile_config` 按 model 计算 needs_proxy |
| `apps/codex-plus-manager/src-tauri/src/commands.rs` | +29 行 | `apply_pure_api_injection` 改为调新重载 + 计算 needs_proxy；新增 `relay_model_for_proxy_decision` |

### 完整分支改动（本次 + 之前 turn，全部未 commit）

总共 14 个文件，+2498/-80 行。核心改动在 `protocol_proxy.rs`（+533）和 `tests/protocol_proxy.rs`（+1045）。

---

## 三、已经验证通过的内容

1. ✅ **82 个 protocol_proxy 测试全通过**：覆盖 VL 图像描述、图像剥离、reasoning 剥离、大小写不敏感匹配、VL max_tokens、VL context_window、image_url 字符串格式
2. ✅ **93 个 relay_config 测试全通过**：所有现有 relay 配置场景未受影响
3. ✅ **60 个 launcher 测试全通过**：启动流程未受影响
4. ✅ **`cargo build` 两个 binary 编译成功**：`codex-plus-plus` + `codex-plus-plus-manager`
5. ✅ **`npx tsc --noEmit` 0 error**：TypeScript 编译通过

---

## 四、接下来的详细步骤

### Step 1：等 Ark API 限流恢复，实机验证 Phase 1

1. 重启 Codex++（`bash scripts/dev.sh`）
2. 确认活跃 relay 是「火山引擎 Ark cherry」（protocol=responses）
3. 确认 per-model 表里有：
   - deepseek-v4-flash → 只支持文本 ✓
   - kimi-k2.6 → 不支持推理 ✓
4. **预期行为**：点「应用」后，config.toml 的 `base_url` 自动变成 `http://127.0.0.1:57321/v1`（而非直连 Ark）
5. 分别用 deepseek-v4-flash（带图）和 kimi-k2.6（带 reasoning）发请求
6. **预期**：不再报 Ark 错误，图片被 VL 描述/剥离，reasoning 被剥离

**如果 `base_url` 没有自动变成 proxy 地址**：
- 检查 `relay_model_for_proxy_decision` 返回的 model 名是否和 map key 匹配
- 检查 config.toml 里的 `model` 字段是否正确写入了
- 看诊断日志 `protocol_proxy.upstream_request` 有没有被记录到

### Step 2：实现 Phase 2 — model watchdog（自动监听模型切换）

目前用户切 relay 时，点「应用」会正确计算 needs_proxy。但如果用户在 Codex 里直接切模型（不改 relay），base_url 不会自动更新。

实现方案：
- 在 `launcher.rs` 的 `DefaultLaunchHooks` 里加 `model_watchdog: Mutex<Option<ModelWatchdogRuntime>>`
- 新建 `start_model_watchdog`：每 5 秒读 `config.toml` 的 `model` 字段，和上次对比
- 检测到 model 变了 → 读 `settings.json` 的活跃 relay → 算 `model_needs_strip` → 调 `apply_pure_api_config_to_home_with_protocol_and_needs_proxy` 更新 base_url
- 防循环：watchdog 只监听 `model` 字段变化，不触发自身

估时：1-2 小时。

### Step 3：Phase 2 完成后，完整实机测试矩阵

| 场景 | relay protocol | 当前模型 | 有图片 | 预期行为 |
|------|---------------|---------|--------|---------|
| 纯文本模型 + 图 | responses | deepseek-v4-flash | ✓ | VL 描述图片 → 主模型拿到文字描述 |
| 视觉模型 + 图 | responses | minimax-M3 | ✓ | 原样转发（VL 不触发） |
| 不支持 reasoning | responses | kimi-k2.6 | ✗ | reasoning 字段被剥离 |
| Chat 格式纯文本 | chatCompletions | xopdeepseekv4flash | ✓ | VL 描述 + 协议转换（已正常） |
| pureApi 无 strip 需求 | responses | 未标 false 的模型 | ✓ | base_url 直连 Ark（不经过 proxy） |

---

## 五、需要注意的坑点和约束

### Phase 1 的局限
- **只覆盖「切 relay → 点应用」场景**：`apply_pure_api_injection` 在 patch 时计算 needs_proxy
- **不覆盖 Codex 内直接切模型**：如果用户在 Codex 里切模型（不改 relay），base_url 不变——这是 Phase 2 要解决的
- **`relay_model_for_proxy_decision` 的 model 推断逻辑**：
  1. `relay_profile_model(profile)` → 优先用 relay 配置的默认模型
  2. `model_list` 首行 → 如果没有默认模型，取模型列表第一条
  3. 空字符串 → 都不行就返回空（`model_needs_strip` 对空模型返回 false，不走 proxy）

### 纯文本模型的 model 名
- 用户在 per-model 表格里看到的模型名**带后缀**（如 `deepseek-v4-flash[1M]`），但 `config.toml` 里写入的是去后缀的
- `model_needs_strip` 做大小写不敏感匹配，所以大小写差异没问题
- **但如果用户手动改了 config.toml 的 model 名为不规范的格式，匹配会失败——此时不会走 proxy**

### 不同步窗口
- 切到纯文本模型后，如果 watchdog 还没执行（Phase 2 前），首个请求直连 Ark 会报错
- 反向（切到视觉模型后 base_url 还是 proxy）是安全的：proxy 对视觉模型 no-op 转发

### 测试注意事项
- Ark API 504 是限流，不是代码 bug
- VL 的 `maxTokens` 建议不超过 1024（之前 5000 太大导致 stream timeout）
- VL `contextWindow` 默认 0（不限制），实测时可设 500000

---

## 六、下一个代理应该首先阅读的文件

1. **`docs/handoff/2026-07-13-pureapi-proxy-decision-handoff.md`** — 本文件
2. **`docs/handoff/2026-07-12-reasoning-strip-handoff.md`** — 上一次交接（reasoning strip + VL 改进 + contextWindow）
3. **`docs/specs/2026-07-12-strip-images-followup-bugfix-design.md`** — 设计 spec
4. **`crates/codex-plus-core/src/protocol_proxy.rs`** — 核心逻辑（`model_needs_strip` 在 ~912 行，`strip_input_images_in_place` ~970 行，`strip_reasoning_in_place` ~1000 行，`apply_vl_with_fallback` ~830 行）
5. **`crates/codex-plus-core/src/relay_config.rs`** — `codex_base_url_for_protocol` ~588 行，`apply_pure_api_config_to_home_with_protocol_and_needs_proxy` ~468 行
6. **`apps/codex-plus-manager/src-tauri/src/commands.rs`** — `apply_pure_api_injection` ~2640 行，`relay_model_for_proxy_decision` ~2800 行
7. **`crates/codex-plus-core/tests/protocol_proxy.rs`** — 82 个测试

---

## 七、关键代码位置速查

| 找什么 | 在哪 |
|--------|------|
| per-model 是否需要 proxy | `protocol_proxy.rs` `model_needs_strip` (~912 行) |
| per-model 图片能力查询 | `protocol_proxy.rs` `model_supports_image` |
| per-model 推理能力查询 | `protocol_proxy.rs` `model_supports_reasoning` |
| 大小写不敏感 map 查找 | `protocol_proxy.rs` `lookup_model_bool_support` |
| Responses 透传剥图片 | `protocol_proxy.rs` `strip_input_images_in_place` |
| Responses 透传剥 reasoning | `protocol_proxy.rs` `strip_reasoning_in_place` |
| VL 预处理 | `protocol_proxy.rs` `apply_vl_with_fallback` |
| base_url 判定逻辑 | `relay_config.rs` `codex_base_url_for_protocol` (~588 行) |
| patch config.toml（带 needs_proxy） | `relay_config.rs` `apply_pure_api_config_to_home_with_protocol_and_needs_proxy` |
| 前端触发应用 | `commands.rs` `apply_pure_api_injection` (~2640 行) |
| 前端 per-model 表格 | `App.tsx` 模型列表（textOnly + noReasoning 两列） |
| 前端 VL 配置 | `App.tsx` VL 设置区（enabled/model/protocol/baseUrl/apiKey/maxTokens/contextWindow） |
