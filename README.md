# sincapp Story-Generator

Prospekt rein, Instagram-Story (MP4, 1080×1920) raus.

> Stand: **Meilenstein 7** – Template + MP4 (M1), Extraktion + Freisteller (M2), Produktbilder und Auswahl (M3), Web-App (M4), Studio mit Design und Export (M5), Produkt-Katalog (M6), Kampagne aus dem Katalog mit Bestpreis (M7).
>
> Für Entwickler und KI-Assistenten: Aufbau, Regeln und Konventionen stehen in [`AGENTS.md`](AGENTS.md).

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

Ein Video entsteht in vier Schritten: **Angebote** prüfen → **Design** wählen → **Export** → **Teilen** auf Instagram.

- **Neues Video:** Markt wählen, ein oder mehrere Prospekte anhaken. Aus allen Prospekten kommen automatisch die wichtigsten Angebote ins Video, nach festem Konzept: **halb Fleisch** (frisches Fleisch vor Wurst), **halb Preis-Knaller** aus dem Grundbedarf (verschiedene Warengruppen, Nischen wie Oliven, Gewürze oder Haushalt nur zur Not). Was vorn im Prospekt steht, zählt am meisten (Titelseite, Seite 2 …, die hinteren Seiten kaum); dazu groß abgebildet, in Firestore gepflegt und „günstig im Vergleich“ (Grundpreis gegen die anderen Angebote der Woche, günstiger als bei anderen Märkten). Alles ohne KI.
- **Design:** 9 Vorlagen (sincapp Marke – Standard für neue Videos, genau nach dem Design System; Klassik, Frisch, Premium, Knallig, Minimal, Black Week, Bayram, Sommer), Sticker pro Angebot, Laufband, alle Farben einzeln oder „Farben aus dem Markt-Logo“, Hintergrund (Logo, Punkte, Verlauf, schlicht), Preis (Etikett, Kreis, flach), Effekte (Einflug, Seitenwechsel, Tempo, Wippen). „Als Standard für <Markt> speichern“ – neue Videos dieses Markts starten dann damit. Eigenes Logo pro Markt hochladbar.
- **Formate:** Story 9:16, Feed 4:5, Quadrat 1:1, jedes Angebot einzeln als Bild. Die Vorschau rechts schaltet zwischen allen um.
- **Export:** Pakete („Wochenpaket“, „Nur Story“, „Feed-Beitrag“, „Nur Bilder“) oder frei wählbar; Instagram-Texte mit Hashtags (DE/TR); alles als ZIP. Das Rendern selbst kostet keine KI-Tokens.
- **Prüfung nach dem Export:** Feste Regeln (Produkt doppelt, Bild fehlt, Preis 0, Datum vorbei, Markt mit sehr wenigen Angeboten) und ein KI-Blick auf alle Seiten in DE und TR (Foto passt nicht zum Namen, Preis unplausibel, Text abgeschnitten, falsche Sprache). Ein KI-Aufruf pro Video mit 512-px-Bildern, Bruchteile eines Cents; ein unverändertes Video wird nicht noch einmal geprüft. Jedes Produktbild wird zusätzlich einzeln geprüft: lokal ohne KI auf lose Flecken, Schnittkanten, Löcher und ausgefranste Ränder, und von der KI auf Reste von Preisschild, Schrift, Brett oder Nachbarprodukt. Ergebnis unter dem Export und in `output/pruefung.json`.
- **Glossar** (eigene Seite in der App): feste Produktnamen DE/TR, egal wie der Prospekt schreibt – „Rinderhackfleisch-Mischung (Gemischtes Hackfleisch)“ wird „Gemischtes Hack“ / „Karışık Kıyma“. Grundbestand für frisches Fleisch ist eingebaut, eigene Einträge liegen in `library/glossar.json`.
- **Einheitliche Namen für alle Produkte** (MARKE + PRODUKTART): Marken werden zusammengeführt („Mevlâna Çay“, „Mevlana“, „Goran-Tee“ → „Mevlana“), steht ein Produkt im Katalog, heißt es wie dort. Jede neue Schreibweise geht einmal an die KI (nur Text, günstiges Modell, bekannte Namen als Vorlage) und wird in `library/namen.json` gemerkt – „Ceylon Tee“ und „Sade Yaprak Çay“ heißen danach immer „Schwarztee“. Das Glossar gewinnt immer; im Glossar heißt `tee+cay` „beide Wörter“, `-grüner` „nicht, wenn das Wort vorkommt“.
- **Bild aus dem Prospekt:** Rechteck ziehen oder mit dem Pen umranden – der Ausschnitt wird so übernommen, wie er ist. Hintergrund nur auf Wunsch entfernen.

