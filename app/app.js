// Kosika on the phone: Kosi, Designs, the agents, saved answers, settings.
// Every question goes through Kosika programs run by the real engine
// (kosika.js); this file only shows what they give back.

import { run, warm, whyNot, forgetMemories } from "./kosika.js";
import { canListen, canSpeak, listen, stopListening, speak, stopSpeaking, voices, voiceSettings } from "./voice.js";
import { settings, LOCAL_MODELS, hasWebGPU, loadLocal, localDownloaded, forgetLocal, whoAnswers, online } from "./models.js";

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.append(k);
  return e;
};

// ---------------------------------------------------------------- saved answers (IndexedDB)

const store = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("kosika-app", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("saved", { keyPath: "id" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this.db;
  },
  async put(item) {
    try {
      const d = await this.open();
      d.transaction("saved", "readwrite").objectStore("saved").put(item);
    } catch (e) {}
  },
  async all() {
    try {
      const d = await this.open();
      return await new Promise((resolve) => {
        const r = d.transaction("saved").objectStore("saved").getAll();
        r.onsuccess = () => resolve(r.result.sort((a, b) => b.at - a.at));
        r.onerror = () => resolve([]);
      });
    } catch (e) {
      return [];
    }
  },
  async clear() {
    try {
      const d = await this.open();
      d.transaction("saved", "readwrite").objectStore("saved").clear();
    } catch (e) {}
  },
};

// ---------------------------------------------------------------- status

function showStatus() {
  const w = whoAnswers();
  const pill = $("#status");
  pill.dataset.where = w.where;
  $("#status-text").textContent = (online() ? "" : "Offline · ") + w.name;
}
addEventListener("online", showStatus);
addEventListener("offline", showStatus);

// ---------------------------------------------------------------- tabs

function show(tab) {
  for (const v of document.querySelectorAll(".view")) v.hidden = v.dataset.view !== tab;
  for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("on", b.dataset.tab === tab);
  $("#ask-form").hidden = !(tab === "kosi" || (tab === "agents" && !$("#agent-chat").hidden));
  if (tab === "saved") showSaved();
  if (tab === "settings") showSettings();
  scrollTo(0, 0);
}
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => show(b.dataset.tab));
$("#status").addEventListener("click", () => show("settings"));

// ---------------------------------------------------------------- pictures

// A drawing is shown in a sandboxed frame that tells us its height.
const SIZER = `<script>(function(){function s(){parent.postMessage({kosikaHeight:Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)},"*")}addEventListener("load",s);new ResizeObserver(s).observe(document.documentElement);setTimeout(s,400);setTimeout(s,1500)})()<\/script>`;

function pageFor(result) {
  if (result.embed) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#06070d;color:#e9ecf8;font:15px system-ui,sans-serif}body{padding:8px}.kd-frame{width:100%;min-height:560px;border:0}</style></head><body>${result.embed}${SIZER}</body></html>`;
  }
  if (result.page) return result.page.includes("</body>") ? result.page.replace("</body>", SIZER + "</body>") : result.page + SIZER;
  return "";
}

addEventListener("message", (e) => {
  const h = e.data && e.data.kosikaHeight;
  if (!h) return;
  for (const f of document.querySelectorAll(".pic iframe")) {
    if (f.contentWindow === e.source) f.style.height = Math.min(Math.max(h, 220), 1400) + "px";
  }
});

function picture(result) {
  const html = pageFor(result);
  if (!html) return null;
  const frame = el("iframe", { sandbox: "allow-scripts", title: result.title || "Kosika Designs", loading: "lazy" });
  frame.srcdoc = html;
  const open = el("button", { class: "ghost small", type: "button", text: "Full screen", onclick: () => fullScreen(html) });
  return el("div", { class: "pic" }, frame, el("div", { class: "bar" }, el("b", { text: result.title || result.kind || "Drawing" }), open));
}

function fullScreen(html) {
  const frame = el("iframe", { sandbox: "allow-scripts", title: "Drawing" });
  frame.srcdoc = html;
  const box = el("div", { class: "full" }, el("button", { class: "close", type: "button", "aria-label": "Close", text: "✕", onclick: () => box.remove() }), frame);
  document.body.append(box);
}

// ---------------------------------------------------------------- one answer card

