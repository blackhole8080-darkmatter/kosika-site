// Kosi's voice: listening with the phone's speech recognition, speaking with
// the phone's own voices. Speaking needs no network on iPhone. Listening
// uses Apple's recognizer, which works offline for English on most recent
// iPhones; where the browser has no recognizer, the keyboard's microphone
// does the same job.

const LS = {
  get(k, d = "") { try { return localStorage.getItem("kosika." + k) ?? d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("kosika." + k, v); } catch (e) {} },
};

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const canListen = !!Recognition;
export const canSpeak = "speechSynthesis" in globalThis;

export const voiceSettings = {
  get speak() { return LS.get("speak", "yes") === "yes"; },
  set speak(v) { LS.set("speak", v ? "yes" : "no"); },
  get voice() { return LS.get("voice", ""); },
  set voice(v) { LS.set("voice", v); },
};

export function voices() {
  if (!canSpeak) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
}

// The best English voice the phone has: one chosen in Settings, else an
// enhanced or premium one, else the first.
function pickVoice() {
  const all = voices();
  return all.find((v) => v.name === voiceSettings.voice) ||
    all.find((v) => /premium|enhanced|siri/i.test(v.name + v.voiceURI)) ||
    all.find((v) => /samantha|daniel|karen|serena/i.test(v.name)) || all[0] || null;
}

// Speech reads plain sentences: no code, symbols or long lists.
function speakable(text) {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/[*_#`>|]/g, "").replace(/->/g, " gives ").replace(/\s+/g, " ").trim().slice(0, 1200);
}

// Utterances still to be said, in order; speechSynthesis plays them one
// after another.
let queued = [];
function say(text, onEnd) {
  const u = new SpeechSynthesisUtterance(speakable(text));
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-GB";
  u.rate = 1.02;
  u.onend = u.onerror = () => {
    queued = queued.filter((q) => q !== u);
    onEnd();
  };
  queued.push(u);
  speechSynthesis.speak(u);
}

export function speak(text, { onEnd = () => {} } = {}) {
  if (!canSpeak || !text) { onEnd(); return; }
  stopSpeaking();
  say(text, onEnd);
}

// Say more after what is being said now, without cutting it off. With no
// text, onEnd is called once everything already queued has been said.
export function speakMore(text, { onEnd = () => {} } = {}) {
  if (!canSpeak) { onEnd(); return; }
  if (text && speakable(text)) { say(text, onEnd); return; }
  const last = queued[queued.length - 1];
  if (!last) { onEnd(); return; }
  const before = last.onend;
  last.onend = last.onerror = (e) => { before(e); onEnd(); };
}

export function stopSpeaking() {
  queued = [];
  if (canSpeak) speechSynthesis.cancel();
}

// Listen for one thing said. onHeard(text, final) is called as words come.
let listening = null;
export function listen({ onHeard = () => {}, onEnd = () => {}, onError = () => {} } = {}) {
  if (!Recognition) { onError("no-recognizer"); return null; }
  stopListening();
  const r = new Recognition();
  r.lang = navigator.language && navigator.language.startsWith("en") ? navigator.language : "en-GB";
  r.interimResults = true;
  r.continuous = false;
  let heard = "";
  r.onresult = (e) => {
    heard = Array.from(e.results).map((x) => x[0].transcript).join("");
    onHeard(heard, e.results[e.results.length - 1].isFinal);
  };
  r.onerror = (e) => onError(e.error || "error");
  r.onend = () => { if (listening === r) listening = null; onEnd(heard.trim()); };
  listening = r;
  try { r.start(); } catch (e) { onError(String(e)); }
  return r;
}

export function stopListening() {
  if (listening) { try { listening.stop(); } catch (e) {} }
  listening = null;
}