**Teilen auf Instagram** (Schritt 4, Business- oder Creator-Konto):

- **Story, Reel oder Beitrag** (Bild, Video oder Karussell bis 10) aus den fertigen Dateien wählen, Sprache DE/TR.
- **Text:** Vorschlag aus dem Export (Wochentext, Text zum Angebot oder Text des Plantags), frei änderbar. Storys haben keinen Text.
- **Märkte markieren:** Instagram-Namen kommen aus sincapp (Firestore); bei mehreren Märkten nur der Markt des gezeigten Angebots. Weitere Konten von Hand. Markierte Märkte stehen zusätzlich als @Name im Text.
- **Jetzt teilen oder einplanen** (Datum + Uhrzeit). „7-Tage-Plan einplanen“ legt mit einem Klick für jeden Tag Reel und/oder Story zur gleichen Uhrzeit an, inkl. „Letzte Chance“.
- Instagram kann über die Schnittstelle nicht selbst planen: Die App teilt zum Termin und muss dafür laufen. War sie aus, holt sie bis zu 3 Stunden nach, danach steht der Beitrag als „verpasst“ da.
- Einrichtung einmalig in Einstellungen → Instagram (Zugangs-Token aus einer eigenen Meta-App, Anleitung in der App). Der Token liegt in `.env` und wird täglich verlängert.
- Instagram lädt Dateien nur von einer öffentlichen Adresse. Dafür öffnet die App beim Teilen kurz einen Cloudflare-Schnelltunnel (`cloudflared`, ohne Konto; wird beim ersten Mal nach `.tools/` geladen), der nur diese Dateien unter einem Zufallspfad zeigt. Bilder gehen als JPEG raus, Videos bekommen eine stille Tonspur.

**Zaubern (ohne Zwischenschritte):**

- **✨ Zauberknopf** beim neuen Video: Prospekt lesen → beste Angebote → Produktbilder → komplettes Paket, in einem Klick. Nutzt das gespeicherte Design des Markts. Danach lässt sich trotzdem alles ändern und neu exportieren.
- **📅 7-Tage-Plan:** Jeden Tag ein Top-Angebot als Reel, Bild (4:5) und Text, im ZIP nach Tagen sortiert (`plan/01-mittwoch-29-10/…`) mit `wochenplan.txt` als Übersicht.
- **⏰ „Letzte Chance“-Videos** (8 s, 9:16): „Noch 2 Tage!“ und „Nur noch heute!“ mit Countdown-Ring und den drei Top-Angeboten; im Plan liegen sie auf den passenden Tagen.
- **QR-Code am Schluss** (Design → QR-Code): Route zum Markt (Google Maps), Instagram oder eigener Link – für Laden-Bildschirm, Schaufenster und Ausdrucke.

**Kosten sparen** (alles Standard, nichts einzustellen):

