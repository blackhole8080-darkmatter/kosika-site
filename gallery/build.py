"""Writes gallery/index.html from the list below.

Every picture and clip here was drawn by Kosika: the maths drawings by
std/designs_plot.kos, Kosi by kosi-cell.js from Kosika Designs, the Brain by
the Brain thread. To add one, drop the file in gallery/media/ (clips as .mp4
with a .jpg poster of the same name, stills as .webp) and add a line below.

    python3 gallery/build.py
"""
import html
import pathlib

HERE = pathlib.Path(__file__).parent

# (file stem, title, one line)  — a stem with an .mp4 is a clip, else a .webp still
SECTIONS = [
    ("kosi", "Kosi, alive", "Kosika's assistant is a living cell: 162 cells on a geodesic body, a nucleus inside, amber where a cell fires. It changes shape with what it is talking about.", [
        ("kosi-shapes", "Seven bodies, one cell", "sphere, amoeba, virus, torus, cube, twist, seed"),
        ("k-sphere", "Sphere", "Kosi at rest"),
        ("k-torus", "Torus", "Kosi talking maths"),
        ("k-cube", "Cube", "Kosi talking code"),
        ("k-amoeba", "Amoeba", "Kosi talking about life"),
        ("k-virus", "Spiked", "an idea, or a bug"),
        ("k-twist", "Twist", "time and helices"),
        ("k-seed", "Seed", "nature and art"),
    ]),
    ("shapes", "Shapes in 3D", "Parametric bodies, implicit surfaces found by marching tetrahedra, knots as tubes and Platonic solids with their own light. Written in Kosika, drawn as white lines.", [
        ("s-gyroid", "Gyroid", "sin x cos y + sin y cos z + sin z cos x = 0"),
        ("s-klein-bottle", "Klein bottle", "a surface with no inside"),
        ("s-trefoil", "Trefoil knot", "the simplest true knot, as a tube"),
        ("s-torus", "Torus", "a circle swept round a circle"),
        ("s-dodecahedron", "Dodecahedron", "Platonic solid, back faces culled"),
        ("s-wave", "Wave", "a surface that moves"),
        ("s-schwarz-p", "Schwarz P", "cos x + cos y + cos z = 0"),
        ("s-seashell", "Seashell", "a spiral that grows as it turns"),
        ("s-mobius", "Möbius strip", "one side, one edge"),
        ("s-enneper", "Enneper surface", "a minimal surface"),
        ("s-dini", "Dini's surface", "a twisted pseudosphere"),
        ("s-catenoid", "Catenoid", "a soap film between two rings"),
        ("s-figure-eight-knot", "Figure-eight knot", "four crossings"),
        ("s-melting-spheres", "Melting spheres", "implicit spheres blending"),
        ("s-icosahedron", "Icosahedron", "twenty faces"),
        ("s-revolve-sin", "Revolved sine", "y = sin x turned round its axis"),
    ]),
    ("motion", "Maths in motion", "Drawings that move the way the idea moves: tangents slide, strips fill an integral, a Taylor series grows term by term.", [
        ("m-taylor-growing", "Taylor series, growing", "one more term each beat"),
        ("m-integral-strips", "Integral as strips", "the area fills in"),
        ("m-graph-tangent", "Tangent", "the slope rides the curve"),
        ("m-vector-field-stream", "Vector field", "particles follow the arrows"),
        ("m-slope-field-stream", "Slope field", "solutions flow through it"),
        ("m-parametric-trace", "Parametric curve", "traced by a moving point"),
        ("m-polar-radius", "Polar curve", "drawn by its radius"),
        ("m-twin-paradox-birthdays", "Twin paradox", "birthdays on two world lines"),
    ]),
    ("astro", "Astrophysics", "The newest drawings: a black hole, light bending round mass, a spiral galaxy and orbits, from the same white-line library.", [
        ("a-black-hole", "Black hole", "the disc and its shadow"),
        ("a-light-bending", "Light bending", "rays curve round a mass"),
        ("a-galaxy", "Galaxy", "a spiral of stars"),
        ("a-orbits", "Orbits", "ellipses round one focus"),
        ("a-sagittarius-a", "Sagittarius A*", "the black hole at our galaxy's centre"),
        ("a-orbits-comet", "A comet's orbit", "fast near the Sun, slow far away"),
    ]),
    ("plots", "Maths, still", "Complex functions, polar roses, phase portraits and space-time, each a few lines of Kosika.", [
        ("p-complex-modulus-3d", "|f(z)| in 3D", "a complex function as a landscape"),
        ("p-complex-exp", "e^z", "the complex plane, bent"),
        ("p-complex-z-squared", "z²", "angles doubled"),
        ("p-polar-rose", "Polar rose", "r = cos kθ"),
        ("p-polar-cardioid", "Cardioid", "r = 1 + cos θ"),
        ("p-parametric-lissajous", "Lissajous", "two sines, two speeds"),
        ("p-pendulum-phase-portrait", "Pendulum", "its phase portrait"),
        ("p-surface-ripple", "Ripple", "a surface in 3D"),
        ("p-spacetime-light-cone", "Light cone", "past, future, elsewhere"),
        ("p-spacetime-curved", "Curved space-time", "mass bends the grid"),
        ("p-twin-paradox", "Twin paradox", "two clocks, two paths"),
        ("p-vector-field-spiral", "Spiral field", "a vector field"),
        ("p-taylor-sin", "Taylor sin x", "polynomials closing in"),
        ("p-integral-x-squared", "∫ x² dx", "the area under a parabola"),
    ]),
]

