// The Kosika engine, in a worker, so the page never freezes while it runs.
//
// The engine is the real Go engine (kosika-native), built to WebAssembly.
// It thinks it is on a small computer: this file gives it a filesystem in
// memory (notes and memories are kept in IndexedDB between visits), a
// command line, and a way to reach models. Every model call it makes goes to
// https://kosika.model/v1, which never leaves the phone: the call is handed
// to the page, and the page decides who answers (Groq, OpenRouter, or the
// model on the phone).

"use strict";

// ---------------------------------------------------------------- filesystem

const enc = new TextEncoder();
const dec = new TextDecoder();
const nodes = new Map(); // path -> {dir: bool, data: Uint8Array, mtime}
const fds = new Map(); // fd -> {path, pos, append}
let nextFd = 10;
let out = { stdout: "", stderr: "" };

function fail(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

function norm(p) {
  if (!p.startsWith("/")) p = "/" + p;
  const parts = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") parts.pop();
    else parts.push(s);
  }
  return "/" + parts.join("/");
}

function parent(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function mkdirp(p) {
  p = norm(p);
  if (p === "/") return;
  if (!nodes.has(p)) {
    mkdirp(parent(p));
    nodes.set(p, { dir: true, mtime: Date.now() });
  }
}

function writeFile(p, text) {
  p = norm(p);
  mkdirp(parent(p));
  nodes.set(p, { dir: false, data: typeof text === "string" ? enc.encode(text) : text, mtime: Date.now() });
}

function readFile(p) {
  const n = nodes.get(norm(p));
  return n && !n.dir ? dec.decode(n.data) : null;
}

nodes.set("/", { dir: true, mtime: Date.now() });

function statOf(p) {
  const n = nodes.get(p);
  if (!n) throw fail("ENOENT");
  const size = n.dir ? 4096 : n.data.length;
  return {
    dev: 1, ino: 1, mode: n.dir ? 0o40755 : 0o100644, nlink: 1, uid: 0, gid: 0, rdev: 0,
    size, blksize: 4096, blocks: Math.ceil(size / 512),
    atimeMs: n.mtime, mtimeMs: n.mtime, ctimeMs: n.mtime,
    isDirectory: () => n.dir,
  };
}

const C = { O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512, O_APPEND: 1024, O_DIRECTORY: 65536 };

function call(cb, fn) {
  let v;
  try {
    v = fn();
  } catch (e) {
    if (!e.code) e.code = "EIO";
    cb(e);
    return;
  }
  cb(null, v);
}

function emit(fd, bytes) {
  const text = dec.decode(bytes);
  if (fd === 1) out.stdout += text;
  else out.stderr += text;
}

globalThis.fs = {
  constants: C,
  writeSync(fd, buf) {
    emit(fd, buf);
    return buf.length;
  },
  write(fd, buf, offset, length, position, cb) {
    call(cb, () => {
      const bytes = buf.subarray(offset, offset + length);
      if (fd === 1 || fd === 2) {
        emit(fd, bytes);
        return length;
      }
      const f = fds.get(fd);
      if (!f) throw fail("EBADF");
      const n = nodes.get(f.path);
      let at = position ?? (f.append ? n.data.length : f.pos);
      const need = at + length;
      if (need > n.data.length) {
        const grown = new Uint8Array(need);
        grown.set(n.data);
        n.data = grown;
      }
      n.data.set(bytes, at);
      n.mtime = Date.now();
      if (position === null || position === undefined) f.pos = at + length;
      return length;
    });
  },
  read(fd, buf, offset, length, position, cb) {
    call(cb, () => {
      if (fd === 0) return 0;
      const f = fds.get(fd);
      if (!f) throw fail("EBADF");
      const n = nodes.get(f.path);
      if (n.dir) throw fail("EISDIR");
      const at = position ?? f.pos;
      const chunk = n.data.subarray(at, Math.min(at + length, n.data.length));
      buf.set(chunk, offset);
      if (position === null || position === undefined) f.pos = at + chunk.length;
      return chunk.length;
    });
  },
  open(path, flags, mode, cb) {
    call(cb, () => {
      const p = norm(path);
      let n = nodes.get(p);
      if (n && flags & C.O_CREAT && flags & C.O_EXCL) throw fail("EEXIST");
      if (!n) {
        if (!(flags & C.O_CREAT)) throw fail("ENOENT");
        const up = nodes.get(parent(p));
        if (!up || !up.dir) throw fail("ENOENT");
        n = { dir: false, data: new Uint8Array(0), mtime: Date.now() };
        nodes.set(p, n);
      }
      if (n.dir && flags & (C.O_WRONLY | C.O_RDWR)) throw fail("EISDIR");
      if (!n.dir && flags & C.O_DIRECTORY) throw fail("ENOTDIR");
      if (!n.dir && flags & C.O_TRUNC) n.data = new Uint8Array(0);
      const fd = nextFd++;
      fds.set(fd, { path: p, pos: 0, append: !!(flags & C.O_APPEND) });
      return fd;
    });
  },
  close(fd, cb) { call(cb, () => { fds.delete(fd); }); },
  fstat(fd, cb) {
    call(cb, () => {
      if (fd <= 2) return { ...statOf("/"), mode: 0o20666, isDirectory: () => false };
      const f = fds.get(fd);
      if (!f) throw fail("EBADF");
      return statOf(f.path);
    });
  },
  stat(path, cb) { call(cb, () => statOf(norm(path))); },
  lstat(path, cb) { call(cb, () => statOf(norm(path))); },
  mkdir(path, perm, cb) {
    call(cb, () => {
      const p = norm(path);
      if (nodes.has(p)) throw fail("EEXIST");
      if (!nodes.has(parent(p))) throw fail("ENOENT");
      nodes.set(p, { dir: true, mtime: Date.now() });
    });
  },
  readdir(path, cb) {
    call(cb, () => {
      const p = norm(path);
      const n = nodes.get(p);
      if (!n) throw fail("ENOENT");
      if (!n.dir) throw fail("ENOTDIR");
      const prefix = p === "/" ? "/" : p + "/";
      const names = [];
      for (const k of nodes.keys()) {
        if (k !== p && k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) names.push(k.slice(prefix.length));
      }
      return names.sort();
    });
  },
  unlink(path, cb) {
    call(cb, () => {
      const p = norm(path);
      const n = nodes.get(p);
      if (!n) throw fail("ENOENT");
      if (n.dir) throw fail("EISDIR");
      nodes.delete(p);
    });
  },
  rmdir(path, cb) {
    call(cb, () => {
      const p = norm(path);
      if (!nodes.has(p)) throw fail("ENOENT");
      for (const k of nodes.keys()) if (k.startsWith(p + "/")) throw fail("ENOTEMPTY");
      nodes.delete(p);
    });
  },
  rename(from, to, cb) {
    call(cb, () => {
      const a = norm(from), b = norm(to);
      if (!nodes.has(a)) throw fail("ENOENT");
      for (const [k, v] of [...nodes]) {
        if (k === a || k.startsWith(a + "/")) {
          nodes.delete(k);
          nodes.set(b + k.slice(a.length), v);
        }
      }
    });
  },
  truncate(path, length, cb) {
    call(cb, () => {
      const n = nodes.get(norm(path));
      if (!n) throw fail("ENOENT");
      n.data = n.data.slice(0, length);
    });
  },
  ftruncate(fd, length, cb) {
    call(cb, () => {
      const f = fds.get(fd);
      if (!f) throw fail("EBADF");
      const n = nodes.get(f.path);
      const grown = new Uint8Array(length);
      grown.set(n.data.subarray(0, Math.min(length, n.data.length)));
      n.data = grown;
    });
  },
  fsync(fd, cb) { cb(null); },
  chmod(path, mode, cb) { cb(null); },
  fchmod(fd, mode, cb) { cb(null); },
  chown(path, uid, gid, cb) { cb(null); },
  fchown(fd, uid, gid, cb) { cb(null); },
  lchown(path, uid, gid, cb) { cb(null); },
  utimes(path, atime, mtime, cb) { cb(null); },
  link(path, link, cb) { cb(fail("ENOSYS")); },
  symlink(path, link, cb) { cb(fail("ENOSYS")); },
  readlink(path, cb) { cb(fail("EINVAL")); },
};

let cwd = "/";
globalThis.process = {
  getuid: () => -1, getgid: () => -1, geteuid: () => -1, getegid: () => -1,
  getgroups: () => [], pid: 1, ppid: 0, umask: () => 0o22,
  cwd: () => cwd,
  chdir: (p) => { cwd = norm(p); },
};
globalThis.path = { resolve: (...parts) => norm(parts.reduce((a, b) => (b.startsWith("/") ? b : a + "/" + b), cwd)) };

importScripts("engine/wasm_exec.js");

// ---------------------------------------------------------------- keeping memories

// What agents remember (their --memory folders) is kept in IndexedDB, so a
// note made on the train is still there tomorrow, with no network.
const KEEP = "/kosika/memory";

function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("kosika-engine", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function loadKept() {
  try {
    const d = await db();
    const all = await new Promise((resolve) => {
      const t = d.transaction("files").objectStore("files").get("memory");
      t.onsuccess = () => resolve(t.result || {});
      t.onerror = () => resolve({});
    });
    for (const [p, data] of Object.entries(all)) writeFile(p, data);
  } catch (e) {
    /* private browsing: memories last for this visit only */
  }
  mkdirp(KEEP);
}

async function saveKept() {
  const all = {};
  for (const [p, n] of nodes) if (!n.dir && p.startsWith(KEEP + "/")) all[p] = n.data;
  try {
    const d = await db();
    await new Promise((resolve) => {
      const t = d.transaction("files", "readwrite");
      t.objectStore("files").put(all, "memory");
      t.oncomplete = resolve;
      t.onerror = resolve;
    });
  } catch (e) {}
}

// ---------------------------------------------------------------- models

const pending = new Map();
let nextAsk = 1;
let currentRun = 0;
const realFetch = globalThis.fetch.bind(globalThis);

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith("https://kosika.model/")) return realFetch(input, init);
  const ask = nextAsk++;
  const body = typeof init.body === "string" ? init.body : dec.decode(await new Response(init.body).arrayBuffer());
  const answer = await new Promise((resolve) => {
    pending.set(ask, resolve);
    postMessage({ type: "model", run: currentRun, ask, body });
  });
  return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
};

