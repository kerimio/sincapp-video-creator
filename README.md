# sincapp Story-Generator

Prospekt rein, Instagram-Story (MP4, 1080×1920) raus.

> Stand: **Meilenstein 4** – Template + MP4 (M1), Extraktion + Freisteller (M2), Produktbilder aus dem Internet mit Bibliothek, Auswahl und Review-Oberfläche (M3), Web-App mit Assistent und `new`-Befehl (M4).

## Schnellstart auf dem Mac (Web-App)

1. Ordner von GitHub holen: `git clone https://github.com/kerimio/sincapp-video-creator.git` (oder als ZIP laden und entpacken).
2. Im Finder **`Start sincapp.command`** doppelklicken. Beim ersten Mal wird alles installiert (Homebrew muss vorhanden sein, siehe https://brew.sh; dauert 5–10 Minuten), danach öffnet sich der Browser.
   Bei einem ZIP-Download meldet macOS evtl. „nicht verifizierter Entwickler“: einmal Rechtsklick → **Öffnen**.
3. In der App unter **Einstellungen** den Anthropic-Key eintragen (Brave-Key empfohlen). Die Keys bleiben in der Datei `.env` auf dem Rechner.
4. **+ Neues Video** → Markt wählen → Prospektseiten hineinziehen → Thema und Anzahl → **Weiter**. Nach dem Auslesen die Angebote prüfen und **Video erstellen** klicken; die MP4s (DE + TR) gibt es dann zum Herunterladen.

Ohne Key lässt sich alles mit **Demo mit Saray-Beispiel** ausprobieren (gespeicherte Antworten statt Claude).
Das Terminalfenster muss offen bleiben, solange die App läuft. Jobs liegen unter `jobs/`, die Produkt-Bibliothek unter `library/`.

Ohne Doppelklick: `pnpm cli app` (Port mit `--port`, Browser nicht öffnen mit `--no-open`).

## Alles in einem Befehl

```bash
./bin/sincapp-story.mjs new --market saray --input ~/Downloads/prospekt/ --topic fleisch --count 6
# → jobs/<datum>-saray-fleisch/story.json, danach in der App prüfen
./bin/sincapp-story.mjs new --market saray --input ~/Downloads/prospekt/ --auto
# → ohne Prüfen direkt output/story-de.mp4 und story-tr.mp4
```

## Setup (Entwicklung)

Voraussetzungen: Node 20.12+, pnpm, ffmpeg (`brew install ffmpeg`), Python 3.10+.

```bash
pnpm install
pnpm exec playwright install chromium   # einmalig
pnpm setup:python                       # einmalig: .venv mit rembg (Freisteller) und PDF-Unterstützung
pnpm build:template
cp .env.example .env                    # ANTHROPIC_API_KEY eintragen, optional BRAVE_API_KEY und REMOVEBG_API_KEY
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
Fehler einzelner Seiten oder Bilder landen in `report.md`, der Lauf läuft weiter.

Optionen: `--no-price-check`, `--images` (gleich alle Bilder holen), `--recorded <ordner>` (gespeicherte Antworten statt Claude), `--eval <ground-truth.json>`.

## Auswahl und Produktbilder (Meilenstein 3)

```bash
./bin/sincapp-story.mjs select saray-kw44 --market saray            # 8 Angebote, gemischt
./bin/sincapp-story.mjs select saray-kw44 --market saray --topic fleisch --count 6
```

- **Auswahl:** Angebote ohne Preis und Dubletten fallen raus, sichere Preise und saubere Bilder zuerst, dann reihum aus den Warengruppen. Themen (`fleisch`, `snacks`, `vorrat`, `getraenke`, `frische`, `milch`, `haushalt`) filtern und setzen die passende Überschrift.
- **Produktbilder**, in dieser Reihenfolge:
  1. **Bibliothek** (`library/`, Ort änderbar mit `SINCAPP_LIBRARY`): einmal gefundene Produkte werden wiederverwendet – gleiche Marke, gleicher Name (DE oder TR), gleiche Menge.
  2. **Internet:** Bildersuche mit Marke + Name + Menge über die Brave Search API (`BRAVE_API_KEY`) und Open Food Facts. Claude vergleicht jeden Treffer mit dem Prospekt-Ausschnitt (gleiches Produkt, gleiche Sorte, sauberes Foto). Nur ein bestätigter Treffer wird genommen, freigestellt (oder vorhandene Transparenz übernommen) und in der Bibliothek gespeichert.
  3. **Prospekt-Ausschnitt** als Notlösung.
- Ergebnis: `story.json`, Bilder in `images/`, Hinweise in `report.md`.

## Prüfen (Review)

In der Web-App öffnet sich das Prüfen nach dem Auslesen automatisch. Einzelne Job-Ordner gehen auch direkt:

```bash
pnpm review saray-kw44        # einzelner Job ohne App: http://127.0.0.1:4321/review/#/review
```

- Angebote hinzufügen/entfernen, per Ziehen sortieren, Preis, Menge, Namen (DE/TR, mit 14-Zeichen-Zähler), Zusatz und Zoom ändern.
- Überschrift, Zeile darüber und Gültigkeit ändern.
- **Bild ändern:** Internet-Treffer (mit Urteil des Abgleichs) übernehmen oder neu suchen, im Prospekt ein Rechteck ziehen und neu ausschneiden, oder ein eigenes Foto hochladen. Jede Wahl landet in der Bibliothek.
- Live-Vorschau in DE/TR mit Abspielen und Zeitleiste, Hinweise zu unsicheren Preisen und Bildern.
- **Video erstellen** speichert und erzeugt `output/story-de.mp4`, `story-tr.mp4`, `preview.png` inkl. Prüfung.

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