LIVE = [
    ("brain-3d.html", "b-brain-maths-3d-lit", "Kosika Brain in 3D", "Kosika's one intelligence layer, drawn in white lines: sense, recall, think, check, act, learn. Drag to turn it."),
    ("brain-map.html", None, "Brain Map", "How the Brain's parts connect, as a live map."),
    ("mind-view.html", None, "Mind View", "What the Brain is holding in mind, step by step."),
    ("surface.html", "p-surface-ripple", "A live surface", "z = exp(−(x² + y²)) · cos 2(x² + y²), turning in 3D."),
    ("spacetime.html", "p-spacetime-light-cone", "Space-time, live", "The light cone and world lines you can move."),
]

esc = html.escape
WIDE = {"kosi-shapes"}


def card(stem, title, line):
    media = HERE / "media"
    if (media / f"{stem}.mp4").exists():
        body = (f'<video data-src="media/{stem}.mp4" poster="media/{stem}.jpg" muted loop playsinline '
                f'preload="none" aria-label="{esc(title)}"></video><span class="tag">moving</span>')
    elif (media / f"{stem}.webp").exists():
        body = f'<img src="media/{stem}.webp" alt="{esc(title)}: {esc(line)}" loading="lazy" decoding="async">'
    else:
        raise SystemExit(f"missing media for {stem}")
    wide = " wide" if stem in WIDE else ""
    return (f'<figure class="card rise{wide}" tabindex="0">{body}'
            f'<figcaption><b>{esc(title)}</b><span>{esc(line)}</span></figcaption></figure>')


def live_card(page, poster, title, line):
    pic = (f'<img src="media/{poster}.webp" alt="" loading="lazy">' if poster
           else '<div class="nopic" aria-hidden="true"></div>')
    return (f'<article class="live rise"><div class="stage" data-page="live/{page}">{pic}'
            f'<button class="play" type="button" aria-label="Run {esc(title)} here">▶ Run it live</button></div>'
            f'<div class="meta"><b>{esc(title)}</b><span>{esc(line)}</span>'
            f'<a href="live/{page}" target="_blank" rel="noopener">Open full screen ↗</a></div></article>')


def main():
    nav = "".join(f'<a href="#{sid}">{esc(name)}</a>' for sid, name, _, _ in SECTIONS[1:])
    count = sum(len(items) for *_, items in SECTIONS) + len(LIVE)
    parts = []
    for sid, name, lede, items in SECTIONS:
        if sid == "kosi":
            continue
        parts.append(f'<section id="{sid}"><div class="head rise"><h2>{esc(name)}</h2><p>{esc(lede)}</p></div>'
                     f'<div class="grid">{"".join(card(*i) for i in items)}</div></section>')
        if sid == "shapes":
            parts.append('<section id="live"><div class="head rise"><h2>Live in 3D</h2><p>These are not videos. '
                         'Press run and the page draws them in your browser, frame by frame.</p></div>'
                         f'<div class="lives">{"".join(live_card(*l) for l in LIVE)}</div></section>')
    kosi = SECTIONS[0]
    kosi_cards = "".join(card(*i) for i in kosi[3])
    page = TEMPLATE
    for k, v in {"nav": nav, "count": str(count), "sections": "\n  ".join(parts),
                 "kosi_lede": esc(kosi[2]), "kosi_cards": kosi_cards}.items():
        page = page.replace("{{" + k + "}}", v)
    (HERE / "index.html").write_text(page)
    print(f"gallery/index.html: {count} pieces")


TEMPLATE = (HERE / "template.html").read_text()

if __name__ == "__main__":
    main()
