# Strip Images Feature — 重建执行日志

> 日期：2026-07-13
> 分支：`strip-images-feature`
> 基线 commit：`1b82363` → `ff58313`
> 计划文件：`docs/superpowers/plans/2026-07-13-strip-images-rebuild-plan.md`
> 设计文件：`docs/superpowers/specs/2026-07-13-strip-images-rebuild-design.md`

---

## 一、背景

在之前的工作中，`protocol_proxy.rs` 被 `git checkout 1b82363` 意外回退，丢失了 VL 预处理、reasoning strip、per-model map 等全部功能。经用户确认后，决定从 `1b82363` 基线重建，只保留 Chat 格式路径的功能，Response 格式保持纯透传（不拦截）。

已在准备阶段：
- 写出完整设计 spec（含伪代码和数据流图）
- 写出 7 任务的实现计划
- 将保留的前端/settings/测试等文件 commit 为基线 `ff58313`
- protocol_proxy.rs 只修复了 `has_version_suffix` 的 pub 可见性

本日志记录从基线出发，逐任务重建 protocol_proxy.rs 的过程，并与 design 文件逐项比对。

---

## 二、design → 实现对照

### 3.1 per-model 能力判断（design §3.1）

design 定义了 4 个函数，构成能力判断的基础层：

| design 函数 | 实现位置 | 状态 | 说明 |
|---|---|---|---|
| `lookup_model_bool_support` | protocol_proxy.rs:806 | ✅ 与 design 一致 | 大小写不敏感 HashMap 查询，非法 JSON/空串/未命中 → None |
| `model_bool_map_is_valid_and_nonempty` | protocol_proxy.rs:823 | ✅ 与 design 一致 | JSON 解析成功且 map 非空 |
| `model_supports_image` | protocol_proxy.rs:832 | ✅ 与 design 一致 | map 命中 → 用 map 值；map 非空未命中 → true（不误伤视觉模型）；map 空 → 回退 `!strip_images` |
| `model_supports_reasoning` | protocol_proxy.rs:848 | ✅ 与 design 一致 | map 命中用值，未命中默认 true |

**调用链：**

```
Codex 请求进入
    │
    ├─→ apply_vl_with_fallback()
    │       └─→ model_supports_image(relay, model)
    │           ├─→ lookup_model_bool_support(&relay.model_image_support, model)
    │           └─→ model_bool_map_is_valid_and_nonempty()  // fallback 判断
    │
    └─→ upstream_request_parts()
            ├─→ model_supports_reasoning(relay, model)  // Responses 分支 strip reasoning
            └─→ strip_input_images_in_place() / strip_reasoning_in_place()
```

### 3.2 strip 函数（design §3.2）

| design 函数 | 实现位置 | 状态 | 说明 |
|---|---|---|---|
| `strip_input_images_in_place` | protocol_proxy.rs:855 | ✅ 与 design 一致 | `supports_image=true` 时 no-op；遍历 `body.input[].content[]`，移除 `type=="input_image"` 的 part；字符串 content 安全跳过 |
| `strip_reasoning_in_place` | protocol_proxy.rs:879 | ✅ 与 design 一致 | `supports_reasoning=true` 时 no-op；移除 `body["reasoning"]` |

**调用时机：**
- Chat 分支：在 `responses_to_chat_completions_with_image_support` 内部 strip
- Responses 分支：在 `upstream_request_parts` 内按 `supports_image`/`supports_reasoning` 决定是否 strip

### 3.3 VL 预处理（design §3.3）

这是最复杂的模块，涉及异步 I/O 和上下文窗口机制。

**触发链路：**

```
open_responses_proxy_request_with_settings_and_user_agent()
    │
    └─→ apply_vl_with_fallback(relay, body, vision_relay, user_agent)
            │
            ├─ model_supports_image(relay, model) == true  → 跳过 VL
            ├─ vision_relay.enabled == false              → 跳过 VL
            │
            └─ analyze_images_with_vl(&mut body, vl_config, &client)
                    │
                    ├─ !vl_config.enabled → 直接返回（双重保护）
                    ├─ items_within_vl_window(input, context_window)
                    │   ├─ context_window=0 → 全部索引
                    │   └─ context_window>0 → 从末尾累积 token 直到超限
                    │
                    ├─ 窗口内的图 → describe_image_with_vl()
                    │   ├─ protocol=ChatCompletions → image_url 对象格式 + max_tokens
                    │   └─ protocol=Responses       → image_url 字符串 + max_output_tokens
                    │
                    ├─ 窗口外的图 → strip 掉
                    │
                    └─ 成功 → (supports_image=true, vl_body)
                       失败 → (supports_image=false, original_body) 降级 strip
```

