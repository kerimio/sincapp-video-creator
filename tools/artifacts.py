"""Produktbilder im fertigen Video auf Artefakte prüfen (ohne KI) und kleine Vorschauen für die KI-Prüfung bauen.

Liest eine JSON-Liste von Aufträgen von stdin, schreibt pro Auftrag eine Ergebnis-Zeile nach stdout.

Auftrag:  {"id": "s3-1", "image": "images/s3-1.png", "preview": "work/pruefung/produkt-s3-1.jpg"}
Ergebnis: {"id": "s3-1", "photo": false, "warnings": ["2 lose Flecken neben dem Produkt", ...]}

Geprüft wird nur, was sich sicher messen lässt:
- lose Flecken neben dem Produkt (Reste von Hintergrund, Schrift oder Nachbarprodukt)
- gerade Schnittkante: das Produkt endet über weite Strecken genau am Bildrand (beim Ausschneiden abgeschnitten)
- Löcher im Produkt (vom Freistellen durchsichtig gewordene Stellen)
- ausgefranster Rand (viele halbdurchsichtige Pixel)
Fotos mit Hintergrund (frisches Fleisch) haben keinen Freisteller – dort prüft nur die KI.
"""

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

PREVIEW = 256  # Vorschau für die KI: lange Seite


def check(rgba):
    alpha = rgba[..., 3]
    solid = alpha > 128
    if solid.mean() > 0.97:
        return True, []
    warnings = []
    lab, n = ndimage.label(solid)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
        # mehrere Packungen nebeneinander sind normal (ähnlich groß); kleine abgetrennte Inseln nicht
        loose = [s for s in sizes if s < sizes.max() * 0.15 and s > max(40, sizes.max() * 0.002)]
        if loose:
            warnings.append(f"{len(loose)} lose{'r' if len(loose) == 1 else ''} Fleck{'' if len(loose) == 1 else 'en'} neben dem Produkt (Reste vom Ausschneiden?)")
    h, w = alpha.shape
    # Bild ist auf das Produkt zugeschnitten: Produkt berührt den Rand an einzelnen Stellen – über weite Strecken heißt angeschnitten
    sides = {"oben": alpha[1], "unten": alpha[-2], "links": alpha[:, 1], "rechts": alpha[:, -2]}
    cut = [k for k, line in sides.items() if (line > 200).mean() > 0.6]
    if cut:
        warnings.append(f"gerade Schnittkante {', '.join(cut)} – Produkt evtl. abgeschnitten")
    holes = ndimage.binary_fill_holes(solid) & ~solid
    if holes.sum() > solid.sum() * 0.03:
        hl, hn = ndimage.label(holes)
        big = int((ndimage.sum(np.ones_like(hl), hl, index=np.arange(1, hn + 1)) > solid.sum() * 0.01).sum()) if hn else 0
        if big:
            warnings.append(f"{big} Loch{'' if big == 1 else 'er'} im Produkt (durchsichtig geworden)")
    fringe = ((alpha > 30) & (alpha < 220)).sum()
    if fringe > solid.sum() * 0.12:
        warnings.append("ausgefranster Rand (viele halbdurchsichtige Pixel)")
    return False, warnings


def preview(img, out):
    """Auf hellgrauem Grund wie in der Karte, damit Reste und Löcher sichtbar sind."""
    img = img.convert("RGBA")
    img.thumbnail((PREVIEW, PREVIEW), Image.LANCZOS)
    bg = Image.new("RGBA", img.size, (232, 232, 232, 255))
    bg.alpha_composite(img)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bg.convert("RGB").save(out, quality=85)


def main():
    for job in json.load(sys.stdin):
        try:
            img = Image.open(job["image"])
            photo, warnings = check(np.array(img.convert("RGBA")))
            if job.get("preview"):
                preview(img, job["preview"])
            res = {"id": job["id"], "photo": photo, "warnings": warnings}
        except Exception as e:
            res = {"id": job.get("id"), "photo": False, "warnings": [f"Bild nicht lesbar: {e}"]}
        print(json.dumps(res, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
