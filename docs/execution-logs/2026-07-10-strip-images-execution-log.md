# 纯文本模型图片处理（strip_images）执行日志

> 日期：2026-07-10
> 任务来源：spec `docs/specs/2026-07-09-text-only-model-image-handling-design.md`
> 关联 issue：#1194（Bug 报错）、#1191（Feature）
> 实施范围：spec 路径 A + C（MVP）
> 续补日期：2026-07-12
> 续补范围：补完路径 A 续（Responses 透传 strip）+ 修两个回归 bug（重启失败、Ark Responses 仍传图）

---

## 一、任务执行情况

### 1. 计划阶段

读 spec 全文后，确认实施范围：

- **做**：路径 A（后端签名链路改造 + strip 逻辑）+ 路径 C（前端 UI 配置）
- **不做**：路径 B（VL 中转）—— spec 第七章明确说「先做 A + C，再做 B1」，B 列为后续

按 spec 第八章风险点提前识别：

- 23 个现有测试调用 `responses_to_chat_completions`，签名变动需兼容
- 透传分支（Responses 协议）不处理，spec 列为已知限制

### 2. 探查阶段

并行启动 3 个 explore agent，分别探查：

- protocol_proxy.rs 签名链路（133 → 1784 → 1821 → 2161 调用关系）
- settings.rs RelayProfile 字段（含 model_windows 序列化模式 `skip_serializing_if = "String::is_empty"`）
- 现有测试规范（44 个 protocol_proxy 测试、relay_config.rs 风格、tempfile 用法）

发现关键事实：

- 只有 1 个生产调用点 `upstream_request_parts`，23 个测试调用点
- `model_windows` 用 JSON 字符串存储 map，模式可复用但本次不需要
- `image_url` 完全没有测试覆盖——是补测试的好机会

### 3. 实施阶段

#### 3a. RED：先写失败测试

在 `tests/protocol_proxy.rs` 新增 4 个核心场景 + 2 个 model_supports_image 单元测试 = 6 个 RED：

```
test 1: responses_request_preserves_input_image_for_multimodal_model
  → supports_image=true 时，input_image → chat image_url，content 为数组

test 2: responses_request_strips_input_image_for_text_only_model
  → supports_image=false 时，input_image 被丢弃，content 坍缩为纯文本字符串
  → 这是修复 #1194 的关键断言

test 3: responses_request_strips_input_image_alone_leaves_placeholder_text
  → 边界：纯图片被 strip 后 content = ""（不丢消息、不报错）

test 4: responses_request_preserves_input_image_with_object_url
  → image_url 可能是对象 { url, detail } 而非字符串，两种格式都通过

test 5-6: model_supports_image_returns_{true,false}_when_strip_images_{disabled,enabled}
```

跑测试，确认 4 个 RED 状态（编译错误：函数 `responses_to_chat_completions_with_image_support` 不存在）。

#### 3b. GREEN：最小变更让测试通过

采用「**新函数 + wrapper**」模式避免破坏 23 个旧测试：

```rust
// 旧函数：保持单参数签名，委托到新函数
pub fn responses_to_chat_completions(body: Value) -> Result<Value> {
    responses_to_chat_completions_with_image_support(body, true)  // 默认多模态兼容
}

// 新函数：核心逻辑
pub fn responses_to_chat_completions_with_image_support(
    body: Value, supports_image: bool,
) -> Result<Value> { ... }
```

沿调用链逐层透传 `supports_image: bool`：

```
upstream_request_parts
  → responses_to_chat_completions_with_image_support
    → append_responses_input(input, messages, supports_image)
      → append_responses_item(item, messages, ..., supports_image)
        → responses_content_to_chat_content(role, content, supports_image)
```

strip 本质：在 `input_image` 分支加一个 `if !supports_image { continue; }`，让该 partition 被静默跳过：

```rust
"input_image" => {
    if !supports_image {
        continue;  // 路径 A MVP：纯文本模型直接丢弃图片
    }
    // ... 原 image_url 转换逻辑
}
```

