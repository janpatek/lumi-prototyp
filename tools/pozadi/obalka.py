# Vypíše hlasitost (dBFS RMS) po 1 s pro každý soubor: python obalka.py ffmpeg soubor...
import subprocess, sys, numpy as np
ff = sys.argv[1]
for f in sys.argv[2:]:
    raw = subprocess.run([ff, '-v', 'error', '-i', f, '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'], capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    w = 44100
    db = [20 * np.log10(np.sqrt(np.mean(x[i:i + w] ** 2)) + 1e-9) for i in range(0, len(x) - w + 1, w)]
    print(f.split('/')[-1].ljust(22), ' '.join(f'{d:4.0f}' for d in db))
