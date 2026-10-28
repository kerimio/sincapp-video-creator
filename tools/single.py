"""Katalog-Bild bereinigen: genau EINE Packung, saubere Kante.

Viele Prospekte zeigen ein Produkt doppelt (zwei Gläser, zwei Packungen
hintereinander). Das Werkzeug findet die Wiederholung über SIFT-Merkmale, die
im Bild an sich selbst passen (gleicher Versatz = zweite Packung), nimmt die
vordere, vollständige Packung und räumt die Kante auf (Inseln, Reste von
Preisschildern, Farbsaum). Läuft lokal, kostet nichts.

Liest eine JSON-Liste von Aufträgen von stdin, schreibt pro Auftrag eine Zeile:
  Auftrag:  {"image": "x.png", "out": "y.png"}
  Ergebnis: {"out": .., "ok": true, "copies": 2, "shift": [dx, dy], "width": .., "height": ..}
"""

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

MAX_SIDE = 1200
MIN_VOTES = 25  # so viele Merkmale müssen denselben Versatz zeigen


def find_shift(rgba):
    """Versatz (dx, dy) von der einen zur anderen gleichen Packung im Bild (dx ≥ 0), oder None."""
    h, w = rgba.shape[:2]
    sc = 600 / max(h, w)
    size = (max(1, round(w * sc)), max(1, round(h * sc)))
    gray = cv2.resize(cv2.cvtColor(np.ascontiguousarray(rgba[..., :3]), cv2.COLOR_RGB2GRAY), size, interpolation=cv2.INTER_CUBIC)
    mask = (cv2.resize(rgba[..., 3], size) > 200).astype(np.uint8)
    kp, des = cv2.SIFT_create(3000).detectAndCompute(gray, mask)
    if des is None or len(kp) < MIN_VOTES:
        return None
    pts = np.array([k.pt for k in kp])
    src, dst = [], []
    for m in cv2.BFMatcher(cv2.NORM_L2).knnMatch(des, des, k=3):
        if len(m) < 3:
            continue
        b, c = m[1], m[2]  # m[0] ist der Punkt selbst
        if b.distance < 0.6 * max(c.distance, 1e-6) or b.distance < 80:
            p, q = pts[b.queryIdx], pts[b.trainIdx]
            v = q - p
            if np.hypot(*v) > 0.15 * max(size):
                if v[0] < 0 or (v[0] == 0 and v[1] < 0):
                    p, q = q, p
                src.append(p); dst.append(q)
    if not src:
        return None
    src, dst = np.array(src), np.array(dst)
    vecs = dst - src
    near = [np.hypot(*(vecs - v).T) < 6 for v in vecs]
    best = max(near, key=lambda n: n.sum())
    if best.sum() < MIN_VOTES:
        return None
    return vecs[best].mean(axis=0) / sc


def boxes(w, h, dx, dy):
    """Rechtecke der hinteren (a) und vorderen (b) Packung bei Versatz b = a + (dx, dy)."""
    cw, ch = w - dx, h - abs(dy)
    ay = 0 if dy >= 0 else -dy
    return (0, ay, cw, ay + ch), (dx, ay + dy, dx + cw, ay + dy + ch)


def match_rate(rgb, alpha, region, shift):
    """Anteil der Pixel in region, die an der um shift versetzten Stelle gleich aussehen."""
    h, w = alpha.shape
    ys, xs = np.nonzero(region)
    ys2, xs2 = ys + shift[1], xs + shift[0]
    ok = (ys2 >= 0) & (ys2 < h) & (xs2 >= 0) & (xs2 < w)
    ys, xs, ys2, xs2 = ys[ok], xs[ok], ys2[ok], xs2[ok]
    both = (alpha[ys, xs] > 200) & (alpha[ys2, xs2] > 200)
    if both.sum() < 50:
        return 0.0
    d = np.abs(rgb[ys, xs].astype(int) - rgb[ys2, xs2].astype(int)).mean(axis=1)
    return float((d[both] < 30).mean())


def sharpness(rgb, alpha, box):
    x0, y0, x1, y1 = box
    g = cv2.cvtColor(np.ascontiguousarray(rgb[y0:y1, x0:x1]), cv2.COLOR_RGB2GRAY)
    lap = cv2.Laplacian(g, cv2.CV_32F)
    m = alpha[y0:y1, x0:x1] > 200
    # unscharfe Flecken (überdeckte Preisschilder) senken den Mittelwert der lokalen Schärfe
    local = ndimage.uniform_filter(np.abs(lap), 9)
    return float(np.percentile(local[m], 10)) if m.sum() > 50 else 0.0


def single_copy(rgba, shift):
    """Vordere Packung ausschneiden; Reste der hinteren Packung am Rand weg."""
    rgb, alpha = rgba[..., :3], rgba[..., 3]
    h, w = alpha.shape
    dx, dy = int(round(shift[0])), int(round(shift[1]))
    a, b = boxes(w, h, dx, dy)
    in_a = np.zeros((h, w), bool); in_a[a[1]:a[3], a[0]:a[2]] = True
    in_b = np.zeros((h, w), bool); in_b[b[1]:b[3], b[0]:b[2]] = True
    overlap = in_a & in_b
    if overlap.sum() > 0.05 * in_a.sum():
        # Wer vorne liegt, zeigt in der Überlappung seinen eigenen Inhalt:
        # b vorne → Pixel gleichen der Stelle −v (sichtbare hintere Packung), a vorne → der Stelle +v.
        b_front = match_rate(rgb, alpha, overlap, (-dx, -dy)) >= match_rate(rgb, alpha, overlap, (dx, dy))
    else:
        b_front = sharpness(rgb, alpha, b) >= sharpness(rgb, alpha, a)
    front = b if b_front else a
    x0, y0, x1, y1 = front
    out = np.dstack([rgb, alpha])[y0:y1, x0:x1].copy()
    # Reststreifen der hinteren Packung: hinter der Packungskante (gerade Linie) abschneiden
    return cut_at_edge(out, "left" if b_front else "right")


