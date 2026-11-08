# Začátky vět v namluvené dávce: rozpozná řeč (faster-whisper, lokálně) a porovná slova s textem dávky.
#   uvx --with faster-whisper python tools/hlas/casovani.py <dávka> <nahrávka.mp3>
# Zapíše tools/hlas/nahravky/<dávka>.zacatky.json – pole sekund, jedna hodnota na větu – pro cut.mjs.
import json, os, re, subprocess, sys, unicodedata
import numpy as np
from difflib import SequenceMatcher
from pathlib import Path
from faster_whisper import WhisperModel

root = Path(__file__).resolve().parents[2]
name, take = sys.argv[1], sys.argv[2]
lines = json.loads((root / 'tools/hlas/davky' / f'{name}.json').read_text())['lines']

def norm(w):
    w = unicodedata.normalize('NFC', w.lower())
    return re.sub(r'[^\w]', '', w)

model = WhisperModel('small', device='cpu', compute_type='int8')
# zvuk dekóduje ffmpeg (proměnná FFMPEG jako u cut.mjs) – 16 kHz mono, jak ho whisper chce
pcm = subprocess.run([os.environ.get('FFMPEG', 'ffmpeg'), '-v', 'error', '-i', take, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], capture_output=True, check=True).stdout
audio = np.frombuffer(pcm, np.float32)
segs, _ = model.transcribe(audio, language='cs', word_timestamps=True, beam_size=5, condition_on_previous_text=False, vad_filter=True, vad_parameters={'min_silence_duration_ms': 250})
heard = [(norm(w.word), w.start) for s in segs for w in s.words if norm(w.word)]

# Globální zarovnání slov textu a rozpoznaných slov (Needleman–Wunsch): shoda se počítá přibližně,
# protože rozpoznávání plete koncovky („otevřeli“ místo „otevřely“). Pořadí se nikdy nepřehodí,
# takže ani opakované varianty vět nesklouznou na jiný výskyt.
def sim(a, b):
    return SequenceMatcher(None, a, b).ratio()

script, owner = [], []
for i, l in enumerate(lines):
    for w in l['t'].split():
        if norm(w):
            script.append(norm(w)); owner.append(i)
words = [h[0] for h in heard]
n, m, GAP = len(script), len(words), -0.45
S = np.zeros((n + 1, m + 1), np.float32)
S[1:, 0] = GAP * np.arange(1, n + 1)
S[0, 1:] = GAP * np.arange(1, m + 1)
for i in range(1, n + 1):
    for j in range(1, m + 1):
        S[i, j] = max(S[i - 1, j - 1] + 2 * sim(script[i - 1], words[j - 1]) - 1, S[i - 1, j] + GAP, S[i, j - 1] + GAP)
at = {}
i, j = n, m
while i > 0 and j > 0:
    sc = sim(script[i - 1], words[j - 1])
    if abs(S[i, j] - (S[i - 1, j - 1] + 2 * sc - 1)) < 1e-4:
        if sc >= 0.5:
            at[i - 1] = heard[j - 1][1]
        i, j = i - 1, j - 1
    elif abs(S[i, j] - (S[i - 1, j] + GAP)) < 1e-4:
        i -= 1
    else:
        j -= 1

starts, bad = [], []
for i in range(len(lines)):
    idx = [k for k, o in enumerate(owner) if o == i]
    hit = next(((k, at[k]) for k in idx[:4] if k in at), None)  # opora jen v prvních slovech věty
    if hit is None:
        bad.append(i + 1); starts.append(None); continue
    k, t = hit
    starts.append(max(0.0, t - 0.32 * (k - idx[0])))

# chybějící dopočítat mezi sousedy podle délky textu (konec řeči = konec nahrávky)
end = len(audio) / 16000
wt = [len(norm(l['t'])) + 4 for l in lines]
i = 0
while i < len(starts):
    if starts[i] is not None:
        i += 1; continue
    j = i
    while j < len(starts) and starts[j] is None:
        j += 1
    a = starts[i - 1] if i > 0 else 0.0
    b = starts[j] if j < len(starts) else end
    tot = sum(wt[i - 1 if i > 0 else 0:j]) or 1
    acc = wt[i - 1] if i > 0 else 0
    for k in range(i, j):
        starts[k] = a + (b - a) * acc / tot
        acc += wt[k]
    i = j
out = root / 'tools/hlas/nahravky' / f'{name}.zacatky.json'
out.write_text(json.dumps([round(t, 3) for t in starts]))
print(f'{name}: {len(lines)} vět, nalezeno {len(lines) - len(bad)}' + (f', dopočítané věty {bad}' if bad else ''))
