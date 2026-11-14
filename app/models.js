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

// Services that refused a streamed JSON-mode answer this session: their
// JSON-mode calls are streamed without JSON mode from then on.
const noStreamJSON = new Set();

async function viaHTTP(url, key, model, request, extraHeaders = {}, onText = null) {
  const headers = { "content-type": "application/json", authorization: "Bearer " + key, ...extraHeaders };
  const body = { ...request, model };
  // Words can be shown as they come only for plain answers, not tool calls.
  if (onText && !body.tools) {
    if (noStreamJSON.has(url)) delete body.response_format;
    let answer = await streamed(url, headers, body, onText);
    if (answer.status === 400 && body.response_format && /json|stream/i.test(answer.body)) {
      noStreamJSON.add(url);
      delete body.response_format;
      answer = await streamed(url, headers, body, onText);
    }
    return answer;
  }
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text();
  // A JSON-mode answer the service could not make is asked again without
  // JSON mode: the program checks the answer's shape itself.
  if (r.status === 400 && body.response_format && /json/i.test(text)) {
    delete body.response_format;
    const again = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: again.status, body: await again.text() };
  }
  return { status: r.status, body: text };
}

// One streamed call: onText(all words so far) as they arrive, then the
// answer shaped as if it had not been streamed, so the engine sees no change.
async function streamed(url, headers, body, onText) {
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...body, stream: true }) });
  if (!r.ok || !r.body || !/event-stream/i.test(r.headers.get("content-type") || "")) {
    return { status: r.status, body: await r.text() };
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", finish = "stop", id = "", usage = null, failed = null;
  const take = (line) => {
    line = line.trim();
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk;
    try { chunk = JSON.parse(data); } catch (e) { return; }
    if (chunk.error) { failed = chunk.error; return; }
    id = chunk.id || id;
    usage = chunk.usage || chunk.x_groq?.usage || usage;
    const ch = chunk.choices && chunk.choices[0];
    if (!ch) return;
    if (ch.finish_reason) finish = ch.finish_reason;
    const piece = ch.delta && ch.delta.content;
    if (piece) {
      text += piece;
      try { onText(text); } catch (e) {}
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      take(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  }
  take(buf);
  if (failed) return { status: 400, body: JSON.stringify({ error: failed }) };
  return { status: 200, body: JSON.stringify(finished(id, body.model, text, finish, usage)) };
}

function finished(id, model, text, finish, usage) {
  const out = { id: id || "kosika-stream", object: "chat.completion", model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finish }] };
  if (usage) out.usage = usage;
  return out;
}

async function viaPhone(request, onText = null) {
  const id = settings.localModel;
  const e = await loadLocal(id);
  const asked = {
    messages: request.messages.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "") })),
    max_tokens: Math.min(request.max_tokens || 1024, 1500),
    temperature: request.temperature ?? 0.4,
  };
  if (request.response_format) asked.response_format = { type: "json_object" };
  if (!onText) {
    const answer = await e.chat.completions.create(asked);
    return { status: 200, body: JSON.stringify(answer) };
  }
  let text = "", finish = "stop";
  for await (const chunk of await e.chat.completions.create({ ...asked, stream: true })) {
    const ch = chunk.choices && chunk.choices[0];
    if (!ch) continue;
    if (ch.finish_reason) finish = ch.finish_reason;
    if (ch.delta && ch.delta.content) {
      text += ch.delta.content;
      try { onText(text); } catch (err) {}
    }
  }
  return { status: 200, body: JSON.stringify(finished("", id, text, finish, null)) };
}

// Answer one model call from the engine. `body` is the OpenAI-style request
// the engine wrote, word for word as it sends it on the laptop. With onText,
// the answer is streamed and onText(words so far) is called as it grows.
export async function complete(body, onWho = () => {}, onText = null) {
  let request;
  try {
    request = JSON.parse(body);
  } catch (e) {
    return errorBody(400, "Kosika sent a request that is not JSON");
  }
  const mode = settings.mode;
  const net = online();
  const tries = [];
  if (mode !== "offline" && net && settings.groqKey) tries.push(["Groq", () => viaHTTP("https://api.groq.com/openai/v1/chat/completions", settings.groqKey, settings.groqModel, request, {}, onText)]);
  if (mode !== "offline" && net && settings.openrouterKey) tries.push(["OpenRouter", () => viaHTTP("https://openrouter.ai/api/v1/chat/completions", settings.openrouterKey, settings.openrouterModel, request, { "X-Title": "Kosika" }, onText)]);
  if (mode !== "online" && settings.localModel && hasWebGPU()) tries.push(["phone", () => viaPhone(request, onText)]);
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
