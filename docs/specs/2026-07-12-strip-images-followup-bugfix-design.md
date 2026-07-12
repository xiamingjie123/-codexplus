# 纯文本模型图片处理 - 后续 Bug 根因分析与修复设计

> 日期：2026-07-12
> 关联：spec `2026-07-09-text-only-model-image-handling-design.md`、执行日志 `2026-07-10-strip-images-execution-log.md`、交接 `2026-07-12-strip-images-followup-handoff.md`
> 状态：根因已定位，待用户确认后实施。**本文档不含代码改动。**

## 一、问题复现与证据来源

用户实测两组模型，报 4 个问题。证据来自：

- 用户实际配置：`~/.codex-session-delete/settings.json`（8 个 RelayProfile）
- 运行时诊断日志：`~/.codex-session-delete/codex-plus.log`（含 `protocol_proxy.upstream_request` / `upstream_response` 事件）
- 源码：`crates/codex-plus-core/src/protocol_proxy.rs`、`settings.rs`、`launcher.rs`、`relay_rotation.rs`

---

## 二、根因分析（逐条）

### 问题 1：deepseek-v4-flash 报 "Model do not support image input"

**结论：配置缺失，非代码 bug。strip 逻辑本身正确。**

证据链：

1. 用户有两个 Ark 中转，配置不同：
   | 中转 | id | stripImages | modelImageSupport |
   |------|----|-------------|-------------------|
   | 火山引擎 Ark | relay-mqgvyjzg | `false` | 无（None） |
   | 火山引擎 Ark cherry | relay-mrc9vu99 | `true` | `{"deepseek-v4-flash":false,"glm-5.2":false}` |
2. 诊断日志显示实测时走的是 **relay-mqgvyjzg（plain Ark）**：
   `endpoint: https://ark.cn-beijing.volces.com/api/coding/v3/responses, wireApi: Responses`
3. 该中转 `modelImageSupport` 为空 -> `lookup_model_image_support` 返回 `None` -> 回落到 `!relay.strip_images` = `!false` = **`true`**（`protocol_proxy.rs:877-882`）
4. `supports_image = true` -> `strip_input_images_in_place` 走 no-op 分支（`protocol_proxy.rs:911`）-> `input_image` 原样透传给 Ark -> Ark 拒绝

**为什么 cherry 中转能工作**：cherry 的 `modelImageSupport` 命中 `"deepseek-v4-flash": false` -> `supports_image = false` -> `strip_input_images_in_place` 移除 `input_image`。代码路径完全正确。

**根因**：用户在 **未配置 strip 的 plain Ark** 上测了 deepseek-v4-flash。要么切到 cherry 中转，要么给 plain Ark 补 `modelImageSupport` / `stripImages`。

**暴露的 UX 问题**（真实待修）：
- 两个上游相同的 Ark 中转，用户分不清哪个配了 strip
- per-model 配置藏在 JSON map 里，前端表格是否正确回显需复核
- 用户不知道「纯文本模型需手动标记」这一前提

---

### 问题 2：kimi-2.6 报 "reasoning is not supported by current model"

**结论：代码缺口。Responses 透传路径不处理 `reasoning` 字段，需要新增「reasoning strip」能力。**

证据链：

1. kimi-2.6 在 Ark 中转（relay-mqgvyjzg），`protocol: responses`，走 **Responses 透传**分支
2. Codex App 默认在请求体里带 `reasoning: { effort: "..." }`（reasoning 模型惯例）
3. Responses 透传分支（`protocol_proxy.rs:766-776` `upstream_request_parts_with_image_decision`）只调 `strip_input_images_in_place`，**完全不动 `reasoning` 字段** -> 原样转发
4. Ark 的 kimi-k2.6 不支持 `reasoning` 参数 -> 报错

**对比 ChatCompletions 路径**：`apply_chat_reasoning_options`（`protocol_proxy.rs:4174`）会把 `reasoning` 按模型风格转成 `thinking` / `enable_thinking` / `reasoning_split` / `reasoning_effort` 等。kimi 走 `Thinking` 风格（`infer_chat_reasoning_style` 命中 `model.contains("kimi")`）。但这个函数**只在 ChatCompletions 转换里调**（`protocol_proxy.rs:198`），Responses 透传不调。