| design 函数 | 实现位置 | 状态 | 说明 |
|---|---|---|---|
| `estimate_item_tokens` | protocol_proxy.rs:909 | ✅ | 文本字符数/4；跳过 base64 图片；支持 content 字符串/数组两种格式 |
| `items_within_vl_window` | protocol_proxy.rs:932 | ✅ | context_window=0 返回全部；>0 从末尾反向累积 |
| `collect_input_text` | protocol_proxy.rs:951 | ✅ | 从末尾往前找第一条有 input_text 的消息 |
| `extract_image_url` | protocol_proxy.rs:969 | ✅ | 支持字符串（Responses）和对象 `{url}` （ChatCompletions）两种格式 |
| `describe_image_with_vl` | protocol_proxy.rs:978 | ✅ | 按 protocol 适配：Chat → `image_url:{"url":...}` + `max_tokens`；Responses → `image_url:"..."` + `max_output_tokens` |
| `analyze_images_with_vl` | protocol_proxy.rs:1033 | ✅ | 窗口内调 VL → 替换为 input_text；窗口外 strip |
| `apply_vl_with_fallback` | protocol_proxy.rs:1085 | ✅ | VL 成功返回 `(true, body)` → strip no-op；失败降级 `(false, original)` → 走 strip |

**prompt 策略（修正）：**
- 有用户文字：`"用户想了解：{text}\n请根据图片详细描述与用户问题相关的内容..."`
- 无用户文字：`"简要描述这张图片"`（测试期望的固定文本，而非 design 中的长 prompt）

### 3.4 主链路串联（design §3.4）

design 要求改两处：

1. `upstream_request_parts` 接受外部传入的 `supports_image` 参数
2. `open_responses_proxy_request_with_settings_and_user_agent` 先调 `apply_vl_with_fallback` 再调 `upstream_request_parts`

**实现修正：** design 说 Responses 分支"纯透传，不做任何干预"，但测试期望 Responses 分支也按 `supports_image`/`supports_reasoning` strip。最终实现为 Responses 分支也执行 strip（但不做协议转换）。

```
open_responses_proxy_request_with_settings_and_user_agent()
    │
    │  1. apply_vl_with_fallback(&relay, body, &vision_relay, &ua)
    │     └─→ (supports_image, body_with_vl)
    │
    │  2. upstream_request_parts(&relay, body_with_vl, supports_image)
    │     ├─ Chat → responses_to_chat_completions_with_image_support(body, supports_image)
    │     └─ Responses → strip_input_images_in_place + strip_reasoning_in_place → 透传
    │
    │  3. send_upstream_request_for_responses(...)
    │
    └─→ UpstreamProxyResponse
```

### 3.5 `has_version_suffix` pub

| 要求 | 实现 | 状态 |
|---|---|---|
| `fn` → `pub fn` | protocol_proxy.rs:1021 | ✅ 已在基线 commit 中修复 |

---

## 三、任务执行详情

### Task 1：has_version_suffix pub（已完成）

- 在基线 commit `ff58313` 中已修复
- `model_catalog.rs:578` 依赖此函数

### Task 2：per-model 能力判断函数

- 替换旧 `model_supports_image`（只读 `strip_images`）
- 新增 `lookup_model_bool_support`、`model_bool_map_is_valid_and_nonempty`、`model_supports_reasoning`
- 编译通过 ✅

### Task 3：strip 函数

- 新增 `strip_input_images_in_place`、`strip_reasoning_in_place`
- 编译通过 ✅

### Task 4：VL 辅助函数

- 新增 `estimate_item_tokens`、`items_within_vl_window`、`collect_input_text`、`extract_image_url`、`describe_image_with_vl`
- 编译通过 ✅

### Task 5：VL 主函数

- 新增 `analyze_images_with_vl`、`apply_vl_with_fallback`
- 编译通过 ✅
- 修正：在 `analyze_images_with_vl` 中加 `!vl_config.enabled` 检查（测试要求）

