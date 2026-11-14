// Run Kosika programs from the page: each run is the real engine, in the
// worker, and each model call it makes is answered here by models.js.

import { complete } from "./models.js";

const worker = new Worker("engine-worker.js");
const runs = new Map();
let nextId = 1;
let programs = null;
let warmed = null;

worker.onmessage = async (e) => {
  const m = e.data;
  const run = runs.get(m.id ?? m.run);
  if (m.type === "warm") {
    warmed?.resolve(m.error);
    return;
  }
  if (m.type === "started") {
    run?.onEvent({ type: "started" });
    return;
  }
  if (m.type === "model") {
    run?.onEvent({ type: "model", ask: m.ask });
    const t0 = performance.now();
    const onText = run?.stream ? (text) => run.onEvent({ type: "text", ask: m.ask, text }) : null;
    const answer = await complete(m.body, (who) => run?.onEvent({ type: "who", ask: m.ask, who }), onText);
    run?.onEvent({ type: "answered", ask: m.ask, status: answer.status, ms: Math.round(performance.now() - t0) });
    worker.postMessage({ type: "answer", ask: m.ask, status: answer.status, body: answer.body });
    return;
  }
  if (m.type === "done") {
    runs.delete(m.id);
    run?.resolve(m.done);
  }
};

// Start the engine early, so the first question is quick.
export function warm() {
  if (!warmed) {
    let resolve;
    const p = new Promise((r) => (resolve = r));
    warmed = { p, resolve };
    worker.postMessage({ type: "warm" });
  }
  return warmed.p;
}

export async function loadPrograms() {
  if (!programs) programs = await (await fetch("programs.json")).json();
  return programs;
}

// run("kosi", "route", {msg: {text}}) → {code, result, stderr, trace, ms}
export async function run(program, workflow, input, { onEvent = () => {}, memory = false, maxOutput, stream = false } = {}) {
  const all = await loadPrograms();
  const p = all[program];
  if (!p) throw new Error("No such program: " + program);
  const id = nextId++;
  return new Promise((resolve) => {
    runs.set(id, { resolve, onEvent, stream });
    worker.postMessage({ type: "run", id, job: { program, main: p.main, files: p.files, workflow, input, memory: memory || !!p.memory, models: p.models, maxOutput } });
  });
}

export function forgetMemories() {
  return new Promise((resolve) => {
    const once = (e) => {
      if (e.data.type === "forgot") {
        worker.removeEventListener("message", once);
        resolve();
      }
    };
    worker.addEventListener("message", once);
    worker.postMessage({ type: "forget" });
  });
}

// Why a run did not give an answer, in plain words.
export function whyNot(done) {
  const said = (done.stderr || "").trim();
  const m = said.match(/HTTP \d+: (\{.*\})/s);
  if (m) {
    try {
      return JSON.parse(m[1]).error.message;
    } catch (e) {}
  }
  return said.replace(/^Workflow (failed|stopped)[^:]*: /, "") || "The run ended with no answer.";
}