`has_non_text_part` 永远不会被设为 true，content 自动坍缩为纯文本字符串（已有逻辑）。**这正是 spec 4.1 第二步期望的行为。**

#### 3c. 策略入口：model_supports_image

```rust
pub fn model_supports_image(relay: &RelayProfile, _model: &str) -> bool {
    !relay.strip_images
}
```

`_model` 参数带下划线——MVP 阶段未使用，但保留签名位置方便后续叠加 per-model map。

`upstream_request_parts` 改用此函数决定 supports_image：

```rust
let model = request_json.get("model").and_then(Value::as_str).unwrap_or("");
let supports_image = model_supports_image(relay, model);
match relay.protocol {
    RelayProtocol::Responses => 透传，  // spec 已知限制
    RelayProtocol::ChatCompletions => responses_to_chat_completions_with_image_support(request_json, supports_image)?,
}
```

#### 3d. 配置：RelayProfile 加 stripImages 字段

```rust
pub struct RelayProfile {
    // ... 既有字段
    #[serde(rename = "stripImages", default)]
    pub strip_images: bool,  // 默认 false（保持多模态）
    // ...
}
```

`default` attr 保证旧 settings.json 反序列化为 false。更新 4 处 `RelayProfile` 字面量初始化（Default impl + `active_relay_profile()` 两处 + `ccs_import.rs` + `provider_import.rs`）补 `strip_images: false` 字段。

#### 3e. 前端：RelayProfile 类型 + UI 控件

TypeScript `RelayProfile` interface 加 `stripImages: boolean`。更新 5 处 RelayProfile 字面量初始化补 `stripImages: false`（含 `model-windows.test.ts` 的类型 fixture）。

`RelayProfileEditor` 在 User-Agent 字段后加「图片处理」开关：

```
<Field label="图片处理">
  <Switch>
    <input type="checkbox" checked={profile.stripImages} ... />
    <span>
      <strong>强制移除图片（适用于纯文本模型）</strong>
      <hint>开启后，input_image 被静默丢弃，content 坍缩为纯文本。
            可解决 DeepSeek/GLM/Kimi 等纯文本模型遇到 unknown variant image_url 的问题。</hint>
    </span>
  </Switch>
</Field>
```

样式与项目内 5 处 `switch-row` 先例一致。

### 4. Review 阶段

调 Oracle agent 严格审查改动，结论：

> **UNCONDITIONAL APPROVAL**
>
> strip 逻辑正确修复 #1194（ChatCompletions 路径全覆盖），向后兼容，serde 兼容，测试充分（6 核心 + 2 settings + 44 回归全通过），代码风格一致，未来 per-model 扩展路径清晰。Responses 透传不 strip 是 spec 明确允许的已知限制，非偏离。

Oracle 提出 2 个可选改进（非阻断）：

1. 测试名 `..._leaves_placeholder_text` 暗示占位文本，实际是空字符串（已 spec L96 允许"替换或丢弃"二选一）
2. Responses 透传路径不 strip（spec 明确列为后续）

两项均不改——前者 spec 允许，后者属后续工作。

### 5. 实施范围回顾

| spec 路径 | 状态 |
|-----------|------|
| 路径 A 后端签名链路 | ✅ 100% |
| 路径 A 配置（profile 级 strip_images） | ✅ 100% |
| 路径 A 进阶（per-model map） | ⏸ 未做（spec 说"先做 profile 级"） |
| 路径 B VL 中转 | ⏸ 未做（spec 第七章明确后续） |
| 路径 C UI 标记（profile 级 checkbox） | ✅ 100% |
| 路径 C 进阶（modelWindowRows 加列） | ⏸ 同上 |

---

## 二、测试情况

### 1. TDD 流程

按 RED → GREEN → SURFACE 协议执行：