**根因**：Responses 透传路径缺少「按模型能力剥离/转换不支持的字段」的机制。`reasoning` 是和 `input_image` 同类的「部分模型不支持」字段，需要同款 strip 方案。

**这不是 strip-images 改动引入的回归**——是 Responses 透传一直就没处理 `reasoning`，只是之前用户没在 Ark 上测过带 reasoning 的 kimi 请求。

---

### 问题 3：minimax-M3 "视觉脚本连接失败" + 调用 `~/.codex/skills/vision/vision.py`

**结论：非 Codex++ bug。`vision.py` 是 Codex skill（路径 B.3），不是 Codex++ 的 VL 中转（B.1）。**

证据链：

1. `~/.codex/skills/vision/vision.py` 是一个独立 Python 脚本，带 `SKILL.md`，位于 Codex 的 skills 目录（与 chinese-code-review、systematic-debugging 等 skill 并列）。**不是 Codex++ 代码**，交接文档也明确 ❌ 路径 B.3 不做
2. 该脚本逻辑（已读源码）：多 provider（doubao / qwen / openai），靠环境变量 `DOUBAO_API_KEY` / `DASHSCOPE_API_KEY` / `OPENAI_API_KEY` 选 provider，都没有就默认 doubao 并报连接错误
3. minimax-m3 是视觉+推理模型，在 plain Ark 中转上 `modelImageSupport` 无条目 -> `supports_image = true` -> 图片透传给模型
4. 模型收到图片后，**agent（Codex）自己决定调用 vision skill** -> 脚本因无 API key env 报 "Connection error" -> 模型回灌「视觉脚本连接失败，我直接用模型视觉能力来分析」

**Codex++ 的 VL 中转（B.1）为什么不介入**：`apply_vl_with_fallback`（`protocol_proxy.rs:805`）的早退条件是 `base_supports_image || !vision_relay.enabled`。minimax-m3 `supports_image = true`，VL 直接跳过——VL 只为纯文本模型兜底。

**用户误解**：以为 vision.py 是 Codex++ VL 中转的一部分，以为前端缺配置入口。实际：
- Codex++ VL 配置 UI **已存在**（`App.tsx:3460`，交接文档已交付）
- 但 VL 只对 `supports_image = false` 的模型触发；minimax-m3 是视觉模型，VL 永远不会为它触发
- vision.py 的配置走环境变量，不走 Codex++ settings

**真实可选修复**（需用户决策，非 bug）：
- (a) 给 vision.py 配环境变量（`DOUBAO_API_KEY` 等）——修脚本
- (b) 删除/禁用 vision skill，让 agent 用 minimax-m3 原生视觉
- (c) 若想让 Codex++ VL 对视觉模型也预处理图片（省 token / 统一描述）——属设计变更，非 bugfix

---

### 问题 4：第二组（xunfei）401 "HMAC signature cannot be verified: apikey not found"

**结论：认证机制不匹配。路由转换没坏，是 Codex++ 只支持 Bearer 认证、而讯飞 MAAS 要 HMAC 签名。非 strip-images 回归。**

证据链（诊断日志实锤）：

```
event: protocol_proxy.upstream_request
  relayId: relay-mr95sjrq (xunfei)
  endpoint: https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions
  wireApi: ChatCompletions   ← Responses→Chat 转换成功
  stream: true

event: protocol_proxy.upstream_response
  statusCode: 401            ← 上游拒绝
  willFailover: false
```