function card(feed, label = "Kosi") {
  const c = {
    root: el("div", { class: "kosi" }),
    who: el("div", { class: "who", text: label }),
    text: el("div", { class: "text" }),
    route: el("div", { class: "route", hidden: "" }),
    body: el("div"),
    steps: el("ul", { class: "steps" }),
  };
  c.root.append(c.who, c.route, c.text, c.body, c.steps);
  feed.append(c.root);
  c.step = (words, on = true) => {
    for (const li of c.steps.querySelectorAll("li.on")) li.classList.remove("on");
    const li = el("li", { class: on ? "on" : "", text: words });
    c.steps.append(li);
    c.root.scrollIntoView({ block: "end", behavior: "smooth" });
    return li;
  };
  c.done = () => { for (const li of c.steps.querySelectorAll("li.on")) li.classList.remove("on"); };
  c.note = (words, calm = false, action = null) => {
    const n = el("div", { class: "note" + (calm ? " calm" : ""), text: words });
    if (action) n.append(el("br"), action);
    c.body.append(n);
  };
  return c;
}

// Run a program, narrating it on the card.
async function narrated(c, program, workflow, input, what) {
  const li = c.step(what);
  const t0 = performance.now();
  let calls = 0;
  const done = await run(program, workflow, input, {
    onEvent: (e) => {
      if (e.type === "who") { calls++; li.textContent = `${what} · asking ${e.who === "phone" ? "the model on this phone" : e.who} (call ${calls})`; }
    },
  });
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  li.textContent = `${what} · ${done.code === 0 ? "done" : "stopped"} in ${secs}s${calls ? `, ${calls} model call${calls > 1 ? "s" : ""}` : ", no model"}`;
  li.classList.remove("on");
  if (done.code !== 0) li.classList.add("bad");
  return done;
}

function settingsButton() {
  return el("button", { class: "ghost small", type: "button", text: "Open Settings", onclick: () => show("settings") });
}

function needsModelNote(c, done) {
  const why = whyNot(done);
  const noModel = /No model to ask|offline and no model/i.test(why);
  c.note(why, noModel, noModel ? settingsButton() : null);
}

function showDrawing(c, result) {
  if (!result) return;
  const p = picture(result);
  if (p) c.body.append(p);
  if (result.problems && result.problems.length) c.body.append(el("ul", { class: "problems" }, ...result.problems.slice(0, 4).map((t) => el("li", { text: t }))));
}

// ---------------------------------------------------------------- Kosi: the one door

const thinking = () => !!whoAnswers().where.match(/online|phone/);

async function draw(c, text, kind, palette = currentPalette()) {
  const offlineArt = kind === "art" && !thinking();
  const done = offlineArt
    ? await narrated(c, "kosi", "art", { msg: { text } }, "Designs draws art by code")
    : await narrated(c, "kosi", "design", { ask: { text, palette, place: "chat", kind } }, `Designs draws ${kind || "it"}`);
  if (done.code === 0 && done.result) showDrawing(c, done.result);
  else needsModelNote(c, done);
  return done.code === 0 ? done.result : null;
}

async function askKosi(text) {
  const feed = $("#kosi-feed");
  $(".hello", feed)?.remove();
  feed.append(el("div", { class: "me", text }));
  const c = card(feed);
  const saved = { id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), at: Date.now(), q: text, agent: "kosi", text: "", drawing: null };

  const routed = await narrated(c, "kosi", "route", { msg: { text } }, "Kosi chooses who answers");
  if (routed.code !== 0 || !routed.result) {
    c.note("Kosika could not start: " + whyNot(routed));
    c.done();
    return;
  }
  const r = routed.result;
  c.route.hidden = false;
  c.route.textContent = r.why;
  saved.route = r;

  if (r.agent === "notebook" || r.agent === "router") {
    c.who.textContent = r.agent === "notebook" ? "Kosi · Notebook" : "Kosi · Router";
    // The notebook keeps "remember X"; people often type "remember: X".
    const said = r.agent === "notebook" ? text.replace(/^\s*remember\s*:\s*/i, "remember ") : text;
    const done = await narrated(c, r.agent, "main", { msg: { text: said } }, `The ${r.agent} agent works`);
    if (done.code === 0) c.text.textContent = saved.text = done.result.text;
    else needsModelNote(c, done);
  } else if (r.agent === "designs") {
    c.who.textContent = "Kosi · Designs";
    saved.drawing = await draw(c, text, r.kind);
  } else {
    if (thinking()) {
      const said = await narrated(c, "kosi", "answer", { msg: { text } }, "Kosi thinks");
      if (said.code === 0) c.text.textContent = saved.text = said.result.text || "(Kosi had nothing to say.)";
      else needsModelNote(c, said);
      if (r.picture && said.code === 0) saved.drawing = await draw(c, text, r.kind);
    } else {
      c.note(online()
        ? "Kosi needs a model to answer in words. Add your free Groq key, or download a model to this phone, in Settings."
        : "You are offline and no model is on this phone yet, so Kosi cannot answer in words. Kosika can still balance reactions, convert units, open the periodic table and make art. Download a model in Settings next time you are online.", true, settingsButton());
    }
  }
  c.done();
  if (saved.text || saved.drawing) store.put(saved);
  return spokenFor(saved, c);
}