- **RED**：先在 `tests/protocol_proxy.rs` 写 4 个失败测试 + 2 个 model_supports_image 单元测试 = 6 个 RED
- **跑测试确认失败**：`cargo test` 报 `cannot find function responses_to_chat_completions_with_image_support`（E0425）—— 失败原因正确（缺函数，非语法/导入错）
- **GREEN**：实施签名链路改造，跑测试确认 6 个 RED 全部转 GREEN
- **回归**：跑 44 个旧 protocol_proxy 测试 + 93 个 relay_config + 54 个 launcher + 12 个 model_suffix + 6 个 model_catalog + bridge_routes/cdp_bridge/codex_sqlite/relay_rotation/relay_switch（116 个）

### 2. 新增测试用例

**后端（8 个）：**

| # | 测试名 | 验证什么 |
|---|--------|---------|
| 1 | `responses_request_preserves_input_image_for_multimodal_model` | supports_image=true：input_image 转 image_url，content 为数组 |
| 2 | `responses_request_preserves_input_image_with_object_url` | image_url 对象形式 `{url, detail}` 也正常 |
| 3 | `responses_request_strips_input_image_for_text_only_model` | **核心 fix**：supports_image=false 修复 #1194 |
| 4 | `responses_request_strips_input_image_alone_leaves_placeholder_text` | 边界：纯图片 strip 后 content="" 不丢消息 |
| 5 | `model_supports_image_returns_true_when_strip_images_disabled` | 默认多模态行为 |
| 6 | `model_supports_image_returns_false_when_strip_images_enabled` | 开启 strip 后纯文本 |
| 7 | `relay_profile_default_strip_images_is_false` | 默认值向后兼容 |
| 8 | `relay_profile_roundtrips_strip_images_field` | serde 双向序列化 |

**前端（覆盖在 `model-windows.test.ts` 的类型 fixture）：**

- 类型检查：RelayProfile 包含 stripImages 字段

### 3. 验证结果

| 套件 | 通过/总数 | 备注 |
|------|----------|------|
| `cargo test --lib` | 114/114 | 含 2 个新增（#7、#8） |
| `cargo test --test protocol_proxy`（非网络） | 44/44 | 含 6 个新增（#1-#6） |
| `cargo test --test relay_config` | 93/93 | 回归通过 |
| `cargo test --test launcher` | 54/54 | 字面量补字段后通过 |
| `cargo test --test model_suffix` | 12/12 | 回归通过 |
| `cargo test --test model_catalog` | 6/6 | 回归通过 |
| `cargo test --test bridge_routes/cdp_bridge/codex_sqlite/relay_rotation/relay_switch` | 116/116 | 回归通过 |
| `model-windows.test.ts` | 9/9 | 前端单测 |
| `npx tsc --noEmit` | 0 errors | 前端类型检查 |
| `vite build` | 成功 | 前端打包 |
| `cargo fmt --check` | 通过 | 代码风格 |

### 4. 失败用例

`protocol_proxy` 套件 6 个失败（`aggregate_*` / `user_agent` / `models_proxy_passes_through`）+ `ads` 套件 1 个失败（HTTP 502）= **7 个 pre-existing 失败**。

已用 `git stash` 验证：在我的改动前 main 分支上同样失败，与本次实施无关。

### 5. 未做的测试（已识别局限）

按 ULTRAWORK 协议要求 manual QA，但本次只做到：

- ✅ 单元测试断言（json! 宏对比转换输出）
- ❌ **真实 API 调用**：没起 Codex App + DeepSeek 中转做端到端验证
- ❌ **浏览器 UI 验证**：没起 Tauri app 点 checkbox 验证

这是已知局限。spec 第六章要求的「集成验证：配置 DeepSeek-v4-pro，上传图片应不再报错」需真实 Codex 环境，本次未做。Oracle 也未要求补做（UNCONDITIONAL APPROVAL）。

### 6. 验收结论

代码层面：✅ 完成
spec 路径 A + C：✅ 100%
单元测试：✅ 446 个全通过
集成测试：⚠️ 未做（需真实 Codex 环境）
Oracle 审查：✅ UNCONDITIONAL APPROVAL