1. **路由转换正常**：wireApi 是 `ChatCompletions`、endpoint 是 `/v2/chat/completions`。Responses→Chat 转换在做事，请求确实到达了讯飞
2. **401 来自上游**：Codex++ 入口（`launcher.rs:954` `handle_helper_connection`）对进来请求**不做认证**；`handle_protocol_proxy_connection`（`launcher.rs:1231`）在 upstream 非 2xx 时把上游 body 原样回给 Codex App。所以 Codex App 看到的 401 body 是讯飞返回的，url `127.0.0.1:57321` 是 Codex App 自己的请求 url
3. **认证机制不匹配**：`upstream_request_builder`（`protocol_proxy.rs:847-849`）用 `.bearer_auth(api_key)` 发 `Authorization: Bearer <key>`。讯飞 MAAS API 用 **HMAC-SHA256 签名**认证（需 APIKey + APISecret + 时间戳算签名放 header），不接受 Bearer -> 报 "HMAC signature cannot be verified: apikey not found"
4. `upstream_request_builder` 的 bearer 认证**未被近期 strip-images 改动触碰**（git diff 确认该函数未改）-> 不是回归
5. 附带：xunfei 的 `OPENAI_API_KEY` 值疑似异常（形似 URL，非正常 key），可能双重配置错误

**根因**：Codex++ 不支持 HMAC 签名认证。讯飞这类网关需要 HMAC，所以纯文本也 401（与图片无关）。

---

## 三、修复设计（按优先级）

### 修复 A：Responses 透传剥离 `reasoning`（解决问题 2）— **优先级最高，真代码缺口**

**思路**：复用 strip_images 的「per-model 能力 map + profile 级 fallback」模式，新增 `reasoning` 维度。

**后端**：
- `settings.rs` `RelayProfile` 新增 `model_reasoning_support: String`（JSON map，同 `model_image_support` 序列化模式：`#[serde(default, skip_serializing_if = "String::is_empty")]`）
- `protocol_proxy.rs` 新增 `model_supports_reasoning(relay, model) -> bool`（查 map 优先，未命中回落 `true`——默认支持，向后兼容）
- 新增 `strip_reasoning_in_place(body: &mut Value, supports_reasoning: bool)`：`supports_reasoning = false` 时移除 `body["reasoning"]`
- 在 `upstream_request_parts_with_image_decision` 的 **Responses 分支**调用（与 `strip_input_images_in_place` 并列）。**ChatCompletions 分支不动**（已有 `apply_chat_reasoning_options` 处理）
- `apply_vl_with_fallback` 同理可预计算 `supports_reasoning` 透传（若 VL 启用且目标模型不支持 reasoning，VL 后的 body 仍需剥 reasoning）

**前端**：
- per-model 表格（`App.tsx:4315`）加「支持推理」复选框列（复用 textOnly 列的先例），序列化进 `modelReasoningSupport` map
- 或 MVP 先做 profile 级开关 `stripReasoning`（同 `stripImages`）

**TDD**：先写失败测试——构造带 `reasoning` 的 Responses body，`supports_reasoning=false` 时 `reasoning` 被移除、其余字段不变；`true` 时原样保留。

**注意**：不能直接套 `apply_chat_reasoning_options` 到 Responses 透传——那会改语义（Responses 的 `reasoning` 和 Chat 的 `reasoning_effort` 不是一回事）。MVP 只做 strip（不支持就剥），不做转换。

---

### 修复 B：讯飞 HMAC 签名认证支持（解决问题 4）— **独立新特性，工作量大**

**思路**：给 RelayProfile 加可选的认证方案字段，支持 HMAC-SHA256 签名。

**后端**：
- `settings.rs` `RelayProfile` 新增 `auth_scheme: AuthScheme` 枚举（`Bearer` 默认 / `HmacSha256`）
- HMAC 方案需额外字段：`hmac_api_key` + `hmac_api_secret`（讯飞风格）
- `upstream_request_builder` 按 `auth_scheme` 分支：Bearer 走原逻辑；HmacSha256 算签名放 header（`Authorization` 或讯飞约定的 `X-Api-Key` / `X-Api-Sign` 等，需查讯飞 MAAS coding 文档确认签名格式）
- 讯飞不同产品签名格式可能不同，需先确认 `maas-coding-api.cn-huabei-1.xf-yun.com` 的具体签名规范

**前端**：中转编辑器加认证方案选择 + HMAC 专用字段输入。

**风险**：讯飞签名算法细节需查文档实测；不同 HMAC 网关签名格式不统一，可能需多套实现。建议先确认讯飞是否提供 OpenAI 兼容的 Bearer 入口（很多讯飞产品有 `.../v1/chat/completions` OpenAI 兼容模式）——若有，改 `upstreamBaseUrl` 即可，免做 HMAC。