// What Kosi says out loud: the answer, and a word about the picture.
function spokenFor(saved, c) {
  const parts = [];
  if (saved.text) parts.push(saved.text);
  if (saved.drawing) parts.push(saved.text ? `I drew it too: ${saved.drawing.title || "have a look"}.` : `Here it is: ${saved.drawing.title || "drawn by Kosika"}. ${saved.route?.why || ""}`);
  if (!parts.length) parts.push(c.body.innerText.split("\n")[0] || "I could not answer that.");
  return parts.join(" ");
}

// ---------------------------------------------------------------- the ask box

const askForm = $("#ask-form");
const askText = $("#ask-text");
let busy = false;
let spokenNext = false;
askText.addEventListener("input", () => {
  askText.style.height = "auto";
  askText.style.height = Math.min(askText.scrollHeight, 140) + "px";
});
askText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    askForm.requestSubmit();
  }
});
askForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = askText.value.trim();
  if (!text || busy) return;
  askText.value = "";
  askText.style.height = "auto";
  busy = true;
  $(".send", askForm).disabled = true;
  const byVoice = spokenNext;
  spokenNext = false;
  try {
    let said;
    if (!$("#view-agents").hidden && currentAgent) said = await askAgent(currentAgent, text);
    else said = await askKosi(text);
    if (byVoice && voiceSettings.speak && said) speak(said);
  } finally {
    busy = false;
    $(".send", askForm).disabled = false;
  }
});

const TRIES = [
  ["How does the heart pump blood?", ""],
  ["balance CH4 + O2 -> CO2 + H2O", "offline"],
  ["convert 60 km/h to m/s", "offline"],
  ["tell me about sodium", "offline"],
  ["a calm generative piece about the sea", "offline"],
  ["remember: physics exam on 12 December", "offline"],
  ["when is my physics exam?", "offline"],
  ["compare TCP and UDP", ""],
];
for (const [t, tag] of TRIES) {
  $("#tries").append(el("button", { class: "try", type: "button", onclick: () => { askText.value = t; askForm.requestSubmit(); } }, t, tag ? el("small", { text: "offline" }) : null));
}

// ---------------------------------------------------------------- Designs

const DESIGN_TRIES = [["draw the water cycle", ""], ["why does a pendulum swing", "canvas"], ["quiz me on photosynthesis", "quiz"], ["balance Fe + O2 -> Fe2O3", "chemistry"], ["the periodic table", "element"], ["a lively piece about fire", "art"]];
for (const [t, k] of DESIGN_TRIES) {
  $("#design-tries").append(el("button", { class: "try", type: "button", text: t, onclick: () => { $("#design-text").value = t; $("#design-kind").value = k; $("#design-form").requestSubmit(); } }));
}
$("#design-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#design-text").value.trim();
  if (!text) return;
  const go = $("#design-form .go");
  go.disabled = true;
  const out = $("#design-out");
  out.innerHTML = "";
  const c = card(out, "Kosika Designs");
  const kind = $("#design-kind").value;
  const result = await draw(c, text, kind, $("#design-palette").value || currentPalette());
  if (result) {
    c.route.hidden = false;
    c.route.textContent = result.why;
    store.put({ id: Date.now() + "-d", at: Date.now(), q: text, agent: "designs", text: "", drawing: result });
  }
  c.done();
  go.disabled = false;
});

// ---------------------------------------------------------------- Agents