def cut_at_edge(rgba, side):
    """Sucht im äußeren Fünftel der Seite ("left"/"right") eine durchgehende senkrechte
    Kante (die Packungskante) und schneidet alles davor ab."""
    flip = side == "right"
    img = rgba[:, ::-1] if flip else rgba
    g = cv2.cvtColor(np.ascontiguousarray(img[..., :3]), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3))
    opaque = img[..., 3] > 200
    h, w = g.shape
    band = max(3, int(0.2 * w))
    share = ((gx[:, :band] > 60) & opaque[:, :band]).sum(axis=0) / max(1, opaque.any(axis=1).sum())
    share[:2] = 0
    c = int(np.argmax(share))
    if share[c] < 0.35:
        return rgba
    img = img[:, c + 1:]
    return np.ascontiguousarray(img[:, ::-1] if flip else img)


_SESSION = None


def salient_mask(rgba):
    """Freisteller noch einmal auf die eine Packung ansetzen: Reste der Nachbarpackung
    am Rand gehören nicht zum Hauptobjekt und fallen weg."""
    global _SESSION
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from cutout import load_session, mask_for, MODEL

    if _SESSION is None:
        _SESSION = load_session(MODEL)
    h, w = rgba.shape[:2]
    pad = round(0.08 * max(h, w))
    canvas = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (255, 255, 255, 255))
    canvas.alpha_composite(Image.fromarray(rgba, "RGBA"), (pad, pad))
    m = mask_for(_SESSION, canvas.convert("RGB"))[pad:pad + h, pad:pad + w]
    return m


def clean_edge(rgba):
    """Nur das Hauptobjekt behalten, Löcher schließen, 1 px Saum weg, weiche Kante."""
    a = rgba[..., 3]
    solid = a > 128
    lab, n = ndimage.label(solid)
    if n == 0:
        return rgba
    sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= sizes.max() * 0.08
    solid = ndimage.binary_fill_holes(keep[lab])
    # schmale Fortsätze (Reste, Schild-Ecken) abschneiden
    k = max(3, round(min(a.shape) * 0.012)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    opened = cv2.morphologyEx(solid.astype(np.uint8), cv2.MORPH_OPEN, kernel).astype(bool)
    lab, n = ndimage.label(opened)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
        opened = lab == (1 + int(np.argmax(sizes)))
    core = ndimage.binary_erosion(opened, iterations=1)
    soft = cv2.GaussianBlur(core.astype(np.float32), (0, 0), 0.8)
    out = rgba.copy()
    out[..., 3] = (np.minimum(soft, a / 255.0) * 255).astype(np.uint8)
    # Farbe an der Kante nach innen ziehen (kein heller/dunkler Saum vom alten Hintergrund)
    inner = cv2.erode(core.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    _, idx = ndimage.distance_transform_edt(~inner, return_indices=True)
    ring = (out[..., 3] > 0) & ~inner
    out[..., :3][ring] = rgba[..., :3][idx[0][ring], idx[1][ring]]
    return out


def trim_save(rgba, out):
    ys, xs = np.nonzero(rgba[..., 3] > 8)
    rgba = rgba[max(0, ys.min() - 2):ys.max() + 3, max(0, xs.min() - 2):xs.max() + 3]
    img = Image.fromarray(rgba, "RGBA")
    if max(img.size) > MAX_SIDE:
        s = MAX_SIDE / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    img.save(out, optimize=True)
    return img.size


def run(job):
    rgba = np.array(Image.open(job["image"]).convert("RGBA"))
    ys, xs = np.nonzero(rgba[..., 3] > 8)
    if len(xs) == 0:
        return {"out": job["out"], "ok": False, "error": "leer"}
    rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    # Nur eine Runde: Muster innerhalb einer Packung sind keine zweite Packung
    copies, shift = 1, None
    found = find_shift(rgba)
    if found is not None and found[0] < rgba.shape[1] - 8 and abs(found[1]) < rgba.shape[0] - 8:
        shift = [round(float(found[0]), 1), round(float(found[1]), 1)]
        rgba = single_copy(rgba, found)
        rgba[..., 3] = np.minimum(rgba[..., 3], salient_mask(rgba))
        copies = 2
    w, h = trim_save(clean_edge(rgba), job["out"])
    return {"out": job["out"], "ok": True, "copies": copies, "shift": shift, "width": w, "height": h}


def main():
    for job in json.load(sys.stdin):
        try:
            res = run(job)
        except Exception as e:  # ein kaputtes Bild hält die anderen nicht auf
            res = {"out": job.get("out"), "ok": False, "error": str(e)}
        print(json.dumps(res), flush=True)


if __name__ == "__main__":
    main()
