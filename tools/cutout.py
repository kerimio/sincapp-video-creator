"""Freisteller für Prospekt-Produkte.

Liest eine JSON-Liste von Aufträgen von stdin und schreibt pro Auftrag ein
Ergebnis-JSON (eine Zeile) nach stdout. So wird das Modell nur einmal geladen.

Auftrag:
  {"image": "seite-1.png", "out": "images/o1.png",
   "bbox": [x0, y0, x1, y1],          # Pixel im Seitenbild
   "erase": [[x0, y0, x1, y1], ...],  # Preisschilder u. ä., werden transparent
   "pad": 0.06}

Ergebnis:
  {"out": ..., "ok": true, "width": .., "height": .., "edgeTransparent": 0.97,
   "coverage": 0.41, "warnings": [...]}
"""

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

MODEL = os.environ.get("SINCAPP_REMBG_MODEL", "birefnet-general-lite")
FALLBACK_MODEL = "isnet-general-use"
MAX_SIDE = 1200  # Ausgabe nie größer, das Template zeigt max. ~600 px


def load_session(name):
    # Die Speicher-Arena von onnxruntime ist schnell, wächst aber mit jedem
    # Modell. Der Aufrufer startet deshalb alle paar Bilder einen neuen Prozess;
    # SINCAPP_ORT_ARENA=0 schaltet sie ganz ab (sparsam, aber ~3× langsamer).
    import onnxruntime as ort
    from rembg.sessions import sessions_class

    opts = ort.SessionOptions()
    if os.environ.get("SINCAPP_ORT_ARENA", "1") == "0":
        opts.enable_cpu_mem_arena = False
        opts.enable_mem_pattern = False
    cls = next(c for c in sessions_class if c.name() == name)
    return cls(name, opts)


def mask_for(session, crop):
    from rembg import remove

    m = remove(crop, session=session, only_mask=True, post_process_mask=True)
    return np.array(m.convert("L"), dtype=np.uint8)


def clamp_box(box, w, h):
    x0, y0, x1, y1 = box
    return [max(0, int(round(x0))), max(0, int(round(y0))), min(w, int(round(x1))), min(h, int(round(y1)))]


def border_transparency(alpha):
    """Anteil der Randpixel (1 px Rahmen), die zu ≥ 90 % transparent sind."""
    edge = np.concatenate([alpha[0, :], alpha[-1, :], alpha[:, 0], alpha[:, -1]])
    return float(np.mean(edge <= 25))


