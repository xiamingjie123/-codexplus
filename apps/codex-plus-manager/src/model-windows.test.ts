import assert from "node:assert";
import { describe, it } from "node:test";
import type { RelayProfile } from "./App.tsx";
import {
  buildModelWindows,
  modelImageSupportMapToRows,
  modelWindowRowsFromProfile,
  modelWindowsMapToText,
  modelWindowsTextToMap,
  serializeModelWindowRows,
  mergeModelWindowRows,
} from "./model-windows.ts";

// 类型检查：确保 RelayProfile 包含 modelImageSupport 字段
const _profileTypeCheck: RelayProfile = {
  id: "test",
  name: "",
  model: "",
  baseUrl: "",
  upstreamBaseUrl: "",
  apiKey: "",
  protocol: "responses",
  relayMode: "official",
  officialMixApiKey: false,
  testModel: "",
  configContents: "",
  authContents: "",
  useCommonConfig: true,
  contextSelection: { mcpServers: [], skills: [], plugins: [] },
  contextSelectionInitialized: true,
  contextWindow: "",
  autoCompactLimit: "",
  modelList: "",
  modelWindows: "",
  stripImages: false,
  modelImageSupport: "",
  modelReasoningSupport: "",
  userAgent: "",
};

void _profileTypeCheck;