- Günstigste Modelle: Gemini Flash liest die Seiten (`GEMINI_MODEL`), Preis-Gegencheck und Fotovergleich mit minimalem „Nachdenken“; bei Claude Sonnet statt Opus und Haiku für die Checks. Sind beide Keys da, wird Gemini genommen.
- Jede Seite wird nur einmal bezahlt (`.cache/ki`, auch nach einem Modellwechsel). Seiten ohne Produkte (laut Firestore-Fundstellen) werden übersprungen, der Zeitraum kommt aus Firestore.
- Kaputte KI-Antworten werden höchstens einmal neu angefragt; Fotos werden vor dem Vergleich auf 512 px verkleinert.
- Bildersuche (Brave) 30 Tage gemerkt; die Produkt-Bibliothek verhindert doppelte Suchen.
- Firestore: nur Prospekte der letzten 3 Wochen werden gelesen, Listen (15 min / 6 h) und Vorschaubilder liegen auf der Platte. „↻“ beim neuen Video lädt sofort frisch.
- Einstellungen → „KI-Verbrauch“ zeigt die bezahlten Aufrufe und Tokens des Monats (`.cache/ki/verbrauch.jsonl`).
- Der Export (Videos, Reels, Bilder, Texte) kostet keine KI; nur die Prüfung danach (ein Aufruf pro Video, gemerkt).

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
3. **Preis-Gegencheck:** Jedes Preisschild wird einzeln ausgeschnitten und noch einmal gelesen. Nur wenn beide Lesungen übereinstimmen, gilt der Preis als sicher (`priceConfidence` 0.98), sonst < 0.9 und ein Hinweis im Bericht. In der Web-App passiert das erst nach einer Vorauswahl mit Reserve (bei 8 Angeboten 12 Schilder statt aller 180 eines dicken Prospekts); die Seiten selbst werden zu viert gleichzeitig gelesen.
4. Normalisierung: Preis „13,99“, Menge getrennt („5×140 g“), türkischer Name auf max. 2 × 14 Zeichen (sonst gekürzt + Hinweis), doppelte Angebote zusammengefasst.
5. Freisteller lokal mit rembg (`birefnet-general-lite`, Rückfall `isnet-general-use`): Preisschilder werden vorher entfernt und die verdeckte Stelle aufgefüllt, Inseln entfernt, Rand geprüft (≥ 90 % transparent), Schachbrett-Fakes erkannt. Klappt es lokal nicht und `REMOVEBG_API_KEY` ist gesetzt, übernimmt remove.bg.
Fehler einzelner Seiten oder Bilder landen in `report.md`, der Lauf läuft weiter.

Optionen: `--no-price-check`, `--images` (gleich alle Bilder holen), `--recorded <ordner>` (gespeicherte Antworten statt Claude), `--eval <ground-truth.json>`.

## Auswahl und Produktbilder (Meilenstein 3)

```bash
./bin/sincapp-story.mjs select saray-kw44 --market saray            # 8 Angebote, gemischt
./bin/sincapp-story.mjs select saray-kw44 --market saray --topic fleisch --count 6
```

- **Mehrere Märkte:** Beim neuen Video lassen sich Prospekte verschiedener Märkte zusammen wählen (nacheinander die Märkte antippen). Daraus wird ein sincapp-Video: Im Intro stehen die Logos aller Märkte als Kacheln, danach bekommt jeder Markt eine Seite mit Logo, Adresse und seinem eigenen Zeitraum (aus seinem Prospekt): oben 2× frisches Fleisch groß nebeneinander, darunter 3 weitere Angebote klein nebeneinander. Jeder Markt kommt rein, ohne Obergrenze; Märkte werden nicht untereinander verglichen. Wurst und Sucuk werden nicht bevorzugt. Gleiche Produkte kommen nur beim günstigsten Markt rein. Logos werden lokal zugeschnitten (`tools/logo.py`).
- **Auswahl:** Angebote ohne Preis und Dubletten fallen raus, sichere Preise und saubere Bilder zuerst. Fleisch und Wurst kommen immer vorn in die Story, der Rest reihum aus den Warengruppen. Die Marke steht im Produktnamen, wenn alles in 2 Zeilen passt („Egetürk Sırma / Knoblauchwurst“). Themen (`fleisch`, `snacks`, `vorrat`, `getraenke`, `frische`, `milch`, `haushalt`) filtern und setzen die passende Überschrift.
- **Produktbilder**, in dieser Reihenfolge:
  1. **Produkt-Katalog** (`library/`, Ort änderbar mit `SINCAPP_LIBRARY`): einmal gefundene Produkte werden wiederverwendet – gleiche Marke, gleicher Name (DE oder TR), gleiche Menge. Eigene Bilder gehen vor Internet-Fotos, beide werden ohne Suche und ohne KI genommen. Liegt nur ein Prospekt-Ausschnitt vor, wird einmal im Internet gesucht; ohne Treffer merkt sich der Katalog das.
  2. **Internet:** Bildersuche mit Marke + Name + Menge über die Brave Search API (`BRAVE_API_KEY`) und Open Food Facts. Claude vergleicht jeden Treffer mit dem Prospekt-Ausschnitt (gleiches Produkt, gleiche Sorte, sauberes Foto). Nur ein bestätigter Treffer wird genommen, freigestellt (oder vorhandene Transparenz übernommen) und in der Bibliothek gespeichert.
  3. **Prospekt-Ausschnitt** als Notlösung. In den Katalog kommt davon genau eine Packung: `tools/single.py` erkennt doppelt abgebildete Packungen (SIFT-Merkmale mit gleichem Versatz), nimmt die vordere und räumt die Kante auf – lokal, kostenlos. Im Katalog verbessert „Bilder verbessern“ alle Prospekt-Bilder auf einmal (erst Internet, dann Zuschnitt).
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