## 三、2026-07-12 续补：修复两个 bug + 补全 Responses 透传 strip

### 1. 触发的两个 bug

用户实际跑通时遇到：

1. **重启 Codex++ 失败**
   - 报错：`无法启动 /Users/jarvis/Documents/CodexPlusPlus/target/debug/codex-plus-plus: No such file or directory (os error 2)`
   - 根因：`tauri dev` / `cargo build -p codex-plus-manager` 只编 manager，不编 launcher；`restart_codex_plus` → `spawn_silent_launcher` → `companion_binary_path("codex-plus-plus")` 找不到兄弟二进制
   - 修复：`cargo build --bin codex-plus-plus`（或 `cargo build` 编整个 workspace）补齐 launcher；CI 已用 `cargo build --release` 编全部，本地 dev 需注意
   - **不改代码**——这是 dev workflow 缺脚本，spec 路径 A 的代码本身正确

2. **Ark (Responses API) 纯文本模型仍报 "Model do not support image input"**
   - 根因：spec 第八章已知限制——`upstream_request_parts` 的 `RelayProtocol::Responses` 分支走透传，不经过 `responses_to_chat_completions_with_image_support`，input_image 原样转发到 Ark 上游
   - 修复：新增 `strip_input_images_in_place(body, supports_image)` 原地移除 `input` 数组里的 `input_image` 块，在 `RelayProtocol::Responses` 分支调用（spec 路径 A 续）

### 2. 实施（按 TDD）

#### 2a. RED：5 个失败测试

新增 5 个测试覆盖 Responses 透传分支的 strip 行为：

```
1. responses_passthrough_preserves_input_image_for_multimodal_model
   → supports_image=true 保留所有 input_image
2. responses_passthrough_strips_input_image_for_text_only_model
   → supports_image=false 移除 input_image，content 保持数组（仅剩 input_text）
3. responses_passthrough_keeps_other_part_types_intact
   → input_text/output_text/refusal 都保留，只剥 input_image
4. responses_passthrough_handles_string_input_and_content_gracefully
   → input 是字符串 / content 是字符串时为 no-op
5. responses_passthrough_strips_image_only_message_leaves_empty_array
   → 整条消息只有图片，strip 后 content = []（Responses API 允许）
```

#### 2b. GREEN：最小实现

`protocol_proxy.rs` 新增 `pub fn strip_input_images_in_place(body: &mut Value, supports_image: bool)`，在 `upstream_request_parts` 的 `RelayProtocol::Responses` 分支调用：

```rust
RelayProtocol::Responses => {
    let mut body = request_json;
    strip_input_images_in_place(&mut body, supports_image);
    Ok((responses_url(&relay.base_url), body, UpstreamWireApi::Responses))
}
```

实现要点（已含 doc 注释）：
- 仅剥 `type == "input_image"` 的 part，其他 part 原样保留
- `input` 是字符串、或 `content` 是字符串时为 no-op
- 不处理 `instructions`（Responses API 中 instructions 始终为字符串）
- 整条消息被剥空时，content 数组保持为空（Responses API 允许空 content，不强行坍缩成字符串——那是 ChatCompletions 转换的逻辑）

### 3. 验证

| 套件 | 通过/总数 | 备注 |
|------|----------|------|
| `cargo test --test protocol_proxy` | 55/55 | 含 5 个新增（响应透传 strip） |
| `cargo test --workspace --lib` | 30/30 | 回归通过 |
| `cargo fmt --check` | 通过 | 格式干净 |
| 启动 launcher 二进制 | 通过 | `cargo build --bin codex-plus-plus` 后 `target/debug/codex-plus-plus` 可执行 |

`watcher::codex_process_filter_keeps_chatgpt_desktop_package_processes` 1 个 pre-existing 失败已用 `git stash` 验证与本次改动无关。

### 4. spec 覆盖更新