const AGENTS = [
  { id: "study", icon: "🎓", name: "Study", about: "Answers in plain words from your notes, and Designs draws the picture. Say “remember: …” to keep a note.", net: true, tries: ["remember: Physics 2 exam on 12 December covers waves and optics", "explain how a transistor works", "what is on my physics exam"] },
  { id: "explain", icon: "🖼️", name: "Explainer", about: "Answers a question in a few sentences and draws a whole canvas beside it.", net: true, workflow: "explain", input: (t) => ({ q: { text: t } }), tries: ["how does a rainbow form", "why is the sky blue"] },
  { id: "coach", icon: "🏅", name: "Coach", about: "Quizzes you, keeps what you got wrong, asks it again. Reviews need no model.", net: true, tries: ["quiz physics", "review", "score", "help"] },
  { id: "notebook", icon: "📓", name: "Notebook", about: "Tell it things, ask later in your own words. No model needed.", net: false, tries: ["remember Rent is 900 euros a month", "what is the rent a month?", "wrong", "right"] },
  { id: "router", icon: "🚆", name: "Router", about: "The cheapest way across a small rail network, by A* search. No model needed to plan.", net: false, tries: ["from Ashby to Cove", "fewest stops Birch to Elm", "the network"] },
];
let currentAgent = null;

for (const a of AGENTS) {
  $("#agent-cards").append(el("button", { class: "agent", type: "button", onclick: () => openAgent(a) },
    el("div", { class: "ic", text: a.icon }),
    el("div", {}, el("b", { text: a.name }), el("span", { text: a.about }), el("br"), el("i", { class: "tag" + (a.net ? " net" : ""), text: a.net ? "needs a model" : "works offline" }))));
}

function openAgent(a) {
  currentAgent = a;
  $("#agents-list").hidden = true;
  $("#agent-chat").hidden = false;
  $("#agent-name").textContent = a.icon + " " + a.name;
  $("#agent-tag").textContent = a.net ? "Needs Groq, OpenRouter or the phone's model" : "Works offline, with no model";
  const feed = $("#agent-feed");
  feed.innerHTML = "";
  feed.append(el("p", { class: "soft small", text: a.about }), el("div", { class: "chips" }, ...a.tries.map((t) => el("button", { class: "try", type: "button", text: t, onclick: () => { askText.value = t; askForm.requestSubmit(); } }))));
  $("#ask-form").hidden = false;
  askText.placeholder = "Say something to " + a.name + "…";
}
$("#agent-back").addEventListener("click", () => {
  currentAgent = null;
  $("#agents-list").hidden = false;
  $("#agent-chat").hidden = true;
  $("#ask-form").hidden = true;
  askText.placeholder = "Ask Kosi…";
});

async function askAgent(a, text) {
  const feed = $("#agent-feed");
  feed.append(el("div", { class: "me", text }));
  const c = card(feed, a.name);
  const said = a.id === "notebook" ? text.replace(/^\s*remember\s*:\s*/i, "remember ") : text;
  const done = await narrated(c, a.id, a.workflow || "main", a.input ? a.input(said) : { msg: { text: said } }, `${a.name} works`);
  if (done.code === 0 && done.result) {
    const r = done.result;
    c.text.textContent = r.text ?? r.words ?? "";
    if (r.notes && r.notes.length) c.route.hidden = false, (c.route.textContent = "From your notes: " + r.notes.join(" · "));
    if (r.embed || r.page) showDrawing(c, r);
    store.put({ id: Date.now() + "-" + a.id, at: Date.now(), q: text, agent: a.name, text: c.text.textContent, drawing: r.embed || r.page ? { kind: r.kind, title: r.title, why: r.why, embed: r.embed, page: r.page } : null });
  } else needsModelNote(c, done);
  c.done();
  return c.text.textContent || c.body.innerText.split("\n")[0];
}

// ---------------------------------------------------------------- Saved

async function showSaved() {
  const list = $("#saved-list");
  list.innerHTML = "";
  const items = await store.all();
  if (!items.length) list.append(el("p", { class: "soft", text: "Nothing saved yet. Ask Kosi something." }));
  for (const it of items) {
    const b = el("button", { class: "saved", type: "button" },
      el("small", { text: new Date(it.at).toLocaleString() + " · " + it.agent }),
      el("b", { text: it.q }), el("br"), el("span", { text: (it.text || (it.drawing && (it.drawing.title || it.drawing.kind)) || "").slice(0, 140) }));
    b.addEventListener("click", () => {
      const c = card(el("div"), it.agent);
      c.text.textContent = it.text;
      if (it.drawing) showDrawing(c, it.drawing);
      b.replaceWith(c.root);
    });
    list.append(b);
  }
}

