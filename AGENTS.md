# AGENTS.md – Leitfaden für KI-Assistenten (und neue Entwickler)

sincapp Story-Generator: Supermarkt-Prospekte (aus Firestore oder hochgeladen) rein, Instagram-Videos, Reels, Bilder und Texte in **Deutsch und Türkisch** raus. Nutzer ist ein Marketing-Mensch ohne Programmierkenntnisse; er bedient alles über die Web-App.

Für Bedienung und Funktionsumfang siehe `README.md`. Diese Datei beschreibt, **wie der Code gebaut ist und welche Regeln gelten**.

## Befehle

```bash
pnpm install && pnpm setup:python   # Node 22 + Python-venv (.venv: PIL, rembg, OpenCV)
pnpm typecheck                      # tsc, strikt, keine unbenutzten Variablen
pnpm test                           # vitest (~4 min, einige Tests brauchen Python + Chromium)
pnpm vitest run test/catalog.test.ts   # einzelne Datei
pnpm diff:reference                 # Pixelvergleich Klassik-Vorlage gegen reference/ – muss 0,00 % bleiben
pnpm build:review                   # Web-App (src/review/ui) nach dist/review
pnpm cli app --port 4400 --no-open  # App starten (http://127.0.0.1:4400/app/)
pnpm schemas                        # schemas/*.schema.json aus src/core/schema.ts neu erzeugen
```

Vor jedem Commit: `pnpm typecheck`, `pnpm test`; bei Änderungen an Template/Design zusätzlich `pnpm diff:reference`.

## Architektur

```
Prospekt (PDF/Bilder, Firestore)
  → extract/   Seiten lesen (KI), Preise gegenprüfen          → extraction.json
  → select/    beste Angebote wählen, Story bauen              → story.json
  → images/    Produktbild: Katalog → Internet → Prospekt     → images/<id>.png
  → template/  React-Template (eine Story, viele Ansichten)
  → render/    Playwright-Frames + ffmpeg                      → output/*.mp4, *.png, ZIP
```

| Ordner | Inhalt |
|---|---|
| `src/core/` | Reine Logik ohne I/O: `schema.ts` (zod-Schemas von story.json, **die** Datenquelle), `design.ts` (Vorlagen/Presets), `layout.ts` (Formate 9:16, 4:5, 1:1), `timeline.ts`, `captions.ts` (Instagram-Texte), `magic.ts` (7-Tage-Plan, Countdown, QR), `catalog.ts` (Mengen, Grundpreis, Bestpreis), `format.ts` (Datum, Wochentag, Hashtags, Preise) |
| `src/extract/` | Prospekt lesen: `extract.ts` (Ablauf), `claude.ts`/`../ai/gemini.ts` (Anbieter), `normalize.ts` (Preise, Einheiten, Zeilenumbruch) |
| `src/ai/` | KI-Anbieter wählen (`provider.ts`), Antwort-Cache (`cache.ts`), Verbrauch (`usage.ts`) |
| `src/images/` | Bildersuche (Brave, Open Food Facts), KI-Abgleich (`match.ts`), Ablauf `resolve.ts` |
| `src/library/` | Produkt-Katalog: `library.ts` (index.json + PNGs), `catalog-api.ts` (HTTP), `bestprice.ts` |
| `src/app/` | Web-App-Server: Jobs, `pipeline.ts` (Prospekt → Story), `campaign.ts` (Katalog → Story) |
| `src/review/` | Review-/Studio-Server (`server.ts`) und die React-App (`ui/`: `pages.tsx`, `App.tsx` Prüfen, `studio.tsx` Design/Export, `catalog.tsx`) |
| `src/template/` | Das Video-Template (`Story.tsx`), gerendert von Vite + Playwright |
| `src/render/` | Frames rendern, MP4 bauen, Export-Pakete, ZIP |
| `src/firestore/` | Lesender Zugriff auf Firestore (REST, öffentlich): Märkte und Prospekte |
| `tools/*.py` | Bildverarbeitung in Python: `cutout.py` (Freisteller), `single.py` (eine Packung aus Mehrfachabbildung), `crops.py`, `prep.py` |

**Python-Werkzeuge** sprechen immer dasselbe Protokoll: JSON-Liste von Aufträgen auf stdin, pro Auftrag eine JSON-Zeile auf stdout. Aufruf aus TypeScript nur über `runPython(script, args, jobs, onLine)` (`src/python.ts`). Das Modell wird einmal pro Prozess geladen – Aufträge bündeln statt pro Bild einen Prozess starten.

