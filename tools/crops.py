"""Schneidet Rechtecke aus Seitenbildern (für den Preis-Gegencheck).

stdin: [{"image": ..., "box": [x0, y0, x1, y1], "out": ..., "pad": 0.15}]
stdout: eine Zeile JSON pro Ausschnitt: {"out": ..., "ok": true}
"""

import json
import os
import sys

from PIL import Image

cache = {}
for job in json.load(sys.stdin):
    try:
        if job["image"] not in cache:
            cache.clear()
            cache[job["image"]] = Image.open(job["image"]).convert("RGB")
        img = cache[job["image"]]
        x0, y0, x1, y1 = job["box"]
        pad = float(job.get("pad", 0.15))
        pw, ph = (x1 - x0) * pad, (y1 - y0) * pad
        box = (max(0, int(x0 - pw)), max(0, int(y0 - ph)), min(img.width, int(x1 + pw)), min(img.height, int(y1 + ph)))
        crop = img.crop(box)
        if max(crop.size) < 400:  # kleine Schilder hochskalieren, damit die Ziffern gut lesbar sind
            s = 400 / max(crop.size)
            crop = crop.resize((round(crop.width * s), round(crop.height * s)), Image.LANCZOS)
        os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
        crop.save(job["out"])
        print(json.dumps({"out": job["out"], "ok": True}), flush=True)
    except Exception as e:
        print(json.dumps({"out": job.get("out"), "ok": False, "error": str(e)}), flush=True)