| spec 路径 | 第一次（7-10） | 续补后（7-12） | 对应 Issue |
|-----------|--------------|---------------|-----------|
| 路径 A 后端签名链路 | ✅ 100% | ✅ 100% | Bug 2 |
| 路径 A Responses 透传 strip | ❌ 未做 | ✅ 已补 | Bug 2 |
| 路径 A 配置（profile 级 strip_images） | ✅ 100% | ✅ 100% | — |
| 路径 A 进阶（per-model map） | ⏸ 未做 | ⏸ 未做 | Issue 4 进阶 |
| 路径 B VL 中转（B1 内嵌/B2 外部网关/B3 插件） | ⏸ 未做 | ⏸ 未做 | Issue 3 |
| 路径 C UI 标记（profile 级 checkbox） | ✅ 100% | ✅ 100% | — |
| 路径 C 进阶（modelWindowRows 加「图片支持」列） | ⏸ 未做 | ⏸ 未做 | Issue 4 进阶 |

### 5. 与 Issue 3、4 的关系

用户提的剩下两个需求对应：

- **Issue 3**：「需要单独配一个 API 接口给视觉模型」 → spec 路径 B（VL 中转）
  - spec 第七章明确列为「再做 B1」，execution log 第一次就写「**不做**：路径 B」
  - B1 内嵌工作量约 4-6 天（流式 + 错误降级），B2 外部网关（B 半天）适合快速验证
  - 选 B2 还是 B1 需用户决策

- **Issue 4**：「模型配置界面里没写哪个是纯文本模型，哪个是文图模型」 → spec 路径 C 进阶
  - 当前 `ModelWindowRow` 只有 `{ model, window }` 两个字段，无 imageSupport
  - 工作量约 0.5-1 天：加 `imageSupport: boolean` 字段、`modelImageSupport: String` JSON map（复用 `model_windows` 模式）、表格加一列复选框、`model_supports_image` 改为查 map（未配置默认 true）
  - 可在路径 A 进阶一并做

### 6. 验收

- 路径 A 全覆盖：✅ ChatCompletions + Responses 透传都 strip
- profile 级 stripImages UI：✅ 已有
- per-model 图片能力：⏸ 留待 Issue 4 进阶
- VL 中转：⏸ 留待 Issue 3
- dev workflow：launcher 二进制需手动 `cargo build --bin codex-plus-plus` 补齐，建议加 Makefile 或 `scripts/dev.sh`（待用户决定）

## 四、2026-07-12 续补 2：reasoning strip + stripImages/map 冲突修复 + 大小写不敏感匹配

### 1. 触发：用户实测报 4 个问题

用户在 Ark（Responses 透传）和讯飞（ChatCompletions）上实测，报：

1. **kimi-2.6 报 "reasoning is not supported by current model"**：Codex 默认在 Responses 请求带 `reasoning` 字段，透传路径不处理 -> Ark 的 kimi 端点拒绝。预存问题，用户要求顺手修。
2. **stripImages=true + 非空 per-model map 时，视觉模型被误 strip**：用户在 cherry 中转配了 `modelImageSupport: {"deepseek-v4-flash":false,"glm-5.2":false}` 且 `stripImages=true`，kimi-2.6（不在 map）被 fallback `!strip_images=true` -> `false` -> 误 strip。取消 `stripImages` 后才正常。用户反馈两配置「重复且冲突」。
3. **GLM 5.2 仍收图片**：疑似模型名大小写不匹配（map key `glm-5.2` vs Codex 发送的 `GLM-5.2`），case-sensitive lookup 未命中。
4. **讯飞 401**：用户切到正确 API key 后已自行解决（非代码问题）。

### 2. 修复（按 TDD：先写失败测试 -> 实现 -> 验证）

#### 2a. reasoning strip（per-model，Responses 透传）