// ---------------------------------------------------------------- Settings

async function showSettings() {
  for (const r of document.querySelectorAll("#mode input")) r.checked = r.value === settings.mode;
  $("#groq-key").value = settings.groqKey;
  $("#groq-model").value = settings.groqModel;
  $("#or-key").value = settings.openrouterKey;
  $("#or-model").value = settings.openrouterModel;
  $("#gpu-note").textContent = hasWebGPU()
    ? "This phone can run a model on its own GPU. Download one while you have Wi-Fi; after that it answers with no network at all."
    : "This browser has no WebGPU, so a model cannot run on it. On iPhone that needs iOS 26 or newer. Drawings made by code still work offline.";
  const box = $("#local-models");
  box.innerHTML = "";
  for (const m of LOCAL_MODELS) {
    const status = el("span", { class: "soft small", text: "Checking…" });
    const bar = el("div", { class: "bar2" }, el("i"));
    const use = el("button", { class: "ghost small", type: "button", text: "Download and use" });
    const del = el("button", { class: "ghost small danger", type: "button", text: "Delete", hidden: "" });
    const row = el("div", { class: "model" }, el("b", { text: m.name }), el("span", { class: "soft small", text: `${m.download}. ${m.note}` }), bar, status, el("div", {}, use, del));
    box.append(row);
    localDownloaded(m.id).then((have) => {
      const using = settings.localModel === m.id;
      status.textContent = have ? (using ? "On this phone, in use." : "On this phone.") : "Not downloaded.";
      use.textContent = have ? (using ? "In use" : "Use this one") : "Download and use";
      use.disabled = !hasWebGPU() || (have && using);
      del.hidden = !have;
      if (have) bar.firstChild.style.width = "100%";
    });
    use.addEventListener("click", async () => {
      use.disabled = true;
      status.textContent = "Starting… keep this screen open.";
      try {
        await loadLocal(m.id, (p) => {
          bar.firstChild.style.width = Math.round((p.progress || 0) * 100) + "%";
          status.textContent = p.text || "Loading…";
        });
        status.textContent = "On this phone, in use.";
        bar.firstChild.style.width = "100%";
        del.hidden = false;
        use.textContent = "In use";
      } catch (e) {
        status.textContent = "Could not load it: " + (e.message || e);
        use.disabled = false;
      }
      showStatus();
      checkReady();
    });
    del.addEventListener("click", async () => {
      await forgetLocal(m.id);
      showSettings();
      showStatus();
    });
  }
  checkReady();
  $("#build").textContent = "Build " + (self.KOSIKA_BUILD || "dev");
}

for (const r of document.querySelectorAll("#mode input")) r.addEventListener("change", () => { settings.mode = r.value; showStatus(); });
const bind = (sel, key) => $(sel).addEventListener("change", (e) => { settings[key] = e.target.value; showStatus(); });
bind("#groq-key", "groqKey");
bind("#groq-model", "groqModel");
bind("#or-key", "openrouterKey");
bind("#or-model", "openrouterModel");

async function checkReady() {
  const ul = $("#ready");
  ul.innerHTML = "";
  const line = (ok, words) => ul.append(el("li", { class: ok === null ? "" : ok ? "yes" : "no", text: words }));
  const sw = "serviceWorker" in navigator && (await navigator.serviceWorker.getRegistration());
  const cached = await caches.keys().then((k) => k.some((n) => n.startsWith("kosika-app"))).catch(() => false);
  line(!!(sw && cached), sw && cached ? "The app and the engine are saved on this phone" : "The app is not saved for offline yet (open it once online)");
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  line(!!installed, installed ? "Opened from the Home Screen" : "Not on the Home Screen yet (Share → Add to Home Screen)");
  const local = settings.localModel && (await localDownloaded(settings.localModel));
  line(!!local, local ? "A model is on this phone, so Kosi can think offline" : "No model on this phone: offline, only drawings made by code work");
  line(!!(settings.groqKey || settings.openrouterKey), settings.groqKey || settings.openrouterKey ? "A free online key is set" : "No online key yet");
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  line(persisted, persisted ? "Storage is kept safe" : "Storage may be cleared by the phone when space is low");
  if (navigator.storage && navigator.storage.estimate) {
    const { usage } = await navigator.storage.estimate();
    line(null, `Kosika uses ${(usage / 1e6).toFixed(0)} MB on this phone`);
  }
}

