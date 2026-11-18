// Kosi's face: the living white-line cell from Kosika Designs (kosi-cell.js),
// drawn in the app's own palette. It listens, thinks (the cell divides) and
// speaks, and its body takes a shape that suits what Kosi is saying.
// The phone's voice gives no loudness, so speaking is shaped by a gentle
// syllable rhythm while the phone is talking.

function colours() {
  const css = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
  return { ink: pick("--ink", "#f1eee6"), accent: pick("--gold", "#f5b13d") };
}

const STATES = ["idle", "listening", "thinking", "speaking"];

export function kosiFace(box, { size = 0.26, cy = 0.5, wander = false } = {}) {
  if (!box || !globalThis.KosiCell) return null;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  box.replaceChildren(canvas);
  let kosi = null, made = "", running = false, raf = 0, last = 0, now = 0;
  let state = "idle", pulse = 0, shape = "sphere", wanderAt = 0, wanderI = 0;
  const WANDER = ["sphere", "amoeba", "virus", "torus", "amoeba", "twist", "cube", "seed"];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function make() {
    const c = colours(), key = c.ink + c.accent;
    if (kosi && key === made) return;
    kosi = KosiCell.create(canvas, { ground: null, floor: false, size, cy, ink: c.ink, accent: c.accent });
    kosi.setState(state); kosi.setShape(shape); made = key;
  }
  const wob = (x) => Math.sin(x) * .5 + Math.sin(x * 2.31 + 1.3) * .3 + Math.sin(x * 5.17 + .7) * .2;
  function voice(t) {
    const b = new Array(16).fill(0); let lv = 0;
    if (state === "speaking") {
      const talking = !("speechSynthesis" in globalThis) || speechSynthesis.speaking;
      const syl = Math.max(0, Math.sin(t * 8.5) * .6 + wob(t * 3.1) * .6);
      lv = talking ? Math.min(1, .3 + .8 * syl) : .1;
      for (let i = 0; i < 16; i++) b[i] = lv * Math.max(0, .45 + .55 * wob(t * (4 + i * .6) + i * 1.9));
    } else if (state === "listening") {
      lv = Math.max(0, (.3 + .35 * wob(t * 6.3)) * (.25 + .75 * pulse));
      for (let i = 0; i < 16; i++) b[i] = lv * (.5 + .5 * wob(t * 5 + i));
    } else if (state === "thinking") lv = .08;
    return { lv, b };
  }
  function frame(ms) {
    if (!running || !canvas.isConnected) { running = false; return; }
    const dt = Math.min(.05, (ms - last) / 1000); last = ms;
    now += dt * (reduced ? .35 : 1);
    pulse *= Math.exp(-dt * 2.5);
    if (wander && state === "idle" && now > wanderAt) { wanderAt = now + 6; wanderI = (wanderI + 1) % WANDER.length; face.shape(WANDER[wanderI]); }
    // Nothing is drawn while the face is hidden (another tab, or a conversation over the hello).
    if (canvas.offsetParent !== null) { const v = voice(now); kosi.setVoice(v.lv, v.b); kosi.draw(now, dt); }
    raf = requestAnimationFrame(frame);
  }
  const face = {
    start() { make(); if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    set(s) { state = STATES.includes(s) ? s : "idle"; kosi?.setState(state); },
    heard() { pulse = 1; },
    shape(n) { if (!n) return; shape = n; kosi?.setShape(n); },
    // A shape that suits what Kosi says (maths: torus, code: cube, life: amoeba …).
    topic(text) { const n = KosiCell.topicShape(text); if (n) { face.shape(n); wanderAt = now + 15; } },
    recolour() { made = ""; if (kosi) make(); },
  };
  make();
  return face;
}
