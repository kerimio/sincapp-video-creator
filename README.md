# sincapp Story-Generator

Prospekt rein, Instagram-Story (MP4, 1080×1920) raus.

> Stand: **Meilenstein 4** – Template + MP4 (M1), Extraktion + Freisteller (M2), Produktbilder aus dem Internet mit Bibliothek, Auswahl und Review-Oberfläche (M3), Web-App mit Assistent und `new`-Befehl (M4).

## Schnellstart auf dem Mac (Web-App)

1. Ordner von GitHub holen: `git clone https://github.com/kerimio/sincapp-video-creator.git` (oder als ZIP laden und entpacken).
2. Im Finder **`Start sincapp.command`** doppelklicken. Beim ersten Mal wird alles installiert (Homebrew muss vorhanden sein, siehe https://brew.sh; dauert 5–10 Minuten), danach öffnet sich der Browser.
   Bei einem ZIP-Download meldet macOS evtl. „nicht verifizierter Entwickler“: einmal Rechtsklick → **Öffnen**.
3. In der App unter **Einstellungen** einen KI-Key eintragen – Anthropic **oder** Google Gemini – und den Brave-Key (empfohlen). Die Keys bleiben in der Datei `.env` auf dem Rechner.
4. **+ Neues Video** → Markt aus Firestore wählen → aktuellen Prospekt anklicken (oder eigene Dateien hochladen) → Thema und Anzahl → **Weiter**. Nach dem Auslesen die Angebote prüfen und **Video erstellen** klicken; die MP4s (DE + TR) gibt es dann zum Herunterladen.

Ohne Key lässt sich alles mit **Demo mit Saray-Beispiel** ausprobieren (gespeicherte Antworten statt Claude).
Das Terminalfenster muss offen bleiben, solange die App läuft. Jobs liegen unter `jobs/`, die Produkt-Bibliothek unter `library/`.

Ohne Doppelklick: `pnpm cli app` (Port mit `--port`, Browser nicht öffnen mit `--no-open`).

## Daten aus Firestore

Märkte (Name, Adresse, Logo, Instagram) und Prospekte (Seiten, Gültigkeit) kommen direkt aus der sincapp-Firestore-Datenbank (Projekt `trprosp`, änderbar mit `SINCAPP_FIREBASE_PROJECT`, z. B. `sincapp-dev`). `markets` und `prospects` sind öffentlich lesbar – es braucht weder Login noch Key, und das Tool schreibt nie etwas zurück. Ein gewählter Markt wird unter `.cache/markets/` abgelegt, damit Story und Video ihn wie eine lokale Markt-Datei nutzen.

## Studio: Design, Formate, Export (Meilenstein 5)

Ein Video entsteht in drei Schritten: **Angebote** prüfen → **Design** wählen → **Export**.

- **Neues Video:** Markt wählen, ein oder mehrere Prospekte anhaken. Aus allen Prospekten kommen automatisch die besten Angebote ins Video (groß abgebildete Angebote und in Firestore gepflegte Produkte zuerst).
- **Design:** 8 Vorlagen (Klassik, Frisch, Premium, Knallig, Minimal, Black Week, Bayram, Sommer), Sticker pro Angebot, Laufband, alle Farben einzeln oder „Farben aus dem Markt-Logo“, Hintergrund (Logo, Punkte, Verlauf, schlicht), Preis (Etikett, Kreis, flach), Effekte (Einflug, Seitenwechsel, Tempo, Wippen). „Als Standard für <Markt> speichern“ – neue Videos dieses Markts starten dann damit. Eigenes Logo pro Markt hochladbar.
- **Formate:** Story 9:16, Feed 4:5, Quadrat 1:1, jedes Angebot einzeln als Bild. Die Vorschau rechts schaltet zwischen allen um.
- **Export:** Pakete („Wochenpaket“, „Nur Story“, „Feed-Beitrag“, „Nur Bilder“) oder frei wählbar; Instagram-Texte mit Hashtags (DE/TR); alles als ZIP. Der Export kostet keine KI-Tokens.
- **Bild aus dem Prospekt:** Rechteck ziehen oder mit dem Pen umranden – der Ausschnitt wird so übernommen, wie er ist. Hintergrund nur auf Wunsch entfernen.

**Zaubern (ohne Zwischenschritte):**

- **✨ Zauberknopf** beim neuen Video: Prospekt lesen → beste Angebote → Produktbilder → komplettes Paket, in einem Klick. Nutzt das gespeicherte Design des Markts. Danach lässt sich trotzdem alles ändern und neu exportieren.
- **📅 7-Tage-Plan:** Jeden Tag ein Top-Angebot als Reel, Bild (4:5) und Text, im ZIP nach Tagen sortiert (`plan/01-mittwoch-29-10/…`) mit `wochenplan.txt` als Übersicht.
- **⏰ „Letzte Chance“-Videos** (8 s, 9:16): „Noch 2 Tage!“ und „Nur noch heute!“ mit Countdown-Ring und den drei Top-Angeboten; im Plan liegen sie auf den passenden Tagen.
- **QR-Code am Schluss** (Design → QR-Code): Route zum Markt (Google Maps), Instagram oder eigener Link – für Laden-Bildschirm, Schaufenster und Ausdrucke.

**Kosten sparen:** KI-Antworten werden pro Seite gemerkt (`.cache/ki`), dieselbe Seite wird nie zweimal bezahlt. Seiten ohne Produkte (laut Firestore-Fundstellen) werden übersprungen, der Zeitraum kommt aus Firestore. Preis-Gegencheck und Bildvergleich laufen mit dem günstigeren Modell (`GEMINI_CHECK_MODEL`, Standard `gemini-3.8-flash`).

Vorschau aller Vorlagen und Formate: `pnpm tsx tools/preview-designs.ts` (Bilder in `tmp/designs`; `--extras` für Sticker/Laufband/Reels, `--magic` für Countdown und QR-Code).

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
cp .env.example .env                    # ANTHROPIC_API_KEY oder GEMINI_API_KEY eintragen, optional BRAVE_API_KEY und REMOVEBG_API_KEY
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
2. Claude (`claude-opus-5-5`) oder Gemini (`gemini-4-argon`, änderbar mit `GEMINI_MODEL`) – je nachdem, welcher Key da ist; bei beiden Claude, außer `SINCAPP_AI=gemini` – liest per Structured Output Marke, Name DE/TR, Menge, Preis, Zusatz, Warengruppe, Bildausschnitt, Preisschild, Gültigkeit, Markt und Adressen.
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