def looks_like_checkerboard(rgb, alpha):
    """Erkennt ein 'gefaktes' Transparenz-Schachbrett: zwei helle Grautöne,
    die sich in einem regelmäßigen Raster abwechseln."""
    opaque = alpha > 200
    if opaque.sum() < 500:
        return False
    px = rgb[opaque].astype(int)
    neutral = (np.abs(px[:, 0] - px[:, 1]) < 6) & (np.abs(px[:, 1] - px[:, 2]) < 6) & (px[:, 0] > 180)
    if neutral.mean() < 0.3:
        return False
    vals = px[neutral, 0] // 8
    counts = np.bincount(vals, minlength=33)
    top = np.argsort(counts)[-2:]
    a, b = sorted(top)
    if counts[a] + counts[b] < 0.8 * neutral.sum() or (b - a) * 8 < 12:
        return False
    # Raster prüfen: Helligkeit springt periodisch entlang der Zeilen
    g = rgb[..., 0].astype(int)
    row = g[g.shape[0] // 2]
    jumps = np.flatnonzero(np.abs(np.diff(row)) > 12)
    if len(jumps) < 6:
        return False
    gaps = np.diff(jumps)
    return float(np.std(gaps)) < 2.5 and 4 <= float(np.median(gaps)) <= 40


def tag_mask(rgb, rect, grow=24):
    """Fläche eines Preisschilds: das gemeldete Rechteck, an jeder Seite so weit
    erweitert, wie dort noch Schild-Rot liegt (falls die Box zu knapp ist)."""
    h, w = rgb.shape[:2]
    x0, y0, x1, y1 = [int(round(v)) for v in rect]
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    m = np.zeros((h, w), dtype=bool)
    if x1 <= x0 or y1 <= y0:
        return m
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    red = (r > 110) & (g < 70) & (b < 70) & (r - g > 70)

    def share(ys, xs):
        strip = red[ys, xs]
        return strip.mean() if strip.size else 0

    for _ in range(grow):
        moved = False
        if x0 > 0 and share(slice(y0, y1), slice(x0 - 1, x0)) > 0.4:
            x0 -= 1; moved = True
        if x1 < w and share(slice(y0, y1), slice(x1, x1 + 1)) > 0.4:
            x1 += 1; moved = True
        if y0 > 0 and share(slice(y0 - 1, y0), slice(x0, x1)) > 0.4:
            y0 -= 1; moved = True
        if y1 < h and share(slice(y1, y1 + 1), slice(x0, x1)) > 0.4:
            y1 += 1; moved = True
        if not moved:
            break
    m[y0:y1, x0:x1] = True
    return ndimage.binary_dilation(m, iterations=4)


def fill_under_tag(alpha, zone):
    """Unter einem Preisschild ist das Produkt verdeckt. Liegt die Stelle
    innerhalb der Produktform (konvexe Hülle), wird sie deckend gefüllt."""
    import cv2

    if not zone.any():
        return alpha
    solid = ((alpha > 128) & ~zone).astype(np.uint8)
    cnts, _ = cv2.findContours(solid, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return alpha
    hull = np.zeros_like(solid)
    for c in cnts:
        if cv2.contourArea(c) > 0.05 * solid.sum():
            cv2.fillPoly(hull, [cv2.convexHull(c)], 1)
    out = alpha.copy()
    out[zone & (hull > 0)] = 255
    return out


def drop_specks(alpha, min_share=0.03):
    """Kleine abgetrennte Inseln (Pinselstriche, Schrift-Reste) entfernen."""
    lab, n = ndimage.label(alpha > 128)
    if n <= 1:
        return alpha
    sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = sizes >= sizes.max() * min_share
    solid = keep[lab]
    # weiche Kanten der behaltenen Teile mitnehmen
    grown = ndimage.binary_dilation(solid, iterations=3)
    return np.where(grown, alpha, 0).astype(np.uint8)


def plain_background_alpha(rgb, tol=26.0):
    """Produktfoto auf einfarbigem Hintergrund (typisch: weiß im Shop): nur den Hintergrund
    vom Rand her wegnehmen, das Produkt bleibt vollständig. None, wenn der Rand nicht einfarbig ist."""
    h, w = rgb.shape[:2]
    f = np.concatenate([rgb[:3].reshape(-1, 3), rgb[-3:].reshape(-1, 3), rgb[:, :3].reshape(-1, 3), rgb[:, -3:].reshape(-1, 3)]).astype(np.float32)
    bg = np.median(f, axis=0)
    if (np.linalg.norm(f - bg, axis=1) < tol).mean() < 0.92:
        return None
    dist = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
    cand = dist < tol
    lab, _ = ndimage.label(cand)
    edge_labels = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    back = np.isin(lab, edge_labels[edge_labels > 0])
    fg = ndimage.binary_fill_holes(~back)
    share = float(fg.mean())
    if share < 0.06 or share > 0.97:
        return None
    # weiche Kante: Übergang über den Farbabstand, nur direkt am Rand des Produkts
    ring = ndimage.binary_dilation(fg, iterations=2) & ~ndimage.binary_erosion(fg, iterations=1)
    soft = np.clip((dist - tol * 0.5) / (tol * 1.5), 0, 1)
    alpha = np.where(fg, 1.0, 0.0)
    alpha = np.where(ring, np.maximum(alpha * soft, np.where(fg, soft, 0)), alpha)
    return drop_specks((alpha * 255).astype(np.uint8))


def save_trimmed(rgba, out, extra):
    a = rgba[..., 3]
    ys, xs = np.nonzero(a > 8)
    if len(xs) == 0:
        return None
    rgba = rgba[max(0, ys.min() - 2):ys.max() + 3, max(0, xs.min() - 2):xs.max() + 3]
    img = Image.fromarray(rgba, "RGBA")
    if max(img.size) > MAX_SIDE:
        s = MAX_SIDE / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out, optimize=True)
    return dict(extra, out=out, width=img.width, height=img.height, coverage=round(float((rgba[..., 3] > 128).mean()), 4))


def process(job, sessions, cache):
    warnings = []
    path = job["image"]
    if job.get("bbox") is None:
        # Ganzes Bild (z. B. Produktfoto aus dem Internet). Ist es schon freigestellt, nur zuschneiden.
        src = Image.open(path)
        if src.mode in ("RGBA", "LA", "P"):
            rgba = np.array(src.convert("RGBA"), dtype=np.uint8)
            edge = border_transparency(rgba[..., 3])
            if edge >= 0.9 and (rgba[..., 3] < 25).mean() > 0.05:
                if looks_like_checkerboard(rgba[..., :3], rgba[..., 3]):
                    warnings.append("Bild sieht nach einem gefakten Transparenz-Schachbrett aus")
                res = save_trimmed(rgba, job["out"], {"ok": not warnings, "model": "vorhanden", "edgeTransparent": round(edge, 4), "warnings": warnings})
                if res:
                    return res
        rgb = np.array(src.convert("RGB"), dtype=np.uint8)
        a = plain_background_alpha(rgb)
        if a is not None and border_transparency(a) >= 0.9:
            res = save_trimmed(np.dstack([rgb, a]), job["out"], {"ok": True, "model": "hintergrund", "edgeTransparent": round(border_transparency(a), 4), "warnings": warnings})
            if res:
                return res
        w, h = src.size
        job = dict(job, bbox=[0, 0, w, h], pad=0)
    if path not in cache:
        cache.clear()
        cache[path] = Image.open(path).convert("RGB")
    page = cache[path]
    W, H = page.size
    x0, y0, x1, y1 = job["bbox"]
    pad = float(job.get("pad", 0.06))
    pw, ph = (x1 - x0) * pad, (y1 - y0) * pad
    box = clamp_box([x0 - pw, y0 - ph, x1 + pw, y1 + ph], W, H)
    if box[2] - box[0] < 24 or box[3] - box[1] < 24:
        return {"out": job["out"], "ok": False, "warnings": ["Ausschnitt zu klein"]}
    crop = page.crop(box)
    rgb = np.array(crop, dtype=np.uint8)

    # Preisschilder: Fläche bestimmen, im Bild übermalen (Inpainting), danach freistellen.
    tag = np.zeros(rgb.shape[:2], dtype=bool)
    inner = np.zeros_like(tag)
    inner[max(0, y0 - box[1]):y1 - box[1], max(0, x0 - box[0]):x1 - box[0]] = True
    for r in job.get("erase", []):
        m = tag_mask(rgb, [r[0] - box[0], r[1] - box[1], r[2] - box[0], r[3] - box[1]])
        tag |= m
    if tag.any():
        import cv2

        rgb = cv2.inpaint(rgb, tag.astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)
        crop = Image.fromarray(rgb)

    best = None
    for name in sessions["order"]:
        try:
            if name not in sessions:
                sessions[name] = load_session(name)
            a = mask_for(sessions[name], crop)
        except Exception as e:  # Modell fehlt o. ä.
            warnings.append(f"{name}: {e}")
            continue
        a[tag & ~inner] = 0
        a = fill_under_tag(a, tag & inner)
        a = drop_specks(a)
        cand = (border_transparency(a) >= 0.9, min(float((a > 128).mean()), 0.6), name, a)
        if best is None or cand[:2] > best[:2]:
            best = cand
        if cand[0] and cand[1] >= 0.35:
            break
    if best is None:
        return {"out": job["out"], "ok": False, "warnings": warnings + ["Freistellen fehlgeschlagen"]}
    used, alpha = best[2], best[3]
    # Wie viel vom Produkt lag unter dem Schild und wurde aufgefüllt?
    filled = int((tag & inner & (alpha > 128)).sum())
    if filled > 0.03 * max(1, int((alpha > 128).sum())):
        warnings.append(f"Preisschild verdeckte {filled / max(1, int((alpha > 128).sum())):.0%} des Produkts – Stelle wurde aufgefüllt, bitte prüfen")
    if best[1] < 0.4:
        warnings.append("Produkt evtl. nur teilweise erkannt – bitte prüfen oder Internet-Bild nehmen")

    edge = border_transparency(alpha)
    if edge < 0.9:
        warnings.append(f"Rand nur zu {edge:.0%} transparent – Produkt evtl. angeschnitten oder Hintergrund übrig")

    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        return {"out": job["out"], "ok": False, "warnings": warnings + ["leere Maske"]}
    m = 2
    tx0, ty0 = max(0, xs.min() - m), max(0, ys.min() - m)
    tx1, ty1 = min(alpha.shape[1], xs.max() + 1 + m), min(alpha.shape[0], ys.max() + 1 + m)

    rgba = np.dstack([rgb, alpha])[ty0:ty1, tx0:tx1]
    if looks_like_checkerboard(rgba[..., :3], rgba[..., 3]):
        warnings.append("Bild sieht nach einem gefakten Transparenz-Schachbrett aus")

    out = Image.fromarray(rgba, "RGBA")
    if max(out.size) > MAX_SIDE:
        s = MAX_SIDE / max(out.size)
        out = out.resize((round(out.width * s), round(out.height * s)), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(job["out"])), exist_ok=True)
    out.save(job["out"], optimize=True)

    coverage = float((rgba[..., 3] > 128).mean())
    return {
        "out": job["out"],
        "ok": edge >= 0.9,
        "model": used,
        "width": out.width,
        "height": out.height,
        "cropBox": [int(v) for v in (box[0] + tx0, box[1] + ty0, box[0] + tx1, box[1] + ty1)],
        "edgeTransparent": round(edge, 4),
        "coverage": round(coverage, 4),
        "warnings": warnings,
    }


def main():
    jobs = json.load(sys.stdin)
    order = [MODEL] + ([FALLBACK_MODEL] if MODEL != FALLBACK_MODEL else [])
    sessions = {"order": order}
    cache = {}
    for job in jobs:
        try:
            res = process(job, sessions, cache)
        except Exception as e:
            res = {"out": job.get("out"), "ok": False, "warnings": [f"Fehler: {e}"]}
        if os.environ.get("SINCAPP_CUTOUT_DEBUG"):
            import resource

            res["maxRssMB"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024
        print(json.dumps(res, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
