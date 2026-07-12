/// 把 model_windows JSON map 按 model_list 行顺序转成文本（每行一个窗口，空行表示默认）。
export function modelWindowsMapToText(modelList: string, modelWindows: string): string {
  try {
    const map = JSON.parse(modelWindows || "{}") as Record<string, string>;
    return modelList
      .split("\n")
      .map((line) => map[line.trim()] ?? "")
      .join("\n");
  } catch {
    return "";
  }
}

/// 把左右 textarea 文本组装成 model_windows JSON map。
export function modelWindowsTextToMap(modelList: string, modelWindowsText: string): string {
  const models = modelList.split("\n").map((s) => s.trim()).filter(Boolean);
  const windows = modelWindowsText.split("\n").map((s) => s.trim());
  const map: Record<string, string> = {};
  models.forEach((model, index) => {
    if (windows[index]) {
      map[model] = windows[index];
    }
  });
  return JSON.stringify(map);
}

export type ModelWindowRow = {
  model: string;
  window: string;
  /// 路径 A 进阶 + 路径 C 进阶：true = 纯文本模型，false = 多模态模型（默认）。
  /// UI 标签为「只支持文本」，勾选=true 表示用户明确把它标记为纯文本模型。
  textOnly: boolean;
  /// per-model 推理能力：true = 不支持 reasoning（透传时剥除 reasoning 字段），false = 支持推理（默认）。
  /// UI 标签为「不支持推理」，勾选=true 表示该模型收 reasoning 会报错（如 kimi-2.6 on Ark）。
  noReasoning: boolean;
};

export function mergeModelWindowRows(
  currentRows: ModelWindowRow[],
  incomingRows: ModelWindowRow[],
): ModelWindowRow[] {
  const rows: ModelWindowRow[] = [];
  const seen = new Set<string>();
  const append = (row: ModelWindowRow) => {
    const model = row.model.trim();
    if (!model || seen.has(model)) return;
    seen.add(model);
    rows.push({
      model,
      window: row.window.trim(),
      textOnly: row.textOnly ?? false,
      noReasoning: row.noReasoning ?? false,
    });
  };
  currentRows.forEach(append);
  incomingRows.forEach(append);
  return rows.length ? rows : [{ model: "", window: "", textOnly: false, noReasoning: false }];
}

export function modelWindowRowsFromProfile(
  modelList: string,
  modelWindows: string,
  modelImageSupport: string = "",
  modelReasoningSupport: string = "",
): ModelWindowRow[] {
  let windowsMap: Record<string, string> = {};
  let textOnlyMap: Map<string, boolean> = new Map();
  let noReasoningMap: Map<string, boolean> = new Map();
  try {
    windowsMap = JSON.parse(modelWindows || "{}") as Record<string, string>;
  } catch {
    windowsMap = {};
  }
  textOnlyMap = modelImageSupportMapToRows(modelImageSupport);
  noReasoningMap = modelImageSupportMapToRows(modelReasoningSupport);
  const rows = modelList
    .split("\n")
    .map((model) => model.trim())
    .filter(Boolean)
    .map((model) => ({
      model,
      window: windowsMap[model] ?? "",
      // map 里 false（纯文本）-> textOnly=true；map true / 未命中 -> textOnly=false（默认多模态）
      textOnly: textOnlyMap.get(model) ?? false,
      // map 里 false（不支持推理）-> noReasoning=true；map true / 未命中 -> noReasoning=false（默认支持推理）
      noReasoning: noReasoningMap.get(model) ?? false,
    }));
  return rows.length ? rows : [{ model: "", window: "", textOnly: false, noReasoning: false }];
}

export function serializeModelWindowRows(rows: ModelWindowRow[]): {
  modelList: string;
  modelWindows: string;
  modelImageSupport: string;
  modelReasoningSupport: string;
} {
  const modelList: string[] = [];
  const modelWindows: Record<string, string> = {};
  const modelImageSupport: Record<string, boolean> = {};
  const modelReasoningSupport: Record<string, boolean> = {};
  mergeModelWindowRows(rows, []).forEach((row) => {
    const model = row.model.trim();
    if (!model) return;
    modelList.push(model);
    const window = row.window.trim();
    if (window) {
      modelWindows[model] = window;
    }
    // 仅在显式标记为纯文本（textOnly=true）时写入 map[model] = false；
    // textOnly=false（多模态默认）不写以保持 map 干净
    if (row.textOnly) {
      modelImageSupport[model] = false;
    }
    // 仅在显式标记不支持推理（noReasoning=true）时写入 map[model] = false；
    // noReasoning=false（默认支持推理）不写以保持 map 干净
    if (row.noReasoning) {
      modelReasoningSupport[model] = false;
    }
  });
  return {
    modelList: modelList.join("\n"),
    modelWindows: JSON.stringify(modelWindows),
    modelImageSupport: JSON.stringify(modelImageSupport),
    modelReasoningSupport: JSON.stringify(modelReasoningSupport),
  };
}

/// 把 modelImageSupport / modelReasoningSupport JSON map 解析为 `model -> 不支持该能力` 的 Map。
/// map 里 false -> true（不支持该能力，需 strip）；map 里 true -> false（支持该能力）。
/// 未命中 / 非法 JSON -> 调用方按默认 false（支持）处理。
/// 同时用于图片能力（modelImageSupport）和推理能力（modelReasoningSupport）。
export function modelImageSupportMapToRows(json: string): Map<string, boolean> {
  if (!json) return new Map();
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) return new Map();
    const out = new Map<string, boolean>();
    for (const [k, v] of Object.entries(parsed)) {
      if (v === false) {
        // 显式标记为不支持该能力
        out.set(k, true);
      } else if (v === true) {
        // 显式标记为支持该能力
        out.set(k, false);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

export type BuildModelWindowsResult =
  | { ok: true; modelWindows: string }
  | { ok: false; error: string };

/// 校验模型列表与窗口文本行数一致，并组装成 model_windows JSON。
export function buildModelWindows(modelList: string, modelWindowsText: string): BuildModelWindowsResult {
  const models = modelList.split("\n").map((s) => s.trim()).filter(Boolean);
  const windows = modelWindowsText.split("\n").map((s) => s.trim());
  if (models.length !== windows.length) {
    return {
      ok: false,
      error: `模型名称有 ${models.length} 行，上下文窗口有 ${windows.length} 行，请保持行数一致。`,
    };
  }
  return { ok: true, modelWindows: modelWindowsTextToMap(modelList, modelWindowsText) };
}
