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

## What works where

| | Online (your free key) | Offline, model on the phone | Offline, no model |
| --- | --- | --- | --- |
| Kosi answers in words | yes | yes, smaller model | no |
| Designs: diagrams, canvas, moving pictures, quizzes | yes | yes, simpler | no |
| Designs: chemistry, units, periodic table | yes | yes | **yes** (Kosika works them out) |
| Designs: art | yes | yes | **yes** (chosen from your words) |
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
- `sw.js` — saves the app and engine on the phone so it opens offline.
- `build.sh` — builds `engine/` and `programs.json`; the Pages workflow runs
  it on every push, from kosika's `studio` branch and kosika-designs.

Build and try it on a laptop:

    KOSIKA=../kosika DESIGNS=../kosika-designs app/build.sh
    python -m http.server 8765      # then open http://localhost:8765/app/