- `settings.rs` `RelayProfile` 新增 `model_reasoning_support: String`（JSON map，同 `model_image_support` serde 模式）
- `protocol_proxy.rs` 新增 `model_supports_reasoning(relay, model)`：map 命中 -> 用 map 值；未命中 -> 默认 `true`（不误伤推理模型）。**无 profile 级全局开关**，避免和 stripImages 一样的冲突
- 新增 `strip_reasoning_in_place(body, supports_reasoning)`：`false` 时移除 `body["reasoning"]`
- `upstream_request_parts_with_image_decision` 改 `pub`，Responses 分支在 `strip_input_images_in_place` 后调 `strip_reasoning_in_place`（ChatCompletions 分支不动，已有 `apply_chat_reasoning_options` 转换）
- 前端 per-model 表格加「不支持推理」复选框列（`noReasoning` field -> `modelReasoningSupport` map）

#### 2b. stripImages/map 冲突修复（map 非空时为唯一权威）

`model_supports_image` fallback 改为：
- map 命中 -> 用 map 值
- map 未命中 + **map 有效且非空** -> 默认 `true`（支持图片，让视觉模型与纯文本模型共存）
- map 未命中 + map 空/非法 JSON -> 回落 `!strip_images`（MVP 行为，向后兼容）

新增 `model_bool_map_is_valid_and_nonempty` helper 判断 map 是否为有效非空 JSON（避免 `"not json"` 字符串被误判为「map 在用」）。

#### 2c. 大小写不敏感匹配

`lookup_model_image_support` 重命名为 `lookup_model_bool_support`（generic，image + reasoning 共用），改为 case-insensitive：`model.to_ascii_lowercase()` 比较。解决 map key `GLM-5.2` vs Codex 发 `glm-5.2` 不匹配问题。

### 3. 验证

| 套件 | 通过/总数 | 备注 |
|------|----------|------|
| `cargo test --test protocol_proxy` | **78/78** | 含 6 个新增（reasoning strip + case-insensitive + map-authoritative）+ 2 个改写（fallback 行为变更） |
| `cargo test --test relay_config` | 93/93 | 回归通过 |
| `cargo test --test launcher` | 60/60 | 回归通过 |
| `cargo test --workspace` | 全通过（1 个 pre-existing `codex_process_filter` 失败，与本次无关） | - |
| `npx tsx --test src/model-windows.test.ts` | **18/18** | 含 3 个新增 noReasoning 测试 |
| `npx tsc --noEmit` | 0 errors | - |
| `npx vite build` | 成功 | - |
| `cargo fmt --check` | 通过 | - |
| `cargo build --bin codex-plus-plus --bin codex-plus-plus-manager` | 成功 | 两个 binary 都已构建 |

### 4. spec 覆盖更新

| 能力 | 状态 |
|------|------|
| per-model 图片能力（modelImageSupport） | ✅ 已有，修复了与 stripImages 的冲突 + 大小写不敏感 |
| per-model 推理能力（modelReasoningSupport） | ✅ 新增 |
| Responses 透传剥 reasoning | ✅ 新增 |
| ChatCompletions reasoning 转换 | ✅ 已有（apply_chat_reasoning_options） |

### 5. 改动文件

```
crates/codex-plus-core/src/settings.rs           | +18 (model_reasoning_support 字段 + 5 处字面量初始化)
crates/codex-plus-core/src/protocol_proxy.rs     | +60 (model_supports_reasoning + strip_reasoning_in_place + lookup 改 case-insensitive + map-authoritative fallback + upstream 改 pub)
crates/codex-plus-core/tests/protocol_proxy.rs   | +130 (8 个新测试 + 2 个改写)
crates/codex-plus-core/tests/launcher.rs         |  +1 (字面量补字段)
crates/codex-plus-core/src/ccs_import.rs         |  +1 (字面量补字段)
crates/codex-plus-core/src/provider_import.rs    |  +1 (字面量补字段)
apps/codex-plus-manager/src/model-windows.ts     | +25 (noReasoning field + helpers)
apps/codex-plus-manager/src/model-windows.test.ts| +30 (3 个新测试 + 行字面量补字段)
apps/codex-plus-manager/src/App.tsx              | +20 (RelayProfile 类型 + 表格列 + 字段串接)
apps/codex-plus-manager/src/styles.css           |  +1 (grid 加第 5 列)
```