$("#persist").addEventListener("click", async () => {
  if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  checkReady();
});
$("#forget").addEventListener("click", async () => {
  if (!confirm("Forget everything the agents have noted? This cannot be undone.")) return;
  await forgetMemories();
  alert("The agents' notes are gone.");
});
$("#clear-saved").addEventListener("click", async () => {
  if (!confirm("Delete all saved answers and drawings?")) return;
  await store.clear();
  showSaved();
});

// ---------------------------------------------------------------- the look, from Kosika Designs

function currentPalette() {
  return document.documentElement.dataset.palette || "dark_matter";
}

function setPalette(name, swatches) {
  document.documentElement.dataset.palette = name;
  try { localStorage.setItem("kosika.palette", name); } catch (e) {}
  const s = swatches?.find((x) => x.name === name);
  if (s) document.querySelector('meta[name="theme-color"]').content = s.bg;
  for (const b of document.querySelectorAll(".swatch")) b.classList.toggle("on", b.dataset.name === name);
}

let look = null;
async function dress() {
  try {
    look = await (await fetch("look.json")).json();
  } catch (e) {
    return;
  }
  $("#sky").innerHTML = look.sky;
  $("#art-orb") && ($("#art-orb").innerHTML = look.orb);
  $("#art-bloom").innerHTML = look.bloom;
  $("#art-waves").innerHTML = look.waves;
  $("#art-tree").innerHTML = look.tree;
  $("#talk-art").innerHTML = look.orb;
  // The small pictures are shown whole, not cropped.
  for (const id of ["#art-bloom", "#art-waves", "#art-tree"]) $(id + " svg")?.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const box = $("#palettes");
  for (const p of look.swatches) {
    const b = el("button", { class: "swatch", type: "button", "data-name": p.name, title: p.mood, onclick: () => setPalette(p.name, look.swatches) },
      el("i", {}, ...[p.bg, p.think, p.gold, p.accent].map((c) => { const x = el("b"); x.style.background = c; return x; })),
      el("span", { text: p.label }));
    box.append(b);
  }
  setPalette(currentPalette(), look.swatches);
}

// ---------------------------------------------------------------- talking with Kosi

const talk = {
  box: $("#talk"),
  on: false,
  set(state, words = "") {
    this.box.dataset.state = state;
    $("#talk-state").textContent = { idle: "Kosi", listening: "Listening…", thinking: "Thinking…", speaking: "Kosi" }[state] || state;
    $("#talk-go").hidden = state !== "idle";
    if (words) $("#talk-said").textContent = words;
  },
};

function openTalk() {
  show("kosi");
  talk.on = true;
  talk.box.hidden = false;
  $("#talk-heard").textContent = "";
  $("#talk-said").textContent = canListen ? "" : "This browser cannot listen here. Close this, tap the text box and use the keyboard's microphone; Kosi still answers out loud.";
  talk.set("idle");
}

function closeTalk() {
  talk.on = false;
  talk.box.hidden = true;
  stopListening();
  stopSpeaking();
}

function talkTurn() {
  if (!talk.on) return;
  if (!canListen) return talk.set("idle");
  talk.set("listening");
  $("#talk-heard").textContent = "";
  listen({
    onHeard: (t) => { $("#talk-heard").textContent = t; },
    onError: (err) => {
      talk.set("idle", err === "not-allowed" || err === "service-not-allowed"
        ? "Kosika may not use the microphone. Allow it in Settings → Safari → Microphone, or use the keyboard's microphone."
        : err === "no-speech" ? "I didn't hear anything. Tap to talk." : "Listening stopped (" + err + "). Tap to talk.");
    },
    onEnd: async (heard) => {
      if (!talk.on || !heard) { if (talk.on && talk.box.dataset.state === "listening") talk.set("idle"); return; }
      talk.set("thinking", "");
      busy = true;
      let said = "";
      try { said = await askKosi(heard); } finally { busy = false; }
      if (!talk.on) return;
      talk.set("speaking", said);
      if (voiceSettings.speak && canSpeak) speak(said, { onEnd: () => talk.on && talkTurn() });
      else talk.set("idle");
    },
  });
}

