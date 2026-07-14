# 任务交接：reasoning strip + stripImages/map 冲突修复

> 日期：2026-07-12
> 前序：`docs/handoff/2026-07-12-strip-images-followup-handoff.md`
> 关联 spec：`docs/specs/2026-07-12-strip-images-followup-bugfix-design.md`

---

## 一、本次改了什么

### 1.1 reasoning strip（per-model，Responses 透传）- 解决 kimi-2.6 报错

用户反馈 kimi-2.6 on Ark（Responses 透传）报 "reasoning is not supported by current model"。根因：Codex 默认在 Responses 请求带 `reasoning` 字段，透传路径不处理。

修复：
- `RelayProfile.model_reasoning_support: String`（JSON map，`{"kimi-k2.6": false}`）
- `model_supports_reasoning(relay, model)`：map 命中用 map 值，未命中默认 `true`。**无 profile 级开关**，避免和 stripImages 冲突
- `strip_reasoning_in_place(body, supports_reasoning)`：`false` 时移除 `body["reasoning"]`
- `upstream_request_parts_with_image_decision` 改 `pub`，Responses 分支调 `strip_reasoning_in_place`
- 前端 per-model 表格加「不支持推理」复选框列

### 1.2 stripImages/map 冲突修复 - 解决视觉模型被误 strip

用户反馈：cherry 中转 `stripImages=true` + `modelImageSupport={"deepseek-v4-flash":false,"glm-5.2":false}` 时，kimi-2.6（不在 map）被 fallback `!strip_images=true` -> `false` -> 误 strip。必须取消 `stripImages` 才正常。

修复 `model_supports_image` fallback：
- map 有效且非空时：未列出模型默认 `true`（支持图片），不受 `strip_images` 影响
- map 空 / 非法 JSON：退化为 `!strip_images`（MVP 行为）

新增 `model_bool_map_is_valid_and_nonempty` helper 判断 map 是否有效非空（避免 `"not json"` 被误判）。

### 1.3 大小写不敏感匹配 - 解决 GLM 5.2 strip 不生效

`lookup_model_image_support` -> `lookup_model_bool_support`（generic，image + reasoning 共用），改 case-insensitive。解决 map key `GLM-5.2` vs Codex 发 `glm-5.2` 不匹配。

---

## 二、关键代码位置

| 找什么 | 在哪 |
|--------|------|
| per-model 图片能力查询 | `protocol_proxy.rs` `model_supports_image` |
| per-model 推理能力查询 | `protocol_proxy.rs` `model_supports_reasoning` |
| 大小写不敏感 map 查找 | `protocol_proxy.rs` `lookup_model_bool_support` |
| map 有效非空判断 | `protocol_proxy.rs` `model_bool_map_is_valid_and_nonempty` |
| Responses 透传剥图片 | `protocol_proxy.rs` `strip_input_images_in_place` |
| Responses 透传剥 reasoning | `protocol_proxy.rs` `strip_reasoning_in_place` |
| 透传分支串联两 strip | `protocol_proxy.rs` `upstream_request_parts_with_image_decision`（pub） |
| per-model map 字段 | `settings.rs` `model_image_support` + `model_reasoning_support` |
| 前端 per-model 表格 | `App.tsx` 模型列表表格（textOnly + noReasoning 两列） |
| 前端 helpers | `model-windows.ts` `ModelWindowRow`（textOnly + noReasoning） |

---

## 三、测试

- 后端：`cargo test --test protocol_proxy` 78/78（含 8 新增 + 2 改写）
- 后端回归：relay_config 93/93、launcher 60/60、workspace 全通过（1 pre-existing 失败无关）
- 前端：`model-windows.test.ts` 18/18（含 3 新增 noReasoning）
- tsc 0 error、vite build 成功、cargo fmt 通过、两 binary 都 build

---

## 四、用户需做的验证

1. 重启 Codex++（`bash scripts/dev.sh`）
2. 中转编辑器 -> 模型列表 -> 给 kimi-2.6 勾「不支持推理」
3. 测 kimi-2.6：带 reasoning 请求不再报错
4. 确认 GLM 5.2（勾「只支持文本」）图片被 strip
5. 确认视觉模型（minimax/kimi 未勾「只支持文本」）在 stripImages=true + 非空 map 时仍收图

---

## 五、本次未做的（用户已确认 / 自行解决）

- **讯飞 401**：用户切到正确 API key 后已解决，非代码问题。`relay_config.rs` 未改（git diff 确认 auth 流程未变）
- **vision.py skill**：用户已删除 `~/.codex/skills/vision/`，不再用 skill 方案
- **VL 中转（B1）进阶**：仍为原状（VL 只对纯文本模型触发）。用户未要求改

---

## 六、给下一个 Agent 的建议

1. 若用户报「reasoning 还是没剥」：检查是否在 ChatCompletions 中转（那条路径走 `apply_chat_reasoning_options` 转换，不走 strip）。Responses 透传才走 `strip_reasoning_in_place`
2. 若用户报「视觉模型还是被 strip」：检查 `modelImageSupport` map 是否有效非空（`model_bool_map_is_valid_and_nonempty`），以及模型名是否在 map 里（大小写不敏感，但要确实存在）
3. ChatCompletions 路径的 reasoning 处理（`apply_chat_reasoning_options`）未动，若该路径有 reasoning 报错，是另一个问题
4. VL 中转仍未做流式 / 体积控制 / 超时（spec 第八章，交接文档列的推进方向 ② ③）

## 七、2026-07-12 续补：VL 带问题识图 + max_tokens 可配

### 改了什么

1. **VL 转发用户提问文字**（不再用固定提示词）：`analyze_images_with_vl` 收集同一条消息里的 `input_text`，传给 `describe_image_with_vl`。有用户文字时 prompt = `"用户想了解：{text}\n请根据图片详细描述与用户问题相关的内容..."`；无文字时退回固定提示词。
2. **VL max_tokens 可配**：`VisionRelayConfig.max_tokens: u32`（默认 256），`describe_image_with_vl` 用它替代硬编码 256。前端 VL 设置页加「最大回复 token」输入框。

### 为什么做

用户反馈 VL 描述泛泛、细节会说错。根因：VL 发固定"描述这张图"提示词，不知道用户想问什么。带问题识图后 VL 描述聚焦用户关心的内容，text-only 模型拿到的信息更精准，也能减少 text-only 模型的推理量（缓解压缩问题）。

### 关键代码位置

| 找什么 | 在哪 |
|--------|------|
| VL 收集用户文字 | `protocol_proxy.rs` `analyze_images_with_vl`（`// 收集同一条消息里的 input_text`） |
| VL prompt 构造 | `protocol_proxy.rs` `describe_image_with_vl`（`user_text` 参数） |
| VL max_tokens 字段 | `settings.rs` `VisionRelayConfig.max_tokens` + `default_vl_max_tokens()` |
| 前端 VL max_tokens 输入 | `App.tsx` VL 设置页「最大回复 token」|

### 测试

- 后端 81/81（+3 新：带问题识图 / max_tokens 可配 / 无文字退回固定提示词）
- settings serde 8/8、relay_config 93/93、launcher 60/60
- 前端 18/18、tsc 0 error、vite build 成功、两 binary build 成功
