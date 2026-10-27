"""Bereitet Prospektseiten vor: PDF → PNG (eine Datei pro Seite), Bilder
werden nach PNG gewandelt und auf max. 2000 px Kantenlänge verkleinert.

Aufruf: prep.py <ausgabeordner> <datei> [<datei> ...]
Ausgabe (stdout, JSON): [{"source": ..., "page": 1, "file": ..., "width": .., "height": ..}]
"""

import json
import os
import sys

from PIL import Image, ImageOps

MAX_SIDE = 2000


def save(img, out):
    img = ImageOps.exif_transpose(img).convert("RGB")
    if max(img.size) > MAX_SIDE:
        s = MAX_SIDE / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    img.save(out, optimize=True)
    return img.size


def main():
    out_dir, files = sys.argv[1], sys.argv[2:]
    os.makedirs(out_dir, exist_ok=True)
    pages = []
    for f in files:
        stem = os.path.splitext(os.path.basename(f))[0]
        if f.lower().endswith(".pdf"):
            import pypdfium2 as pdfium

            pdf = pdfium.PdfDocument(f)
            for i in range(len(pdf)):
                page = pdf[i]
                scale = MAX_SIDE / max(page.get_size())
                img = page.render(scale=scale).to_pil()
                out = os.path.join(out_dir, f"{stem}-s{i + 1}.png")
                w, h = save(img, out)
                pages.append({"source": f, "page": i + 1, "file": out, "width": w, "height": h})
        else:
            out = os.path.join(out_dir, f"{stem}.png")
            w, h = save(Image.open(f), out)
            pages.append({"source": f, "page": 1, "file": out, "width": w, "height": h})
    print(json.dumps(pages, ensure_ascii=False))


if __name__ == "__main__":
    main()