$("#mic").addEventListener("click", () => {
  if (!$("#view-agents").hidden && currentAgent) {
    // In an agent's chat the mic fills the box, and the answer is read out.
    if (!canListen) { askText.focus(); return; }
    $("#mic").classList.add("on");
    listen({
      onHeard: (t) => { askText.value = t; },
      onError: () => $("#mic").classList.remove("on"),
      onEnd: (heard) => { $("#mic").classList.remove("on"); if (heard) { spokenNext = true; askForm.requestSubmit(); } },
    });
    return;
  }
  openTalk();
  talkTurn();
});
$("#talk-go").addEventListener("click", () => {
  stopSpeaking();
  talkTurn();
});
$("#talk-close").addEventListener("click", closeTalk);
$("#talk-art").addEventListener("click", () => {
  if (talk.box.dataset.state === "speaking") { stopSpeaking(); talkTurn(); }
});

// Voice settings.
function fillVoices() {
  const pick = $("#voice-pick");
  const list = voices();
  pick.innerHTML = "";
  pick.append(el("option", { value: "", text: "The best one on this phone" }));
  for (const v of list) pick.append(el("option", { value: v.name, text: `${v.name} (${v.lang})` }));
  pick.value = voiceSettings.voice;
}
if (canSpeak) speechSynthesis.addEventListener?.("voiceschanged", fillVoices);
$("#speak-answers").addEventListener("change", (e) => { voiceSettings.speak = e.target.checked; });
$("#voice-pick").addEventListener("change", (e) => { voiceSettings.voice = e.target.value; });
$("#voice-test").addEventListener("click", () => speak("Hello Aryan, I'm Kosi. Ask me anything, and I'll draw it when a picture helps."));

// Links for Siri, and for carrying settings from the Home Screen app to Safari.
const here = location.origin + location.pathname;
$("#copy-talk").addEventListener("click", () => copy(here + "?talk=1", "#copy-talk"));
$("#copy-setup").addEventListener("click", () => {
  const setup = { groqKey: settings.groqKey, openrouterKey: settings.openrouterKey, groqModel: settings.groqModel, openrouterModel: settings.openrouterModel, mode: settings.mode, palette: currentPalette() };
  // After the #, so it never reaches any server: it stays on the phone.
  copy(here + "#setup=" + btoa(unescape(encodeURIComponent(JSON.stringify(setup)))), "#copy-setup");
});
async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); $(button).textContent = "Copied"; }
  catch (e) { prompt("Copy this:", text); }
  setTimeout(() => { $(button).textContent = button === "#copy-talk" ? "Copy" : "Copy my setup"; }, 2000);
}

function takeSetup() {
  const m = location.hash.match(/^#setup=(.+)$/);
  if (!m) return false;
  try {
    const s = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    for (const k of ["groqKey", "openrouterKey", "groqModel", "openrouterModel", "mode"]) if (typeof s[k] === "string" && s[k]) settings[k] = s[k];
    if (s.palette) { try { localStorage.setItem("kosika.palette", s.palette); } catch (e) {} document.documentElement.dataset.palette = s.palette; }
  } catch (e) {}
  history.replaceState(null, "", location.pathname);
  return true;
}

// ---------------------------------------------------------------- start

const tookSetup = takeSetup();
dress();
showStatus();
warm();
$("#speak-answers").checked = voiceSettings.speak;
$("#talk-link").textContent = here + "?talk=1";
fillVoices();
if (tookSetup) show("settings");
const params = new URLSearchParams(location.search);
if (params.has("talk") || params.has("q")) {
  history.replaceState(null, "", location.pathname);
  if (params.get("q")) {
    askText.value = params.get("q");
    spokenNext = params.has("talk");
    askForm.requestSubmit();
  } else {
    // A phone listens only after a tap, so Siri's link opens Kosi ready.
    openTalk();
  }
}
if (settings.localModel && hasWebGPU()) {
  // Start the phone's model in the background when it is the one that will answer.
  if (whoAnswers().where === "phone") loadLocal(settings.localModel).catch(() => {});
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