**Jobs** liegen in `jobs/<id>/` (Ort: `SINCAPP_JOBS`): `input/`, `work/`, `extraction.json`, `story.json`, `images/`, `output/`, `report.md`, `job.json`. Der Katalog liegt in `library/` (`SINCAPP_LIBRARY`).

## Regeln, die nicht verhandelbar sind

1. **Kosten minimal.** Der Nutzer zahlt jeden KI-Aufruf. Keine zusätzlichen KI-Aufrufe ohne Not; alles, was lokal geht (Regeln, Python, Cache), lokal machen. Jede KI-Antwort wird gecacht (`src/ai/cache.ts`), Verbrauch geloggt (`logUsage`). Bilder für die KI verkleinern (512 px). Ein bereits bekanntes Produkt (Katalog) nie erneut suchen.
2. **Bildquellen-Reihenfolge:** eigenes Bild (`manual`) > Internet (`web`/`openfoodfacts`) > Prospekt-Ausschnitt (`prospekt`). `Library.put` ersetzt nie ein besseres Bild durch ein schlechteres (`SOURCE_RANK`).
3. **Klassik-Referenz pixelgleich:** `pnpm diff:reference` muss 0,00 % liefern. Neue Optionen im Design dürfen die Klassik-Vorlage nicht verändern (Standardwerte so wählen, dass ohne Einstellung alles bleibt wie es war).
4. **sincapp Design System** (Vorlage `marke`, alle Texte): Hintergründe nur Papier `#FAF6F1` und Nuss `#292019`; Akzente Rot `#C24A18` und Bernstein `#E9A02A` (Bernstein nur auf Nuss); keine Verläufe; als Emoji höchstens 🐿; **kein Imperativ** in Werbetexten („Diese Woche günstig“ statt „Jetzt zuschlagen!“); eine Sprache pro Layout; Karten weiß, Radius 20, 1 px Rand.
5. **Zweisprachig:** Jeder sichtbare Werbetext gibt es in `de` und `tr`. Türkische Namen max. 2 × 14 Zeichen (`TR_MAX_CHARS`).
6. **Keine Geheimnisse im Code oder Log.** API-Schlüssel nur in `.env` (über die Einstellungen der App).
7. **Firestore nur lesen.** Das Tool schreibt nie zurück.

## Konventionen

- **Sprache:** UI-Texte, Kommentare, Commit-Messages und Fehlermeldungen auf Deutsch. Bezeichner im Code englisch oder deutsch wie im umgebenden Code.
- **Kommentare** erklären das *Warum* (oft mit Beispiel: `"5×140 g" → 700 g`). Jede Datei beginnt mit einem Satz, wofür sie da ist.
- **Daten über zod-Schemas** (`src/core/schema.ts`). Nach Änderungen dort `pnpm schemas` laufen lassen. Neue Felder optional halten, damit alte story.json gültig bleiben.
- **Hilfsfunktionen zuerst suchen**, bevor neue entstehen: Datum/Wochentag/Hashtags/Preise in `core/format.ts`, Mengen/Grundpreis in `core/catalog.ts`, Sticker-Texte in `core/badges.ts`.
- **Fehler** als verständliche deutsche Meldung für den Nutzer werfen (`throw new Error('Bitte mindestens 2 Produkte wählen')`); einzelne kaputte Seiten/Bilder landen als Warnung im Bericht statt den Lauf abzubrechen.
- **UI:** React ohne Komponentenbibliothek, Styles in `src/review/ui/review.css`. Muss auf dem Handy (390 px) ohne seitliches Scrollen funktionieren.
- **Tests** liegen in `test/`, Fixtures in `test/fixtures/` (Saray-Beispiel mit aufgezeichneten KI-Antworten – Tests rufen nie eine echte KI auf).

## Wo baue ich was ein?

- **Neue Design-Vorlage:** `PRESETS` in `src/core/design.ts`, Vorschau mit `pnpm tsx tools/preview-designs.ts`.
- **Neuer Sticker:** `BADGES` in `src/core/schema.ts` + Text in `BADGE_TEXT` (`src/core/badges.ts`).
- **Neues Export-Paket:** `PACKS` in `src/core/packs.ts`; was gerendert wird, steht in `src/render/export.ts`.
- **Neuer KI-Anbieter:** `PageReader`/`ProductMatcher` implementieren und in `src/ai/provider.ts` eintragen; immer über `CachingReader`/`CachingMatcher` laufen lassen.
- **Neue Bildquelle:** `ImageSearchProvider` in `src/images/search.ts`.
- **Neue API-Route:** App-weit in `src/app/server.ts`, Katalog in `src/library/catalog-api.ts`, pro Job in `src/review/server.ts` (`jobApi`).
