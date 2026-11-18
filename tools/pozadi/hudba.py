# Z vygenerovaných skladeb (Lyria 3 Pro, 2–3 min) udělá části pro přehrávač (audio/hudba/).
#
#   uvx --with numpy python -I tools/pozadi/hudba.py <ffmpeg> <složka se skladbami>
#
# Ve složce čeká <styl>-<číslo>.mp3 (styl z tools/pozadi/styly.json). Skript:
#  1. ořízne ticho na začátku a na konci,
#  2. plynule srovná hlasitost (okna 3 s), aby skladba neměla hlasitá a tichá místa,
#  3. přidá náběh a doznění,
#  4. rozdělí ji na části po CHUNK sekundách. Každá část má PAD sekund přesahu do sousedních,
#     přehrávač je skládá za sebou s krátkým prolnutím, takže posun dekodéru MP3 nevadí.
# Části jsou kvůli paměti: dekódovaná 2–3 min skladba má v telefonu desítky MB, část jen pár.
# Délky zapíše do tools/pozadi/hudba.json (sestavení indexu: node tools/pozadi/zvuky.mjs build).

import json, os, re, subprocess, sys
import numpy as np

FF, SRC = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', '..', 'audio', 'hudba')
SR, CHUNK, PAD = 44100, 30.0, 0.5
TARGET_DB = -24.0


def load(path):
    raw = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


def env_db(x, win):
    m = (x ** 2).mean(axis=1)
    n = len(m) // win
    return 10 * np.log10(m[: n * win].reshape(n, win).mean(axis=1) + 1e-12)


def trim(x):
    e = env_db(x, SR // 20)
    loud = np.where(e > -50)[0]
    return x[loud[0] * (SR // 20): (loud[-1] + 1) * (SR // 20)]


def level(x):
    # pomalé srovnání hlasitosti: okna 3 s, zesílení nejvýš +6 dB, zeslabení nejvýš −12 dB
    win = SR * 3
    e = env_db(x, win)
    if not len(e):
        return x
    med = np.median(e)
    g_db = np.clip(med - e, -12, 6) * 0.7  # jen z větší části, ať hudba zůstane živá
    g_db = np.convolve(np.pad(g_db, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    gs = np.interp(np.arange(len(x)), np.arange(len(g_db)) * win + win / 2, 10 ** (g_db / 20))
    y = x * gs[:, None]
    e2 = env_db(y, SR // 2)
    y *= 10 ** ((TARGET_DB - np.median(e2)) / 20)
    # rychlý limiter špiček (10 ms okna)
    w = SR // 100
    n = -(-len(y) // w)
    pk = np.pad(np.abs(y).max(axis=1), (0, n * w - len(y))).reshape(n, w).max(axis=1)
    gw = np.minimum(1, 0.89 / np.maximum(pk, 1e-9))
    gw = np.minimum(gw, np.minimum(np.roll(gw, 1), np.roll(gw, -1)))
    gw = np.convolve(gw, np.ones(3) / 3, mode='same')
    y *= np.interp(np.arange(len(y)), np.arange(n) * w + w / 2, gw)[:, None]
    return y


def fades(x, fin=1.5, fout=4.0):
    a, b = int(fin * SR), int(fout * SR)
    x[:a] *= np.linspace(0, 1, a)[:, None] ** 2
    x[-b:] *= np.linspace(1, 0, b)[:, None] ** 2
    return x


MAN = os.path.join(HERE, 'hudba.json')
man = json.load(open(MAN)) if os.path.exists(MAN) else {}
os.makedirs(OUT, exist_ok=True)
for name in sorted(os.listdir(SRC)):
    m = re.fullmatch(r'([a-z-]+)-(\d)\.mp3', name)
    if not m:
        continue
    styl, n = m.groups()
    x = fades(level(trim(load(os.path.join(SRC, name)))))
    p = int(PAD * SR)
    total = len(x)
    xp = np.concatenate([np.zeros((p, 2)), x, np.zeros((p, 2))])
    bodies, k, pos = [], 0, 0
    step = int(CHUNK * SR)
    while pos < total:
        body = min(step, total - pos)
        if total - (pos + body) < SR * 8:  # krátký zbytek přidat k poslední části
            body = total - pos
        part = xp[pos: pos + body + 2 * p].astype(np.float32)
        k += 1
        out = os.path.join(OUT, f'{styl}-{n}-{k}.mp3')
        subprocess.run([FF, '-v', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-i', '-', '-c:a', 'libmp3lame', '-b:a', '64k', out], input=part.tobytes(), check=True)
        bodies.append(round(body / SR, 4))
        pos += body
    man.setdefault(styl, {})[n] = bodies
    e = env_db(x, SR)
    print(f'{styl}-{n}: {total / SR:6.1f} s, {k} částí, hlasitost {np.percentile(e, 10):.0f}…{np.percentile(e, 90):.0f} dB')

json.dump({s: dict(sorted(v.items())) for s, v in sorted(man.items())}, open(MAN, 'w'), indent=1)