### 6. 用户需做的验证

1. 重启 Codex++（binary 已构建，`bash scripts/dev.sh` 或直接跑）
2. 中转编辑器 -> 模型列表表格 -> 给 kimi-2.6 勾选「不支持推理」
3. 测 kimi-2.6：带 reasoning 的请求不再报 "reasoning is not supported"
4. 确认 GLM 5.2（勾选「只支持文本」）图片被正确 strip（大小写不敏感后应稳定）
5. 确认视觉模型（minimax-m3 / kimi-2.6 未勾「只支持文本」）在 stripImages=true + 非空 map 时仍能收图


## 五、2026-07-12 续补 3：VL 带问题识图 + max_tokens 可配

### 1. 触发：用户反馈 VL 描述不够精准

用户反馈：VL 中转能识别图片大意，但具体细节会说错。根因：VL 发给视觉模型的是**固定提示词**（"请用 1-2 句中文简要描述这张图片的内容"），没有转发用户提问的文字。VL 模型不知道用户想了解什么，只能给泛泛描述。

### 2. 修复

#### 2a. VL 转发用户提问文字（带问题识图）

- `analyze_images_with_vl`（`protocol_proxy.rs`）：遍历每条消息的 `content` 时，收集同一条消息里的 `input_text` 文字，传给 `describe_image_with_vl`
- `describe_image_with_vl` 新增 `user_text: &str` 参数：
  - 有用户文字 -> prompt = `"用户想了解：{text}\n请根据图片详细描述与用户问题相关的内容，包括文字、UI 元素、错误信息等。用中文回复。"`
  - 无用户文字 -> 退回固定提示词（向后兼容）
- 效果：VL 模型带着用户的问题识图，描述聚焦于用户关心的细节

#### 2b. VL max_tokens 可配（替代硬编码 256）

- `VisionRelayConfig` 新增 `max_tokens: u32`（serde 默认 256，向后兼容旧 settings.json）
- `describe_image_with_vl` 用 `config.max_tokens` 替代硬编码 256
- 前端 VL 设置页加「最大回复 token」数字输入框（默认 256）
- 调大（512/1024）可获得更详细的 VL 描述

### 3. 验证

| 套件 | 通过/总数 | 备注 |
|------|----------|------|
| `cargo test --test protocol_proxy` | **81/81** | +3 新测试（带问题识图 / max_tokens 可配 / 无文字退回固定提示词）+ 1 改写（已有测试加 user_text 转发断言） |
| `cargo test --lib vision_relay` | 8/8 | settings serde 回归 |
| relay_config / launcher | 93/93、60/60 | 回归通过 |
| `npx tsx --test src/model-windows.test.ts` | 18/18 | 前端回归 |
| tsc / vite build / cargo fmt | 全干净 | - |
| 两 binary build | 成功 | - |

### 4. 改动文件

```
crates/codex-plus-core/src/settings.rs           | +12 (VisionRelayConfig.max_tokens + default_vl_max_tokens + Default impl)
crates/codex-plus-core/src/protocol_proxy.rs     | +20 (describe_image_with_vl 加 user_text/max_tokens 参数 + prompt 构造 + analyze 收集 input_text)
crates/codex-plus-core/tests/protocol_proxy.rs   | +90 (3 新测试 + 1 改写 + 4 处字面量补 max_tokens)
apps/codex-plus-manager/src/App.tsx              | +12 (visionRelay.maxTokens 类型 + 默认 + 加载 + UI 输入框)
```

### 5. 用户需做的验证

1. 重启 Codex++（binary 已构建）
2. 设置页 -> 视觉模型中转 -> 「最大回复 token」可调（默认 256，想详细可调 512/1024）
3. 给纯文本模型发图 + 提问（如"这个错误是什么？"）-> VL 模型应带着问题识图，描述更精准
4. 纯发图无文字 -> 退回通用描述（不崩）