describe("model-windows helpers", () => {
  it("modelWindowsMapToText 按 modelList 行顺序输出窗口文本", () => {
    assert.strictEqual(
      modelWindowsMapToText("a\nb\nc", '{"a":"1M","c":"200K"}'),
      "1M\n\n200K",
    );
  });

  it("modelWindowsMapToText 对非法 JSON 返回空字符串", () => {
    assert.strictEqual(modelWindowsMapToText("a\nb", "not-json"), "");
  });

  it("modelWindowsTextToMap 按行组装 model_windows map", () => {
    assert.strictEqual(
      modelWindowsTextToMap("a\nb\nc", "1M\n\n200K"),
      '{"a":"1M","c":"200K"}',
    );
  });

  it("modelWindowsTextToMap 对没有对应窗口的模型不写入 map", () => {
    assert.strictEqual(
      modelWindowsTextToMap("a\nb", "1M"),
      '{"a":"1M"}',
    );
  });

  it("buildModelWindows 行数一致时返回 modelWindows JSON", () => {
    const result = buildModelWindows("deepseek-v4-flash\ndeepseek-v4-pro", "1M\n");
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.modelWindows, '{"deepseek-v4-flash":"1M"}');
    }
  });

  it("buildModelWindows 行数不一致时返回错误", () => {
    const result = buildModelWindows("a\nb", "1M");
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.includes("2"));
      assert.ok(result.error.includes("1"));
    }
  });

  it("modelWindowRowsFromProfile 把模型和窗口合成同一组行", () => {
    assert.deepStrictEqual(
      modelWindowRowsFromProfile("a\nb\nc", '{"a":"1M","c":"200K"}'),
      [
        { model: "a", window: "1M", textOnly: false, noReasoning: false },
        { model: "b", window: "", textOnly: false, noReasoning: false },
        { model: "c", window: "200K", textOnly: false, noReasoning: false },
      ],
    );
  });

  it("serializeModelWindowRows 从行控件生成 modelList 和 modelWindows", () => {
    assert.deepStrictEqual(
      serializeModelWindowRows([
        { model: "a", window: "1M", textOnly: false, noReasoning: false },
        { model: "", window: "400K", textOnly: false, noReasoning: false },
        { model: "b", window: "", textOnly: false, noReasoning: false },
      ]),
      {
        modelList: "a\nb",
        modelWindows: '{"a":"1M"}',
        modelImageSupport: "{}",
        modelReasoningSupport: "{}",
      },
    );
  });

  it("mergeModelWindowRows 追加上游模型时跳过已有模型并保留窗口", () => {
    assert.deepStrictEqual(
      mergeModelWindowRows(
        [
          { model: "deepseek-v4-flash", window: "1M", textOnly: false, noReasoning: false },
          { model: "  ", window: "", textOnly: false, noReasoning: false },
        ],
        [
          { model: "deepseek-v4-flash", window: "", textOnly: false, noReasoning: false },
          { model: "deepseek-v4-pro", window: "", textOnly: true, noReasoning: false },
          { model: " deepseek-v4-pro ", window: "200K", textOnly: false, noReasoning: false },
        ],
      ),
      [
        { model: "deepseek-v4-flash", window: "1M", textOnly: false, noReasoning: false },
        { model: "deepseek-v4-pro", window: "", textOnly: true, noReasoning: false },
      ],
    );
  });

  it("modelImageSupportMapToRows 解析 JSON map 并按反义存为 textOnly", () => {
    // map 里 false 表示纯文本 → textOnly=true
    // map 里 true 表示多模态 → textOnly=false
    assert.deepStrictEqual(
      modelImageSupportMapToRows('{"deepseek-v4-pro":false,"gpt-5.5":true}'),
      new Map([
        ["deepseek-v4-pro", true],
        ["gpt-5.5", false],
      ]),
    );
  });

  it("modelImageSupportMapToRows 对非法 JSON 返回空 Map", () => {
    assert.deepStrictEqual(modelImageSupportMapToRows("not-json"), new Map());
    assert.deepStrictEqual(modelImageSupportMapToRows(""), new Map());
  });

  it("serializeModelWindowRows 把 textOnly 列写入 modelImageSupport map", () => {
    // textOnly=true（纯文本）才写入 map[model] = false
    // textOnly=false（多模态，默认）从 map 中省略
    const result = serializeModelWindowRows([
      { model: "gpt-5.5", window: "1M", textOnly: false, noReasoning: false },
      { model: "deepseek-v4-pro", window: "200K", textOnly: true, noReasoning: false },
    ]);
    assert.strictEqual(result.modelList, "gpt-5.5\ndeepseek-v4-pro");
    assert.strictEqual(result.modelWindows, '{"gpt-5.5":"1M","deepseek-v4-pro":"200K"}');
    assert.strictEqual(
      result.modelImageSupport,
      '{"deepseek-v4-pro":false}',
      "textOnly=true 才写入 map（map 里 false = 纯文本）；默认 false 是多模态，省略以保持 map 干净",
    );
  });

  it("modelWindowRowsFromProfile 把 modelImageSupport 读进 textOnly 列", () => {
    const rows = modelWindowRowsFromProfile(
      "gpt-5.5\ndeepseek-v4-pro",
      '{"gpt-5.5":"1M"}',
      '{"deepseek-v4-pro":false}',
    );
    assert.deepStrictEqual(rows, [
      { model: "gpt-5.5", window: "1M", textOnly: false, noReasoning: false },
      { model: "deepseek-v4-pro", window: "", textOnly: true, noReasoning: false },
    ]);
  });

  it("modelWindowRowsFromProfile 未配置 modelImageSupport 时默认 textOnly=false（多模态）", () => {
    // spec：未配置默认多模态（textOnly=false）
    const rows = modelWindowRowsFromProfile("gpt-5.5", "", "");
    assert.deepStrictEqual(rows, [
      { model: "gpt-5.5", window: "", textOnly: false, noReasoning: false },
    ]);
  });

  it("modelWindowRowsFromProfile 对非法 JSON 的 modelImageSupport 走默认 false", () => {
    const rows = modelWindowRowsFromProfile("deepseek-v4-pro", "", "not-json");
    assert.strictEqual(rows[0].textOnly, false);
  });

  it("serializeModelWindowRows 把 noReasoning 列写入 modelReasoningSupport map", () => {
    // noReasoning=true（不支持推理）才写入 map[model] = false
    // noReasoning=false（默认支持推理）从 map 中省略
    const result = serializeModelWindowRows([
      { model: "minimax-m3", window: "1M", textOnly: false, noReasoning: false },
      { model: "kimi-k2.6", window: "200K", textOnly: false, noReasoning: true },
    ]);
    assert.strictEqual(result.modelList, "minimax-m3\nkimi-k2.6");
    assert.strictEqual(
      result.modelReasoningSupport,
      '{"kimi-k2.6":false}',
      "noReasoning=true 才写入 map（map 里 false = 不支持推理）；默认 false 是支持推理，省略以保持 map 干净",
    );
  });

  it("modelWindowRowsFromProfile 把 modelReasoningSupport 读进 noReasoning 列", () => {
    const rows = modelWindowRowsFromProfile(
      "minimax-m3\nkimi-k2.6",
      '{"minimax-m3":"1M"}',
      "",
      '{"kimi-k2.6":false}',
    );
    assert.deepStrictEqual(rows, [
      { model: "minimax-m3", window: "1M", textOnly: false, noReasoning: false },
      { model: "kimi-k2.6", window: "", textOnly: false, noReasoning: true },
    ]);
  });

  it("modelWindowRowsFromProfile 未配置 modelReasoningSupport 时默认 noReasoning=false（支持推理）", () => {
    const rows = modelWindowRowsFromProfile("minimax-m3", "", "", "");
    assert.deepStrictEqual(rows, [
      { model: "minimax-m3", window: "", textOnly: false, noReasoning: false },
    ]);
  });
});
