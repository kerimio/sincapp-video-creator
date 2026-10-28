"""Markt-Logo für Kacheln vorbereiten: weißen bzw. leeren Rand abschneiden, damit das Logo die Kachel füllt.

Viele Logos aus Firestore sind JPGs mit breitem weißem Rand – in einer kleinen Kachel bleibt
davon nur ein Fleck in der Mitte. Läuft lokal, kostet nichts.

Liest eine JSON-Liste von Aufträgen von stdin, schreibt pro Auftrag eine Zeile:
  Auftrag:  {"image": "logo.jpg", "out": "logo-kachel.png"}
  Ergebnis: {"out": .., "ok": true, "width": .., "height": ..}
"""

import json
import os
import sys

import numpy as np
from PIL import Image


def trim(img):
    rgba = np.array(img.convert("RGBA")).astype(int)
    # "leer" = fast weiß oder durchsichtig
    blank = (rgba[..., 3] < 16) | (rgba[..., :3].min(axis=2) > 235)
    ys, xs = np.nonzero(~blank)
    if len(xs) == 0:
        return img
    pad = max(2, round(0.04 * max(xs.max() - xs.min(), ys.max() - ys.min())))
    h, w = blank.shape
    return img.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + pad + 1), min(h, ys.max() + pad + 1)))


def run(job):
    out = trim(Image.open(job["image"]))
    os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
    out.save(job["out"])
    return {"out": job["out"], "ok": True, "width": out.width, "height": out.height}


def main():
    for job in json.load(sys.stdin):
        try:
            res = run(job)
        except Exception as e:  # ein kaputtes Logo hält die anderen nicht auf
            res = {"out": job.get("out"), "ok": False, "error": str(e)}
        print(json.dumps(res), flush=True)


if __name__ == "__main__":
    main()
