/* kosi-cell.js — Kosi, Kosika's assistant, drawn as a living white-line cell.
   Made in Kosika Designs (thread "Design Kosi's holographic voice orb", 2026-11-18). No libraries, Canvas 2D.

   const kosi = KosiCell.create(canvas, { ink, accent, ground, floor, cy, size });
     ink/accent: line colours (default warm white + amber); ground: background colour, or null for transparent;
     floor: draw the perspective grid (default true); cy: centre height (0..1); size: radius as a share of the short side.
   kosi.setState("idle" | "listening" | "thinking" | "speaking")   // or 0..3
   kosi.setVoice(level 0..1, bands[16])                             // drives listening waves and the speaking shape
   kosi.setForm("cell" | "geodesic" | "revolved")
   kosi.setShape("sphere" | "amoeba" | "virus" | "torus" | "cube" | "twist" | "seed")
   kosi.spin(dx, dy); kosi.draw(timeSeconds, dtSeconds)              // call draw once per animation frame
   KosiCell.topicShape(text) -> a shape name that suits the text, or null.
*/
(function (root) {
  /* KosiLines v3 — Kosi as a living cell, drawn the way Kosika draws maths: white lines in 3D, depth-faded, amber for what moves.
     Forms: "cell" (Goldberg membrane of hexagon cells, dual of a geodesic sphere), "geodesic" (subdivided icosahedron),
     "revolved" (meridians and parallels of a revolved circle). A geodesic nucleus floats inside every form.
     API: setState(name|0-3), setForm(name), setVoice(level, bands[16]), spin(dx, dy), draw(t, dt). */
  function KosiLines(canvas, opts) {
    opts = opts || {};
    const INK = opts.ink || "#f1eee6", GOLD = opts.accent || "#f5b13d", GROUND = opts.ground === undefined ? "#07080c" : opts.ground;
    const FLOOR = opts.floor !== false, CY = opts.cy || .45, SIZE = opts.size || .2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const TAU = Math.PI*2;
    const names = ["idle", "listening", "thinking", "speaking"];
    const tgt = [1,0,0,0], w = [1,0,0,0];
    let form = "cell", formFade = 1, nextForm = null;
    let level = 0, shown = 0; const bands = new Float32Array(16), shownB = new Float32Array(16);
    let yaw = .4, pitch = .36, vy = 0, vp = 0, W = 0, H = 0, dpr = 1, view;
    const ease = x => x*x*(3 - 2*x);
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
    const lerp3 = (a, b, k) => [a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k, a[2] + (b[2]-a[2])*k];
    const hash = n => { const x = Math.sin(n*127.1)*43758.5453; return x - Math.floor(x); };

    // ---- geodesic sphere: icosahedron, each face cut into n² triangles, pushed onto the sphere ----
    function icosphere(n) {
      const p = (1 + Math.sqrt(5))/2;
      const V0 = [[-1,p,0],[1,p,0],[-1,-p,0],[1,-p,0],[0,-1,p],[0,1,p],[0,-1,-p],[0,1,-p],[p,0,-1],[p,0,1],[-p,0,-1],[-p,0,1]].map(norm);
      const F0 = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
      const verts = [], index = new Map(), faces = [];
      const key = v => v.map(x => Math.round(x*1e5)).join(",");
      const add = v => { v = norm(v); const k = key(v); if (!index.has(k)) { index.set(k, verts.length); verts.push(v); } return index.get(k); };
      for (const [a, b, c] of F0) {
        const A = V0[a], B = V0[b], C = V0[c], id = [];
        for (let i = 0; i <= n; i++) { id[i] = []; for (let j = 0; j <= n - i; j++) {
          const k = n - i - j; id[i][j] = add([(A[0]*k + B[0]*i + C[0]*j)/n, (A[1]*k + B[1]*i + C[1]*j)/n, (A[2]*k + B[2]*i + C[2]*j)/n]); } }
        for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
          faces.push([id[i][j], id[i+1][j], id[i][j+1]]);
          if (j < n - i - 1) faces.push([id[i+1][j], id[i+1][j+1], id[i][j+1]]);
        }
      }
      const edges = new Map();
      faces.forEach(f => { for (let e = 0; e < 3; e++) { const a = f[e], b = f[(e+1)%3]; edges.set(a < b ? a+"_"+b : b+"_"+a, [Math.min(a,b), Math.max(a,b)]); } });
      return { verts, faces, edges: [...edges.values()] };
    }
    // ---- cell membrane: the dual of a geodesic sphere (a Goldberg polyhedron: 12 pentagons, the rest hexagons) ----
    function goldberg(n) {
      const g = icosphere(n);
      const cent = g.faces.map(f => norm([0,1,2].map(i => g.verts[f[0]][i] + g.verts[f[1]][i] + g.verts[f[2]][i])));
      const around = g.verts.map(() => []);
      g.faces.forEach((f, fi) => f.forEach(v => around[v].push(fi)));
      const cells = g.verts.map((c, vi) => {
        const ref = Math.abs(c[1]) < .9 ? [0,1,0] : [1,0,0];
        const e1 = norm([ref[1]*c[2]-ref[2]*c[1], ref[2]*c[0]-ref[0]*c[2], ref[0]*c[1]-ref[1]*c[0]]);
        const e2 = [c[1]*e1[2]-c[2]*e1[1], c[2]*e1[0]-c[0]*e1[2], c[0]*e1[1]-c[1]*e1[0]];
        const ring = around[vi].map(fi => cent[fi]).sort((a, b) =>
          Math.atan2(a[0]*e2[0]+a[1]*e2[1]+a[2]*e2[2], a[0]*e1[0]+a[1]*e1[1]+a[2]*e1[2]) -
          Math.atan2(b[0]*e2[0]+b[1]*e2[1]+b[2]*e2[2], b[0]*e1[0]+b[1]*e1[1]+b[2]*e1[2]));
        return { c, ring, seed: hash(vi + 1) };
      });
      return cells;
    }
    const CELLS = goldberg(4);          // 162 cells
    const GEO = icosphere(5);           // 250 vertices, 750 edges
    const NUC = icosphere(2);           // the nucleus
    const NU = 28, NV = 14;

    function bandAt(x) { x = ((x % 1) + 1) % 1; const f = x*16 - .5, i = Math.floor(f), k = f - i;
      const a = shownB[(i + 16) % 16], b = shownB[(i + 1) % 16]; return a + (b - a)*ease(k); }
    // radius of the membrane in direction d (unit vector)
    function radius(d, t) {
      const V = Math.acos(Math.max(-1, Math.min(1, d[1]))), sv = Math.sin(V);
      const U = Math.atan2(d[2], d[0])/TAU + .5;
      let r = 1 + .018*Math.sin(t*1.2)*(w[0] + w[1]);
      r += w[1]*(.035 + .11*shown)*Math.sin(9*V + 5.5*t)*sv;
      r += w[3]*(.42*bandAt(U*2 + t*.02)*Math.pow(sv, 1.6) + .05*shown);
      r += w[2]*.015*Math.sin(6*U*TAU + t*3)*sv;
      return r;
    }
    // thinking: the cell divides in two along x (mitosis); `side` keeps each little cell with one daughter
    function divide(p, side, m) {
      if (m < .002) return p;
      return [p[0]*(1 - .38*m) + side*.66*m, p[1]*(1 - .12*m), p[2]*(1 - .12*m)];
    }
    // trefoil tube, kept for the revolved form
    function tref(s) { return [ (Math.sin(s) + 2*Math.sin(2*s))*.3, (Math.cos(s) - 2*Math.cos(2*s))*.3, -Math.sin(3*s)*.3 ]; }
    function tube(s, a) {
      const c = tref(s), c2 = tref(s + .01); let T = norm([c2[0]-c[0], c2[1]-c[1], c2[2]-c[2]]);
      const N = norm([T[1], -T[0], 0]); const B = [T[1]*N[2]-T[2]*N[1], T[2]*N[0]-T[0]*N[2], T[0]*N[1]-T[1]*N[0]];
      const r = .17, ca = Math.cos(a)*r, sa = Math.sin(a)*r;
      return [c[0] + N[0]*ca + B[0]*sa, c[1] + N[1]*ca + B[1]*sa, c[2] + N[2]*ca + B[2]*sa];
    }
    function project(p) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x = p[0]*cy - p[2]*sy, z = p[0]*sy + p[2]*cy, y = p[1];
      const y2 = y*cp - z*sp, z2 = y*sp + z*cp, s = view.f/(view.D - z2);
      return [view.cx + x*s*view.k, view.cy - y2*s*view.k, z2];
    }
    const BUCKETS = 6, paths = Array.from({ length: BUCKETS }, () => []);
    function addLine(pts) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i-1], b = pts[i];
        const depth = Math.max(0, Math.min(.999, ((a[2] + b[2])*.5 + 1.3)/2.6));
        paths[Math.floor(depth*BUCKETS)].push(a[0], a[1], b[0], b[1]);
      }
    }
    function flush(color, base, gain, width, alpha) {
      ctx.strokeStyle = color; ctx.lineWidth = width*dpr;
      for (let i = 0; i < BUCKETS; i++) {
        const p = paths[i]; if (!p.length) continue;
        ctx.globalAlpha = (base + gain*(i/(BUCKETS - 1))**1.6)*(alpha == null ? 1 : alpha);
        ctx.beginPath(); for (let j = 0; j < p.length; j += 4) { ctx.moveTo(p[j], p[j+1]); ctx.lineTo(p[j+2], p[j+3]); } ctx.stroke();
        p.length = 0;
      }
      ctx.globalAlpha = 1;
    }
    function circle3(fn, n) { const out = []; for (let i = 0; i <= n; i++) out.push(project(fn(i/n))); return out; }
    function strokePts(pts, color, alpha, width) {
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width*dpr; ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); ctx.globalAlpha = 1;
    }
    function dot(p, r, color, a) { ctx.globalAlpha = a == null ? 1 : a; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p[0], p[1], r*dpr, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }

    // a point on the membrane, from a direction, with all state effects
    // ---- body shapes: every shape maps a direction on the sphere to a point, so the same cells live on any body ----
    const SPIKES = icosphere(1).verts.filter((v, i) => i < 12);
    const SHAPES = {
      sphere: d => d,
      amoeba: (d, t) => { const n = Math.sin(2.1*d[0] + t*.7)*Math.sin(1.7*d[1] - t*.5) + .6*Math.sin(2.6*d[2] + 1.3*d[0] + t*.6) + .4*Math.sin(3.3*d[1] + 2.2*d[2] - t*.9);
        const r = 1 + .2*n; return [d[0]*r*1.05, d[1]*r*.92, d[2]*r]; },
      cube: d => { const p = 7, q = Math.pow(Math.pow(Math.abs(d[0]), p) + Math.pow(Math.abs(d[1]), p) + Math.pow(Math.abs(d[2]), p), 1/p); const s = .86/q; return [d[0]*s, d[1]*s, d[2]*s]; },
      torus: d => { const U = Math.atan2(d[2], d[0]), V = Math.acos(Math.max(-1, Math.min(1, d[1])))*2, a = 1 + .5*Math.cos(V);
        const x = a*Math.cos(U)*.78, y = .5*Math.sin(V)*.78, z = a*Math.sin(U)*.78, c = Math.cos(.6), sn = Math.sin(.6);
        return [x, y*c - z*sn, y*sn + z*c]; },
      virus: d => { let m = 0; for (const c of SPIKES) m = Math.max(m, d[0]*c[0] + d[1]*c[1] + d[2]*c[2]); const r = .85 + .5*Math.pow(Math.max(0, m), 22); return [d[0]*r, d[1]*r, d[2]*r]; },
      twist: d => { const y = d[1]*1.35, a = y*1.6, x = d[0]*.72, z = d[2]*.72, c = Math.cos(a), s = Math.sin(a), q = Math.max(.35, 1 - .25*d[1]*d[1]);
        return [(x*c - z*s)*q*1.25, y, (x*s + z*c)*q*.8]; },
      seed: d => { const V = Math.acos(Math.max(-1, Math.min(1, d[1]))), U = Math.atan2(d[2], d[0]), sv = Math.pow(Math.sin(V), 1.35);
        return [sv*Math.cos(U)*.82, Math.cos(V)*1.28, sv*Math.sin(U)*.82]; }
    };
    let shapeA = "sphere", shapeB = "sphere", shapeK = 1;
    function shaped(d, t) {
      if (shapeK >= 1) return SHAPES[shapeB](d, t);
      const k = ease(shapeK); return lerp3(SHAPES[shapeA](d, t), SHAPES[shapeB](d, t), k);
    }
    function onMembrane(d, side, t, scale) {
      const r = radius(d, t)*(scale || 1), q = shaped(d, t);
      return divide([q[0]*r, q[1]*r, q[2]*r], side, ease(Math.min(1, w[2]*1.1)));
    }
    function arc(a, b, steps) { const out = []; for (let i = 0; i <= steps; i++) out.push(norm(lerp3(a, b, i/steps))); return out; }

    function drawCell(t, spinIn) {
      const fire = [];
      for (let ci = 0; ci < CELLS.length; ci++) {
        const cell = CELLS[ci], side = cell.c[0] >= 0 ? 1 : -1;
        // each little cell breathes on its own and sits a little inside its neighbours, so the walls read double
        const breathe = .84 + .05*Math.sin(t*1.7 + cell.seed*20) + .06*w[3]*shown*cell.seed;
        const ring = cell.ring.map(q => norm(lerp3(cell.c, q, breathe)));
        const pts = [];
        for (let e = 0; e < ring.length; e++) {
          const seg = arc(ring[e], ring[(e+1) % ring.length], 4);
          for (let s = e ? 1 : 0; s < seg.length; s++) pts.push(project(onMembrane(seg[s], side, t)));
        }
        addLine(pts);
        const glow = (.5 + .5*Math.sin(t*(2 + 3*w[3]) + cell.seed*40));
        const active = w[0]*.0 + w[1]*.25 + w[2]*.35 + w[3]*(.3 + .6*shown);
        if (cell.seed < active*glow*.55) fire.push([project(onMembrane(cell.c, side, t)), glow]);
      }
      flush(INK, .06, .8, 1);
      return fire;
    }
    function drawGeodesic(t) {
      for (const [a, b] of GEO.edges) {
        const va = GEO.verts[a], vb = GEO.verts[b], side = va[0] + vb[0] >= 0 ? 1 : -1;
        addLine(arc(va, vb, 2).map(d => project(onMembrane(d, side, t))));
      }
      flush(INK, .05, .7, .9);
      const fire = [];
      const active = w[1]*.2 + w[2]*.3 + w[3]*(.25 + .5*shown);
      GEO.verts.forEach((v, i) => { const s = hash(i + 7), g = .5 + .5*Math.sin(t*3 + s*50); if (s < active*g*.5) fire.push([project(onMembrane(v, v[0] >= 0 ? 1 : -1, t)), g]); });
      return fire;
    }
    function drawRevolved(t) {
      const m = ease(Math.min(1, w[2]*1.15));
      const P = (u, v) => {
        const U = u*TAU, V = v*Math.PI, d = [Math.sin(V)*Math.cos(U), Math.cos(V), Math.sin(V)*Math.sin(U)];
        const r = radius(d, t), q = shaped(d, t), S = [q[0]*r, q[1]*r, q[2]*r];
        return m < .002 ? S : lerp3(S, tube(U + t*.25, V*2), m);
      };
      for (let i = 0; i < NU; i++) { const pts = []; for (let j = 0; j <= 64; j++) pts.push(project(P(i/NU, j/64))); addLine(pts); }
      for (let j = 1; j < NV; j++) { const pts = []; for (let i = 0; i <= 120; i++) pts.push(project(P(i/120, j/NV))); addLine(pts); }
      flush(INK, .08, .85, 1);
      if (w[2] > .02) {
        const pts = []; for (let i = 0; i <= 26; i++) pts.push(project(tref(t*1.85 - i*.03)));
        ctx.lineCap = "round"; strokePts(pts, GOLD, w[2], 2.2); ctx.lineCap = "butt"; dot(pts[0], 3.6, GOLD);
      }
      return [];
    }
    // the nucleus: a small geodesic sphere that turns the other way; it splits too when the cell divides
    function drawNucleus(t) {
      const m = ease(Math.min(1, w[2]*1.1));
      const R = .34 + .03*Math.sin(t*1.7) + .08*w[3]*shown + .04*w[1]*shown;
      const a = -t*.35, ca = Math.cos(a), sa = Math.sin(a);
      const halves = m > .05 ? [-1, 1] : [0];
      for (const h of halves) {
        for (const [i, j] of NUC.edges) {
          const pa = NUC.verts[i], pb = NUC.verts[j];
          const seg = arc(pa, pb, 2).map(d => {
            const x = d[0]*ca - d[2]*sa, z = d[0]*sa + d[2]*ca;
            const s = h ? R*(1 - .3*m) : R;
            return [x*s + h*.66*m, d[1]*s, z*s];
          });
          addLine(seg.map(project));
        }
      }
      flush(GOLD, .08, .5 + .3*w[3]*shown, .8, .9);
    }

    function draw(t, dt) {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.floor(canvas.clientWidth*dpr), ch = Math.floor(canvas.clientHeight*dpr);
      if (cw !== W || ch !== H) { W = canvas.width = cw; H = canvas.height = ch; }
      const k = 1 - Math.exp(-dt*3.2); for (let i = 0; i < 4; i++) w[i] += (tgt[i] - w[i])*k;
      shown += (level - shown)*(1 - Math.exp(-dt*8));
      for (let i = 0; i < 16; i++) shownB[i] += (bands[i] - shownB[i])*(1 - Math.exp(-dt*9));
      yaw += vy*dt + dt*(.12 + .3*w[2]); pitch += vp*dt; pitch = Math.max(-.2, Math.min(1.1, pitch));
      vy *= Math.exp(-dt*2); vp *= Math.exp(-dt*2);
      shapeK = Math.min(1, shapeK + dt*.7);
      if (nextForm) { formFade -= dt*3; if (formFade <= 0) { form = nextForm; nextForm = null; } } else formFade = Math.min(1, formFade + dt*3);
      const m = Math.min(W, H);
      view = { f: 2.4, D: 5, cx: W/2, cy: H*CY, k: 0 }; view.k = m*SIZE/(view.f/view.D);
      if (GROUND) { ctx.fillStyle = GROUND; ctx.fillRect(0, 0, W, H); } else ctx.clearRect(0, 0, W, H);

      const fy = -1.3;
      if (FLOOR) {
      for (let i = -8; i <= 8; i++) { addLine([project([i*.2, fy, -1.6]), project([i*.2, fy, 1.6])]); addLine([project([-1.6, fy, i*.2]), project([1.6, fy, i*.2])]); }
      flush(INK, .05, .16, .8);
      }

      ctx.save(); ctx.globalAlpha = 1;
      const fade = Math.max(0, formFade);
      if (form !== "revolved") drawNucleus(t);
      let fire = [];
      ctx.globalAlpha = 1;
      // fade the membrane during a form change by drawing it onto a dimmed layer
      ctx.globalCompositeOperation = "source-over";
      if (form === "cell") fire = withFade(fade, () => drawCell(t));
      else if (form === "geodesic") fire = withFade(fade, () => drawGeodesic(t));
      else fire = withFade(fade, () => drawRevolved(t));
      ctx.restore();
      fire.forEach(([p, g]) => { dot(p, 2 + 2.2*g, GOLD, .25 + .75*g*fade); });

      // amber: orbit at rest, ripples while listening, a voice ring while speaking
      if (w[0] > .02) {
        const tilt = .35, orbit = s => { const a = s*TAU; return [Math.cos(a)*1.38, Math.sin(a)*1.38*Math.sin(tilt)*.4, Math.sin(a)*1.38]; };
        strokePts(circle3(orbit, 160), GOLD, .85*w[0], 1.3); dot(project(orbit(t*.06)), 3.2, GOLD);
      }
      if (w[1] > .02) for (let k2 = 0; k2 < 3; k2++) {
        const ph = (t*.45 + k2/3) % 1, R = 2.0 - ph*.85;
        strokePts(circle3(s => [Math.cos(s*TAU)*R, -.05, Math.sin(s*TAU)*R], 140), GOLD, w[1]*ph*ph*(.6 + .8*shown), 1.2);
      }
      if (w[3] > .02) {
        strokePts(circle3(s => { const R = 1.45 + .42*bandAt(s*2 + t*.02) + .06*shown; return [Math.cos(s*TAU)*R, 0, Math.sin(s*TAU)*R]; }, 220), GOLD, w[3], 1.4);
        for (let k2 = 0; k2 < 2; k2++) { const ph = (t*.7 + k2/2) % 1, R = 1.5 + ph*.9;
          strokePts(circle3(s => [Math.cos(s*TAU)*R, 0, Math.sin(s*TAU)*R], 140), GOLD, w[3]*(1 - ph)*(.2 + .8*shown), 1); }
      }
    }
    function withFade(a, fn) {
      // lines are stroked with globalAlpha set inside flush; scale it by a for the form cross-fade
  let out;
      flushScale = a; out = fn(); flushScale = 1; return out;
    }
    let flushScale = 1;
    const _flush = flush;
    flush = function (color, base, gain, width, alpha) { return _flush(color, base, gain, width, (alpha == null ? 1 : alpha)*flushScale); };

    const counts = { cell: CELLS.length + " cells", geodesic: GEO.verts.length + " nodes", revolved: (NU + NV - 1) + " lines" };
    return {
      names, draw,
      get count() { return counts[nextForm || form]; },
      setShape(n) { if (!SHAPES[n] || n === shapeB) return; shapeA = shapeB; shapeB = n; shapeK = 0; },
      get shape() { return shapeB; },
      shapes: null,
      setForm(f) { if (f !== form || nextForm) { nextForm = f; } },
      get form() { return nextForm || form; },
      setState(s) { const i = typeof s === "number" ? s : names.indexOf(s); for (let j = 0; j < 4; j++) tgt[j] = j === i ? 1 : 0; },
      setVoice(lv, b) { level = Math.max(0, Math.min(1, lv)); if (b) for (let i = 0; i < 16; i++) bands[i] = b[i] || 0; },
      spin(dx, dy) { vy += dx; vp += dy; },
      get level() { return shown; }
    };
  }

  const TOPIC = [[/math|equation|algebra|geometry|topolog|number|proof|calcul/i, "torus"], [/cell|biolog|life|grow|body|organ/i, "amoeba"],
    [/idea|spark|energy|virus|attack|danger|bug|error/i, "virus"], [/code|program|build|compile|kosika|block|struct/i, "cube"],
    [/dna|twist|spiral|helix|time|music|dance/i, "twist"], [/nature|sea|shell|fibonacci|golden|art|beaut|seed|plant/i, "seed"]];
  function topicShape(text) { for (const [re, n] of TOPIC) if (re.test(text || "")) return n; return null; }
  root.KosiCell = { create: KosiLines, topicShape, shapes: ["sphere", "amoeba", "virus", "torus", "cube", "twist", "seed"] };
})(typeof window !== "undefined" ? window : globalThis);
