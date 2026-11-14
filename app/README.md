# Kosika on your phone

**Open it:** <https://blackhole8080-darkmatter.github.io/kosika-site/app/>

Kosi, Kosika Designs and the agents, in one app that works online and offline.
It is the real Kosika engine (the Go engine, built to WebAssembly) running
inside the phone's browser. Nothing runs on a server.

## On iPhone, once

1. Open the link above in **Safari**.
2. Tap **Share**, then **Add to Home Screen**.
3. Open Kosika from the Home Screen. Go to **Settings**:
   - paste your free **Groq** key (and an **OpenRouter** key if you like),
   - while on Wi-Fi, tap **Download and use** on a model under
     *Offline, on this phone* (needs iOS 26 for WebGPU).
4. Settings → *Ready for airplane mode?* should show green ticks.

## Kosi follows along, and remembers you

- Kosi keeps the last few turns, so "and why?", "what about Mars?" or
  "draw it" carry on from what you were talking about. **New conversation**
  starts fresh.
- When you tell Kosi something about yourself ("I have a physics exam on
  12 December"), it keeps a short note, on this phone only. Kosika code,
  not the model, decides what is kept: one short line about you, never a
  password, key or code. Settings → *What Kosi remembers about you* lists
  every note, and ✕ forgets one.

## Designs you change, like and use

Ask Kosi for a phone app, a website or an agent's window and Designs
designs it: live with your key (a new look each time), or laid out by
Kosika offline. Then:

- **Change it** by saying or typing "make it light", "add pricing",
  "waves" or "rewrite the headline". Short changes are made by Kosika with
  no model (so they work offline); rewrites go to the model.
- **♡ I like this** keeps the look on the phone; new designs lean toward
  the looks you liked.
- **Open as app** makes it a working app (tabs switch, lists take items,
  what you add is kept), served from this phone, so it works offline.

(Needs kosika PR #8 on `studio`.)

## Talk to Kosi, and "Hey Siri, Kosi"

- Tap the microphone: Kosi listens, answers out loud with the phone's own
  voice (works offline), draws when a picture helps, then listens again.
- Siri: in the Shortcuts app make a Shortcut named **Kosi** with one action,
  **Open URLs** → `https://blackhole8080-darkmatter.github.io/kosika-site/app/?talk=1`.
  Say "Hey Siri, Kosi". The link opens in Safari, which keeps its own
  settings: in the app, Settings → **Copy my setup**, and open that link in
  Safari once.
- `?q=your question&talk=1` asks straight away and reads the answer.
- Settings has the steps for a second Shortcut that answers with Apple's
  on-device model, without opening anything (Apple Intelligence phones).

## Designed by Kosika Designs

`kosi/look.kos` makes the app's look at build time: the colours are
Designs' palettes (contrast-checked by Designs), and the orb, the sky and
the pictures on each page are Designs' generative art, drawn by code.
The icons (tabs, microphone, send, each agent) and the spacing and type
scales come from Designs' **ui kind**, the same design system Designs uses
for the websites and phone screens it makes. Ask Kosi to "design a phone
app for …" and Designs lays it out; offline, Kosika lays out a starter
screen with no model (this needs kosika PR #7 on `studio`). All of it
uses palette variables, so picking a palette in Settings repaints the app,
and every drawing Designs makes for you is drawn in the same palette.

## What works where

| | Online (your free key) | Offline, model on the phone | Offline, no model |
| --- | --- | --- | --- |
| Kosi answers in words | yes | yes, smaller model | no |
| Designs: diagrams, canvas, moving pictures, quizzes | yes | yes, simpler | no |
| Designs: chemistry, units, periodic table | yes | yes | **yes** (Kosika works them out) |
| Designs: art | yes | yes | **yes** (chosen from your words) |
| Designs: screens (phone apps, websites, agent windows) | yes | yes | **yes** (a starter laid out from your words) |
| Notebook, Router agents | yes | yes | **yes** |
| Study, Explainer, Coach agents | yes | yes | no |
| Saved answers and drawings | yes | yes | **yes** |

## How it fits together

    question
      → kosi.kos `route`   (plain Kosika code: who takes it, does a picture help)
      → Kosi `answer`, an agent's `main`, or Designs `design`
      → every model call goes to https://kosika.model/v1, which never leaves
        the phone: models.js hands it to Groq, OpenRouter or the phone's model

- `kosi/kosi.kos` — Kosi's door, in Kosika. `kosika test kosi/kosi.kos`.
- `engine-worker.js` — runs `kosika-native run …` in a worker, with a
  filesystem in memory; agents' `--memory` folders are kept in IndexedDB.
- `models.js` — who answers a model call. Keys stay in the phone's storage.
- `kosika.js`, `app.js`, `index.html`, `app.css` — the app.
- `voice.js` — listening and speaking.
- `kosi/look.kos` — the app's look, by Kosika Designs.
- `sw.js` — saves the app and engine on the phone so it opens offline.
- `build.sh` — builds `engine/` and `programs.json`; the Pages workflow runs
  it on every push, from kosika's `studio` branch and kosika-designs.

Build and try it on a laptop:

    KOSIKA=../kosika DESIGNS=../kosika-designs app/build.sh
    python -m http.server 8765      # then open http://localhost:8765/app/