**先验证再实施**：动手前先用 curl 测讯飞 endpoint 是否接受 Bearer；若不接受，再确认签名规范。**不要盲目写 HMAC 实现。**

---

### 修复 C：strip 配置 UX 复核（解决问题 1 的配置困惑）— **优先级中，半天**

**思路**：确保用户能正确配置并看清 strip 状态。

- 复核 per-model 表格是否正确回显 `modelImageSupport` map（`model-windows.ts:27` helpers）
- 中转列表/下拉显示 strip 配置摘要（如「strip: 2 个文本模型」），让用户一眼分清 plain Ark vs Ark cherry
- 测试连接按钮：给 per-model strip 配置加一个「测一下」入口，发一个带图请求看是否被剥
- 文档：在执行日志或 README 补「纯文本模型需在 per-model 表格勾选『只支持文本』」的说明

**不是代码 bug**，但用户已两次踩坑（plain Ark vs cherry），值得修 UX。

---

### 修复 D：vision skill 处理（解决问题 3）— **需用户决策，可能零代码**

**不写代码**，先和用户确认选哪条：

- (a) 配环境变量：在 Codex 启动环境注入 `DOUBAO_API_KEY` 等（Codex++ 可在 `relay_common_config_contents` 或启动包装里设，但更推荐用户自己在 shell 配）
- (b) 禁用 skill：`rm ~/.codex/skills/vision` 或在 Codex 层禁用，让 minimax-m3 用原生视觉
- (c) Codex++ VL 扩展到视觉模型：设计变更，让 `apply_vl_with_fallback` 在「视觉模型 + VL 强制开启」时也预处理——工作量大，且会让视觉模型丢原图，需慎重

**推荐 (b)**：minimax-m3 自己有视觉，没必要再绕 skill。skill 是给纯文本模型补视觉的，视觉模型用不上。

---

## 四、实施顺序建议

1. **修复 A（reasoning strip）**：真代码缺口，TDD 可控，半天-1 天。解决 kimi-2.6 报错
2. **修复 C（strip UX）**：半天。解决 deepseek-v4-flash 配置困惑
3. **修复 D 决策**：和用户确认 vision skill 去留，可能零代码
4. **修复 B（HMAC）**：先 curl 验证讯飞是否支持 Bearer，再决定是否写 HMAC。工作量 1-2 天（若必须 HMAC）

## 五、不要做（与交接文档一致）

- ❌ 路径 B.3（Codex 插件/skill）——vision.py 已是 skill，不归 Codex++ 管
- ❌ 全局默认 strip 所有图片 / reasoning——会误伤支持多模态/推理的上游
- ❌ 改 spec 路径 A 的 MVP 行为（profile 级 stripImages checkbox）——保持向后兼容
- ❌ 盲目写 HMAC 实现——先确认讯飞签名规范

## 六、验证方法

- **修复 A**：`tests/protocol_proxy.rs` 新增 Responses 透传剥 `reasoning` 的用例（supports_reasoning true/false 两条 + per-model map 命中/未命中）
- **修复 B**：curl 实测讯飞 endpoint；若写 HMAC，加单元测试 mock 签名计算
- **修复 C**：前端 `model-windows.test.ts` 加回显测试；手动 QA 中转列表摘要
- **回归**：`cargo test --workspace --no-fail-fast` + 前端 `npx tsx --test src/model-windows.test.ts` + `npx tsc --noEmit` + 两个 binary 都 build

## 七、待用户确认的决策点

1. **问题 1**：plain Ark 中转是否需要保留？还是统一用 cherry？或给 plain Ark 也补 strip 配置？
2. **问题 2**：reasoning strip 走 per-model map（进阶）还是先 profile 级开关（MVP）？
3. **问题 3**：vision skill 选 (a) 配 env / (b) 禁用 / (c) 扩展 VL？
4. **问题 4**：是否需要支持 HMAC？还是换一个支持 Bearer 的讯飞入口 / 换中转？
