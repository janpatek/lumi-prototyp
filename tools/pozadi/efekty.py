# Z vygenerovaných zvukových efektů udělá krátké soubory pro přehrávač (audio/efekty/).
#
#   uvx --with numpy python -I tools/pozadi/efekty.py <ffmpeg> <složka s efekty>
#
# Ve složce čeká <id>-<varianta>.mp3 (id z tools/pozadi/efekty-katalog.mjs). Skript:
#  1. převede na mono a ořízne ticho na začátku a na konci,
#  2. přidá krátký náběh a doznění, aby efekt nelupl,
#  3. srovná hlasitost (stejná pro všechny efekty, poměr k hlasu řeší přehrávač),
#  4. upozorní na skoro tiché nebo moc dlouhé nahrávky (takovou variantu smaž z audio/efekty/ i z efekty.json).
# Délky zapíše do tools/pozadi/efekty.json (sestavení indexu: node tools/pozadi/zvuky.mjs build).

import json, os, re, subprocess, sys
import numpy as np

FF, SRC = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', '..', 'audio', 'efekty')
SR = 44100
TARGET_DB = -21.0  # RMS hlasité části efektu; hlas má −19,6
MAX_LEN = 6.0


def load(path):
    raw = subprocess.run([FF, '-v', 'error', '-i', path, '-map', '0:a', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def process(x):
    win = SR // 100
    n = len(x) // win
    e = 10 * np.log10((x[: n * win] ** 2).reshape(n, win).mean(axis=1) + 1e-12)
    top = e.max()
    loud = np.where(e > top - 40)[0]
    a = max(0, loud[0] * win - SR // 50)
    b = min(len(x), (loud[-1] + 1) * win + SR // 10)
    y = x[a:b].copy()
    if len(y) > MAX_LEN * SR:
        y = y[: int(MAX_LEN * SR)]
    fi, fo = int(0.005 * SR), min(int(0.25 * SR), len(y) // 4)
    y[:fi] *= np.linspace(0, 1, fi)
    y[-fo:] *= np.linspace(1, 0, fo) ** 2
    # hlasitost podle hlasitější části (efekt bývá krátký zvuk a ticho kolem)
    n = len(y) // win
    ey = (y[: n * win] ** 2).reshape(n, win).mean(axis=1)
    body = ey[ey > ey.max() * 10 ** (-20 / 10)]
    rms_db = 10 * np.log10(body.mean() + 1e-12)
    y *= 10 ** ((TARGET_DB - rms_db) / 20)
    peak = np.abs(y).max()
    if peak > 0.85:
        y *= 0.85 / peak
    return y, top


MAN = os.path.join(HERE, 'efekty.json')
man = json.load(open(MAN)) if os.path.exists(MAN) else {}
os.makedirs(OUT, exist_ok=True)
for name in sorted(os.listdir(SRC)):
    m = re.fullmatch(r'([a-z][a-z0-9-]*)-(\d)\.mp3', name)
    if not m:
        continue
    fid, v = m.groups()
    y, top = process(load(os.path.join(SRC, name)))
    warn = []
    if top < -45:
        warn.append(f'skoro ticho ({top:.0f} dB)')
    if len(y) / SR >= MAX_LEN:
        warn.append('zkráceno')
    out = os.path.join(OUT, f'{fid}-{v}.mp3')
    subprocess.run([FF, '-v', 'error', '-y', '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-i', '-', '-c:a', 'libmp3lame', '-b:a', '64k', out], input=y.astype(np.float32).tobytes(), check=True)
    man.setdefault(fid, {})[v] = round(len(y) / SR, 3)
    if warn:
        print(f'{name}: {", ".join(warn)}')

json.dump({k: dict(sorted(v.items())) for k, v in sorted(man.items())}, open(MAN, 'w'), indent=1)
print(f'{sum(len(v) for v in man.values())} souborů, {len(man)} efektů')