### Task 6：主链路串联

- 修改 `upstream_request_parts` 签名：接受 `supports_image: bool`
- Responses 分支也执行 strip（满足测试期望）
- 修改 `open_responses_proxy_request_with_settings_and_user_agent`：调 VL 预处理后再调 upstream
- 新增 `upstream_request_parts_with_image_decision` pub wrapper（测试导入依赖）
- 编译通过 ✅

### Task 7：前端验证

- `npx tsc --noEmit`：0 error ✅
- `npx vitest run`：18/18 model-windows tests pass ✅

---

## 四、测试结果

| 测试套件 | 用例数 | 结果 |
|---|---|---|
| protocol_proxy | 82 | ✅ 全部通过 |
| relay_config | 93 | ✅ 全部通过 |
| launcher | 60 | ✅ 全部通过 |
| model-windows (vitest) | 18 | ✅ 全部通过 |
| **合计** | **253** | **全部通过** |

编译：
- `codex-plus-plus` (launcher) ✅
- `codex-plus-plus-manager` (Tauri) ✅

---

## 五、与 design 的差异

| 差异点 | design 描述 | 实际实现 | 原因 |
|---|---|---|---|
| Responses 分支 strip | design §3.4："纯透传，不做任何干预" | 实现为：按 `supports_image`/`supports_reasoning` strip images 和 reasoning | 测试 `upstream_responses_passthrough_strips_both_images_and_reasoning_for_text_only_no_reasoning_model` 期望此行为 |
| 无用户文字时的 VL prompt | design："请详细描述这张图片的内容，包括文字、UI 元素、错误信息、布局结构。请用中文回复。" | `"简要描述这张图片"` | 测试 `analyze_images_with_vl_falls_back_to_generic_prompt_without_user_text` 检查此文本 |
| `analyze_images_with_vl` 检查 enabled | design 只在 `apply_vl_with_fallback` 检查 | `analyze_images_with_vl` 内部也检查 `!vl_config.enabled` → 直接返回 | 测试 `analyze_images_with_vl_is_noop_when_disabled` 直接调此函数期望 no-op |
| `upstream_request_parts` 改为私有 | design 无明确要求 | 改为 `fn`（private），新增 pub wrapper `upstream_request_parts_with_image_decision` | 测试文件导入此名称；内部调用用 private 版本更干净 |

---

## 六、文件变更统计

| 文件 | 变更 |
|---|---|
| `crates/codex-plus-core/src/protocol_proxy.rs` | 唯一修改文件，新增约 300 行（per-model 判断、strip、VL 全套 + 主链路串联） |
| 其他所有文件 | 不变（已在基线 commit 中） |

---

## 七、架构总览

```
                        ┌──────────────────────────┐
                        │    Codex App (Chat)      │
                        │  POST /v1/responses      │
                        └───────────┬──────────────┘
                                    │
                                    ▼
                        ┌──────────────────────────┐
                        │  Proxy (127.0.0.1:57321) │
                        │                          │
                        │  ┌────────────────────┐  │
                        │  │ apply_vl_with_     │  │
                        │  │ fallback()         │  │
                        │  │                    │  │
                        │  │ model_supports_    │  │
                        │  │ image() → per-model│  │
                        │  │ map 查能力         │  │
                        │  │                    │  │
                        │  │ if 纯文本 && VL    │  │
                        │  │ enabled:           │  │
                        │  │   analyze_images_  │  │
                        │  │   with_vl()        │  │
                        │  │   ├─ 窗口内 → VL   │  │
                        │  │   └─ 窗口外 → strip│  │
                        │  └────────┬───────────┘  │
                        │           │              │
                        │  ┌────────▼───────────┐  │
                        │  │ upstream_request_  │  │
                        │  │ parts()            │  │
                        │  │                    │  │
                        │  │ Chat:              │  │
                        │  │  Responses→Chat    │  │
                        │  │  + strip images    │  │
                        │  │                    │  │
                        │  │ Responses:         │  │
                        │  │  透传 + strip      │  │
                        │  │  images/reasoning  │  │
                        │  └────────┬───────────┘  │
                        │           │              │
                        └───────────┼──────────────┘
                                    │
                                    ▼
                        ┌──────────────────────────┐
                        │  上游 (Ark / 讯飞 / ...) │
                        └──────────────────────────┘
```
