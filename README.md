# sincapp Story-Generator

Prospekt rein, Instagram-Story (MP4, 1080×1920) raus.

> Stand: **Meilenstein 2** – Story-Template + MP4-Export (M1), Extraktion mit Claude Vision und Freisteller (M2).
> Auswahl, Review-UI und der komplette `new`-Ablauf folgen in Meilenstein 3–4.

## Setup

Voraussetzungen: Node 20.12+, pnpm, ffmpeg (`brew install ffmpeg`), Python 3.10+.

```bash
pnpm install
pnpm exec playwright install chromium   # einmalig
pnpm setup:python                       # einmalig: .venv mit rembg (Freisteller) und PDF-Unterstützung
pnpm build:template
cp .env.example .env                    # ANTHROPIC_API_KEY eintragen, optional REMOVEBG_API_KEY
```

Die Freisteller-Modelle (ca. 220 MB) lädt rembg beim ersten Lauf nach `~/.u2net`.

## Story rendern

```bash
./bin/sincapp-story.mjs render test/fixtures/reference-job
# → test/fixtures/reference-job/output/story-de.mp4, story-tr.mp4, preview.png
```

Ein Job ist ein Ordner mit `story.json` und den Bildern, auf die sie verweist.
Jobs unter `jobs/<name>/` können auch nur mit Namen aufgerufen werden.

## Prospekt auslesen (Meilenstein 2)

```bash
mkdir -p jobs/saray-kw44/input && cp ~/Downloads/prospekt/*.{jpg,png,pdf} jobs/saray-kw44/input/
./bin/sincapp-story.mjs extract saray-kw44
# → jobs/saray-kw44/extraction.json, report.md, images/<id>.png
```

Ablauf je Seite:
1. PDF-Seiten werden zu PNG, große Bilder auf 2000 px verkleinert (`tools/prep.py`).
2. Claude (`claude-opus-5-5`, Structured Output) liest Marke, Name DE/TR, Menge, Preis, Zusatz, Warengruppe, Bildausschnitt, Preisschild, Gültigkeit, Markt und Adressen.
3. **Preis-Gegencheck:** Jedes Preisschild wird einzeln ausgeschnitten und noch einmal gelesen. Nur wenn beide Lesungen übereinstimmen, gilt der Preis als sicher (`priceConfidence` 0.98), sonst < 0.9 und ein Hinweis im Bericht.
4. Normalisierung: Preis „13,99“, Menge getrennt („5×140 g“), türkischer Name auf max. 2 × 14 Zeichen (sonst gekürzt + Hinweis), doppelte Angebote zusammengefasst.
5. Freisteller lokal mit rembg (`birefnet-general-lite`, Rückfall `isnet-general-use`): Preisschilder werden vorher entfernt und die verdeckte Stelle aufgefüllt, Inseln entfernt, Rand geprüft (≥ 90 % transparent), Schachbrett-Fakes erkannt. Klappt es lokal nicht und `REMOVEBG_API_KEY` ist gesetzt, übernimmt remove.bg.
6. Internet-Bilder: Open Food Facts liefert bis zu 3 Alternativen je Angebot (`imgAlternatives`), Auswahl später im Review.

Fehler einzelner Seiten oder Bilder landen in `report.md`, der Lauf läuft weiter.

Optionen: `--no-price-check`, `--no-cutout`, `--no-internet`, `--recorded <ordner>` (gespeicherte Antworten statt Claude), `--eval <ground-truth.json>`.

Abnahme gegen die 6 Saray-Beispielseiten (≥ 95 % erkannt, keine falschen Preise ohne Markierung, Zeitraum erkannt):

```bash
pnpm eval:saray              # echter Lauf mit Claude
pnpm eval:saray --recorded   # offline mit handannotierten Antworten (prüft nur die Pipeline)
```

## Datenmodell

- `markets/<slug>.json` – Markt: `name`, `slug`, `logo` (Pfad relativ zu `markets/`), optional `logoCrop {w,h,offsetX,offsetY}`, `instagram`, `addresses` (1–3), optional `theme.pages` (`red`/`nut`).
- `story.json` – alles, was im Video steht: `market`, `lang`, `dates {from,to}`, `headline {de[],tr[]}`, optional `eyebrow`, `offers[]` (`img`, `price` „13,99“, `unit`, `name {de[2],tr[2]}`, `note`, `imgZoom`), optional `pages`, `appScreenshot`, `scenes {intro,page,cta}`.
- Schemas: `src/core/schema.ts` (zod), exportiert nach `schemas/*.schema.json` (`pnpm schemas`).

Seitenaufteilung automatisch: 3 oder 2 Angebote pro Seite, nie 1 (5 = 3+2, 7 = 3+2+2, 8 = 3+3+2).

## Qualität

```bash
pnpm test             # Unit-Tests (inkl. Form der Claude-Anfrage gegen eine Fake-API)
pnpm diff:reference   # Pixelvergleich gegen die Original-Referenz (reference/)
```

Der Pixelvergleich rendert `reference/story-saray.jsx` mit der Original-Engine und unser Template mit denselben Daten (`test/fixtures/reference-job`) und vergleicht alle 0,25 s. Ergebnis landet in `tmp/diff/report.md`.