## Produkt-Katalog und Kampagnen (Meilenstein 6 und 7)

- **Katalog** (Web-App → Katalog): jedes Produkt genau einmal, mit Marke, Namen DE/TR, Sorte, Menge, Grundpreis, Warengruppe, EAN und allen Prospekt-Preisen („gesehen bei Saray für 3,79 €“). Bildquelle: eigenes Bild > Internet > Prospekt; ein schlechteres Bild ersetzt nie ein besseres.
- **Bilder verbessern:** sucht für alle Prospekt-Bilder einmal im Internet und schneidet sonst genau eine Packung sauber zu. „Eigenes Bild“ lädt ein Foto hoch und stellt es frei.
- **Kampagne aus dem Katalog:** im Katalog „Kampagne“ antippen, Produkte wählen, Markt, Zeitraum und Preise eintragen, dann „Erst prüfen“ oder „🐿 Zauberknopf“ (gleich alle Videos). Braucht keinen Prospekt und keine KI.
- **Bester Preis:** liegt der neue Preis unter allen Prospekt-Preisen der letzten mindestens 4 Wochen, bekommt das Angebot den Sticker „Bester Preis seit X Wochen“ (auch im Bildtext). Läuft ohne KI, aus den bisherigen Jobs.

## Datenmodell

- `markets/<slug>.json` – Markt: `name`, `slug`, `logo` (Pfad relativ zu `markets/`), optional `logoCrop {w,h,offsetX,offsetY}`, `instagram`, `addresses` (1–3), optional `theme.pages` (`red`/`nut`).
- `story.json` – alles, was im Video steht: `market`, `lang`, `dates {from,to}`, `headline {de[],tr[]}`, optional `eyebrow`, `offers[]` (`img`, `price` „13,99“, `unit`, `name {de[2],tr[2]}`, `note`, `imgZoom`, optional `badge` (Sticker) und `bestWeeks` (Bestpreis seit X Wochen)), optional `pages`, `appScreenshot`, `scenes {intro,page,cta}`.
- `library/index.json` – Produkt-Katalog: pro Eintrag `img`, `brand`, `name {de,tr}`, `unit`, `category`, `source {type: manual|web|openfoodfacts|prospekt}`, `verified`, `seen[]` (Prospekt-Preise), optional `webTried` (Internet schon versucht), `single` (Packung zugeschnitten); Bilder als PNG daneben.
- Schemas: `src/core/schema.ts` (zod), exportiert nach `schemas/*.schema.json` (`pnpm schemas`).

Seitenaufteilung automatisch: 3 oder 2 Angebote pro Seite, nie 1 (5 = 3+2, 7 = 3+2+2, 8 = 3+3+2).

## Qualität

```bash
pnpm test             # Unit-Tests (inkl. Form der Claude-Anfrage gegen eine Fake-API)
pnpm diff:reference   # Pixelvergleich gegen die Original-Referenz (reference/)
```

Der Pixelvergleich rendert `reference/story-saray.jsx` mit der Original-Engine und unser Template mit denselben Daten (`test/fixtures/reference-job`) und vergleicht alle 0,25 s. Ergebnis landet in `tmp/diff/report.md`.
