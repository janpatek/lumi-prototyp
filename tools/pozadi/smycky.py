# Z vygenerovaných nahrávek udělá smyčky zvuku do pozadí pro přehrávač (audio/pozadi/).
#
#   uvx --with numpy python -I tools/pozadi/smycky.py <ffmpeg> <složka s nahrávkami>
#
# Ve složce čeká <druh>-<pohádka>.mp3, druh je „kulisa“ (ruchy) nebo „hudba“. Skript:
#  1. ořízne ticho a doznění na konci (Lyria hudbu na konci ztlumí),
#  2. ztlumí náhlé hlasité zvuky (pták, troubení), aby nebudily,
#  3. konec prolne do začátku, takže tělo smyčky na sebe plynule navazuje,
#  4. srovná hlasitost (kulisa i hudba stejně, poměr míchá přehrávač),
#  5. před tělo přidá PAD sekund jeho konce a za něj PAD sekund začátku.
# Díky okrajům je smyčka bez mezery, i když dekodér MP3 posune začátek (kodér přidává ticho):
# přehrávač smyčkuje mezi PAD a PAD + délka těla, a obojí se posune stejně.
# Délky těl doplní do audio/pozadi/index.json (ostatní pohádky v něm nechá). Pohádky ze sdilene.json
# dostanou v indexu odkaz na smyčku jiné pohádky, takže se nic nekopíruje.

import json, os, re, subprocess, sys
import numpy as np

FF, SRC = sys.argv[1], sys.argv[2]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'audio', 'pozadi')
SR, PAD = 44100, 0.5
XFADE = {'kulisa': 2.0, 'hudba': 3.0}
TARGET_DB = -24.0


def load(path):
    raw = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


def env_db(x, win):
    m = (x ** 2).mean(axis=1)
    n = len(m) // win
    return 10 * np.log10(m[: n * win].reshape(n, win).mean(axis=1) + 1e-12)


def trim_end(x):
    # konec po posledním okně, které je nanejvýš 6 dB pod mediánem (doznění a ticho pryč)
    win = SR // 4
    e = env_db(x, win)
    med = np.median(e)
    loud = np.where(e > med - 6)[0]
    first, last = loud[0], loud[-1]
    return x[first * win: (last + 1) * win]


def tame(x):
    # jednoduchý kompresor: co je víc než 6 dB nad mediánem, stáhne zpátky (plynule, okna 0,1 s)
    win = SR // 10
    e = env_db(x, win)
    med = np.median(e)
    red = np.minimum(0, (med + 6) - e)  # záporné dB
    g = 10 ** (red / 20)
    g = np.minimum(g, np.convolve(g, np.ones(5) / 5, mode='same'))  # vyhladit, ale nikdy nezesílit
    gs = np.interp(np.arange(len(x)), np.arange(len(g)) * win + win / 2, g)
    return x * gs[:, None]


def loop_body(x, xf):
    n = int(xf * SR)
    t = np.linspace(0, np.pi / 2, n)[:, None]
    body = x[: len(x) - n].copy()
    body[:n] = x[:n] * np.sin(t) + x[len(x) - n:] * np.cos(t)  # stejný výkon v prolnutí
    return body


def normalize(x):
    e = env_db(x, SR // 2)
    g = 10 ** ((TARGET_DB - np.median(e)) / 20)
    y = x * g
    # rychlý limiter: krátké špičky (lupnutí ohně, hrom) ztlumí jen v okně 10 ms, ne celý soubor
    win = SR // 100
    n = -(-len(y) // win)
    pk = np.pad(np.abs(y).max(axis=1), (0, n * win - len(y))).reshape(n, win).max(axis=1)
    gw = np.minimum(1, 0.89 / np.maximum(pk, 1e-9))
    gw = np.minimum(gw, np.minimum(np.roll(gw, 1), np.roll(gw, -1)))  # sousední okna taky, ať limiter nepraská
    gw = np.convolve(gw, np.ones(3) / 3, mode='same')
    gs = np.interp(np.arange(len(y)), np.arange(n) * win + win / 2, gw)
    y = y * gs[:, None]
    peak = np.abs(y).max()
    return y * (0.89 / peak) if peak > 0.89 else y


INDEX = os.path.join(OUT, 'index.json')
manifest = json.load(open(INDEX)) if os.path.exists(INDEX) else {'pad': PAD, 'clips': {}}
for name in sorted(os.listdir(SRC)):
    m = re.fullmatch(r'(kulisa|hudba)-([a-z][a-z-]*)\.mp3', name)
    if not m:
        continue
    kind, story = m.groups()
    x = trim_end(load(os.path.join(SRC, name)))
    x = normalize(tame(x))
    body = loop_body(x, XFADE[kind])
    p = int(PAD * SR)
    full = np.concatenate([body[-p:], body, body[:p]]).astype(np.float32)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'{story}-{kind}.mp3')
    subprocess.run([FF, '-v', 'error', '-y', '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-i', '-', '-c:a', 'libmp3lame', '-b:a', '96k', out], input=full.tobytes(), check=True)
    manifest['clips'].setdefault(story, {})[kind] = {'file': f'{story}-{kind}.mp3', 'body': round(len(body) / SR, 4)}
    print(f'{out}: tělo {len(body) / SR:.2f} s')

shared = json.load(open(os.path.join(os.path.dirname(__file__), 'sdilene.json')))
for story, kinds in shared.items():
    if story.startswith('_'):
        continue
    for kind, src in kinds.items():
        manifest['clips'].setdefault(story, {})[kind] = manifest['clips'][src][kind]

with open(INDEX, 'w') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
