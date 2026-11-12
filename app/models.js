// Who answers when a Kosika program asks a model.
//
// Online, with your own free key: Groq first, then OpenRouter (":free"
// models only). Offline, or with no key: a small Qwen model that runs on the
// phone itself (WebLLM, on the phone's GPU), once you have downloaded it in
// Settings. Your keys stay in this phone's storage and are sent only to the
// service they belong to.

const LS = {
  get(k, d = "") { try { return localStorage.getItem("kosika." + k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("kosika." + k, v); } catch (e) {} },
};

export const settings = {
  get groqKey() { return LS.get("groqKey"); },
  set groqKey(v) { LS.set("groqKey", v.trim()); },
  get openrouterKey() { return LS.get("openrouterKey"); },
  set openrouterKey(v) { LS.set("openrouterKey", v.trim()); },
  get groqModel() { return LS.get("groqModel", "openai/gpt-oss-120b"); },
  set groqModel(v) { LS.set("groqModel", v.trim()); },
  get openrouterModel() { return LS.get("openrouterModel", "openai/gpt-oss-120b:free"); },
  set openrouterModel(v) { LS.set("openrouterModel", v.trim()); },
  // auto: online when there is a network and a key, else the phone's model.
  get mode() { return LS.get("mode", "auto"); },
  set mode(v) { LS.set("mode", v); },
  get localModel() { return LS.get("localModel", ""); },
  set localModel(v) { LS.set("localModel", v); },
};

export const LOCAL_MODELS = [
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Small (Qwen 2.5, 0.5B)", download: "about 280 MB", note: "Fast. Good for short answers and simple drawings." },
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Better (Qwen 2.5, 1.5B)", download: "about 880 MB", note: "Slower, smarter. Needs a recent iPhone (iOS 26) with WebGPU." },
];

// ---------------------------------------------------------------- the phone's own model

let webllm = null;
let engine = null;
let engineId = "";
let loading = null;

export function hasWebGPU() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

async function lib() {
  if (!webllm) webllm = await import("./engine/web-llm.js");
  return webllm;
}

// Is the model's data already on this phone?
export async function localDownloaded(id) {
  try {
    const w = await lib();
    return await w.hasModelInCache(id);
  } catch (e) {
    return false;
  }
}

// Download (the first time) and start the phone's model.
export async function loadLocal(id, onProgress = () => {}) {
  if (engine && engineId === id) return engine;
  if (loading) return loading;
  if (!hasWebGPU()) throw new Error("This browser has no WebGPU, so a model cannot run on the phone. On iPhone it needs iOS 26 or newer.");
  loading = (async () => {
    const w = await lib();
    if (engine) {
      try { await engine.unload(); } catch (e) {}
      engine = null;
    }
    engine = await w.CreateMLCEngine(id, { initProgressCallback: (p) => onProgress(p) });
    engineId = id;
    settings.localModel = id;
    return engine;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function forgetLocal(id) {
  const w = await lib();
  if (engine && engineId === id) {
    try { await engine.unload(); } catch (e) {}
    engine = null;
    engineId = "";
  }
  await w.deleteModelAllInfoInCache(id);
  if (settings.localModel === id) settings.localModel = "";
}

// ---------------------------------------------------------------- choosing who answers

export function online() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

// What would answer right now, in words for the status line.
export function whoAnswers() {
  const mode = settings.mode;
  const net = online();
  if (mode !== "offline" && net && settings.groqKey) return { where: "online", name: "Groq · " + settings.groqModel };
  if (mode !== "offline" && net && settings.openrouterKey) return { where: "online", name: "OpenRouter · " + settings.openrouterModel };
  if (settings.localModel) return { where: "phone", name: "On this phone · " + (LOCAL_MODELS.find((m) => m.id === settings.localModel)?.name || settings.localModel) };
  return { where: "none", name: net ? "No model yet: add a free key in Settings" : "Offline, code only" };
}

function errorBody(status, message) {
  return { status, body: JSON.stringify({ error: { message } }) };
}

async function viaHTTP(url, key, model, request, extraHeaders = {}) {
  const body = { ...request, model };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key, ...extraHeaders },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  // A JSON-mode answer the service could not make is asked again without
  // JSON mode: the program checks the answer's shape itself.
  if (r.status === 400 && body.response_format && /json/i.test(text)) {
    delete body.response_format;
    const again = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key, ...extraHeaders }, body: JSON.stringify(body) });
    return { status: again.status, body: await again.text() };
  }
  return { status: r.status, body: text };
}

async function viaPhone(request) {
  const id = settings.localModel;
  const e = await loadLocal(id);
  const asked = {
    messages: request.messages.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "") })),
    max_tokens: Math.min(request.max_tokens || 1024, 1500),
    temperature: request.temperature ?? 0.4,
  };
  if (request.response_format) asked.response_format = { type: "json_object" };
  const answer = await e.chat.completions.create(asked);
  return { status: 200, body: JSON.stringify(answer) };
}

// Answer one model call from the engine. `body` is the OpenAI-style request
// the engine wrote, word for word as it sends it on the laptop.
export async function complete(body, onWho = () => {}) {
  let request;
  try {
    request = JSON.parse(body);
  } catch (e) {
    return errorBody(400, "Kosika sent a request that is not JSON");
  }
  const mode = settings.mode;
  const net = online();
  const tries = [];
  if (mode !== "offline" && net && settings.groqKey) tries.push(["Groq", () => viaHTTP("https://api.groq.com/openai/v1/chat/completions", settings.groqKey, settings.groqModel, request)]);
  if (mode !== "offline" && net && settings.openrouterKey) tries.push(["OpenRouter", () => viaHTTP("https://openrouter.ai/api/v1/chat/completions", settings.openrouterKey, settings.openrouterModel, request, { "X-Title": "Kosika" })]);
  if (mode !== "online" && settings.localModel && hasWebGPU()) tries.push(["phone", () => viaPhone(request)]);
  if (!tries.length) {
    if (!net || mode === "offline") return errorBody(400, "Kosika is offline and no model is on this phone yet. Drawings Kosika makes by code still work. To think offline, download a model in Settings while you have a network.");
    return errorBody(400, "No model to ask yet. Add your free Groq or OpenRouter key in Settings, or download a model to this phone.");
  }
  let last = null;
  for (const [who, attempt] of tries) {
    onWho(who);
    try {
      const answer = await attempt();
      // Busy or refused: try the next one before giving up.
      if (answer.status === 429 || answer.status >= 500 || answer.status === 401 || answer.status === 403) {
        last = answer;
        continue;
      }
      return answer;
    } catch (e) {
      last = errorBody(400, `${who} could not be reached: ${e.message || e}`);
    }
  }
  // Only a plain refusal goes back: a 429 would make the engine wait for
  // minutes, and the phone has already tried everyone it can.
  if (last && (last.status === 429 || last.status >= 500)) return errorBody(400, "Every model is busy right now (rate limit). Try again in a minute. " + last.body.slice(0, 300));
  return last;
}