// ---------------------------------------------------------------- running

let module = null;
const ready = (async () => {
  const [compiled] = await Promise.all([
    WebAssembly.compileStreaming ? WebAssembly.compileStreaming(realFetch("engine/kosika.wasm")).catch(async () => WebAssembly.compile(await (await realFetch("engine/kosika.wasm")).arrayBuffer())) : WebAssembly.compile(await (await realFetch("engine/kosika.wasm")).arrayBuffer()),
    loadKept(),
  ]);
  module = compiled;
})();

let queue = Promise.resolve();

// One run of `kosika-native run`, exactly as on the laptop.
async function runOnce(job) {
  await ready;
  const dir = "/kosika/programs/" + job.program;
  for (const [name, text] of Object.entries(job.files)) writeFile(dir + "/" + name, text);
  writeFile("/tmp/input.json", JSON.stringify(job.input));
  const argv = ["kosika-native", "run", dir + "/" + job.main, "--workflow", job.workflow, "--input", "/tmp/input.json", "--json",
    "--trace", "/tmp/trace.jsonl"];
  if (job.models !== false) argv.push("--model", "kosika", "--model-url", "https://kosika.model/v1", "--model-timeout", String(job.timeout || 300), "--max-output-tokens", String(job.maxOutput || 8000));
  if (job.memory) argv.push("--memory", KEEP + "/" + job.program);
  out = { stdout: "", stderr: "" };
  const nodesBefore = readFile("/tmp/trace.jsonl");
  if (nodesBefore !== null) nodes.delete("/tmp/trace.jsonl");
  const go = new Go();
  go.argv = argv;
  go.env = { HOME: "/kosika", TMPDIR: "/tmp" };
  let code = 0;
  go.exit = (c) => { code = c; };
  mkdirp("/tmp");
  const started = performance.now();
  const instance = await WebAssembly.instantiate(module, go.importObject);
  await go.run(instance);
  // Timers the program left behind would wake a program that has ended.
  for (const t of go._scheduledTimeouts?.values() || []) clearTimeout(t);
  go._scheduledTimeouts?.clear();
  const ms = Math.round(performance.now() - started);
  let result = null;
  try {
    result = JSON.parse(out.stdout);
  } catch (e) {}
  const trace = (readFile("/tmp/trace.jsonl") || "").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  if (job.memory) await saveKept();
  return { code, result, stdout: out.stdout, stderr: out.stderr.split("\n").filter((l) => !l.startsWith("Model 'kosika' at") && !l.startsWith("Trace:")).join("\n").trim(), trace, ms };
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === "answer") {
    const resolve = pending.get(m.ask);
    pending.delete(m.ask);
    if (resolve) resolve(m);
    return;
  }
  if (m.type === "run") {
    queue = queue.then(async () => {
      currentRun = m.id;
      postMessage({ type: "started", id: m.id });
      let done;
      try {
        done = await runOnce(m.job);
      } catch (err) {
        done = { code: 1, result: null, stdout: "", stderr: String(err && err.stack || err), trace: [], ms: 0 };
      }
      postMessage({ type: "done", id: m.id, done });
    });
    return;
  }
  if (m.type === "warm") {
    ready.then(() => postMessage({ type: "warm" }), (err) => postMessage({ type: "warm", error: String(err) }));
  }
  if (m.type === "forget") {
    for (const k of [...nodes.keys()]) if (k.startsWith(KEEP + "/")) nodes.delete(k);
    saveKept().then(() => postMessage({ type: "forgot" }));
  }
};
