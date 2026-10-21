#!/usr/bin/env python3
"""
generate_sound.py — Génération d'effets sonores et d'ambiances via l'API ElevenLabs.

Usage :
  python generate_sound.py --prompt "sword slash hitting armor" --out slash.mp3
  python generate_sound.py --prompt "victory fanfare" --duration 3 --out win.mp3
  python generate_sound.py --prompt "coins clinking" --count 3 --out gold.mp3   # gold_1..3.mp3

Options :
  --duration S      Durée en secondes (0.5 à 22). Omis = choisie par le modèle.
  --influence X     prompt_influence 0..1 (défaut 0.4) : plus haut = colle plus au prompt,
                    plus bas = plus créatif.
  --count N         Nombre de variantes (suffixe _1, _2, ...).

La clé est lue dans la variable d'environnement ELEVENLABS_API_KEY (obligatoire).
Sortie : MP3 44.1 kHz. Conseils de prompt : décrire la matière et l'action
("heavy stone thud with dust"), préciser "short/quick" pour des sons UI, et
"no music" si le modèle ajoute une nappe indésirable.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

API_URL = "https://api.elevenlabs.io/v1/sound-generation"


def api_key():
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        sys.exit("Clé ElevenLabs absente : définis la variable d'environnement ELEVENLABS_API_KEY, puis relance.")
    return key


def generate(prompt, duration=None, influence=0.4, timeout=180):
    payload = {"text": prompt, "prompt_influence": influence}
    if duration is not None:
        payload["duration_seconds"] = duration
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        headers={"xi-api-key": api_key(), "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:800]
        sys.exit("Erreur HTTP %s d'ElevenLabs : %s" % (e.code, body))
    except urllib.error.URLError as e:
        sys.exit("Impossible de joindre api.elevenlabs.io (%s)." % e.reason)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", default="sound.mp3")
    ap.add_argument("--duration", type=float, default=None)
    ap.add_argument("--influence", type=float, default=0.4)
    ap.add_argument("--count", type=int, default=1)
    args = ap.parse_args()

    if args.duration is not None and not (0.5 <= args.duration <= 22):
        ap.error("--duration doit être entre 0.5 et 22 secondes")

    api_key()  # échoue avant tout appel réseau si la clé manque

    for i in range(args.count):
        audio = generate(args.prompt, args.duration, args.influence)
        base, ext = os.path.splitext(args.out)
        path = args.out if args.count == 1 else "%s_%d%s" % (base, i + 1, ext)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "wb") as f:
            f.write(audio)
        print("OK: %s (%d octets)" % (path, len(audio)))


if __name__ == "__main__":
    main()
