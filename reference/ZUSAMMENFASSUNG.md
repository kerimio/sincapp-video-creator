# Referenz-Analyse: Story Saray Market

Quelle: Claude-Design-Artifact (gebündelte Seite), entpackt nach `reference/`:
`story-saray.jsx` (Story), `animations-v3.jsx` (Engine), `Story Saray Market.template.html` (Szenenliste, Fonts), `fonts/` (Archivo woff2).

## Bühne & Grundlagen
- 1080 × 1920, Hintergrund Papier `#FAF6F1`, Font **Archivo** 500/600/700/800/900 (variable woff2: latin, latin-ext, vietnamese; liegt bei).
- Farben: Rot `#C24A18`, Nuss `#292019`, Papier `#FAF6F1`, Amber `#E9A02A`, Ink2 `#5C4E42`.
- Drei Easings: `enter` = easeOutQuart, `pop` = easeOutBack, `swipe` = easeInOutCubic.
- Alles ist eine reine Funktion der Zeit `T` (kein useEffect/rAF) und lässt sich deshalb frame-genau seeken. Die Engine bietet dafür schon das Event `data-om-seek-to-time-frame` mit synchronem Commit.
- Wasserzeichen: sincapp-Marke 1150 px breit, unten links (−300/−260), −8° gedreht, Deckkraft 5–8 %, driftet langsam (sin(T·0,25)·14 px).

## Zeitachse
Abspieldauer und „authored“ Zeit sind verschieden: Die Angebotsseiten sind mit 6,5 s choreografiert, werden aber in 4,5 s abgespielt (T läuft dort 1,44× schneller).

| Szene | Abspiel | Authored (T) |
|---|---|---|
| Intro | 0 – 3,6 s | 0 – 3,6 |
| S1 (3 Angebote, Rot) | 3,6 – 8,1 s | 3,6 – 10,1 |
| S2 (2 Angebote, Nuss) | 8,1 – 12,6 s | 10,1 – 16,6 |
| CTA | 12,6 – 18,6 s | 16,6 – 22,6 |

Gesamt 18,6 s. Mit 8 Angeboten (3+3+2) sind es 3,6 + 3 × 4,5 + 6 = **23,1 s**.

## 1. Intro
- Lockup (Marke + Wortmarke, h 64, ×1,7) zentriert bei y 250, Fade 0,1–0,8 s.
- Eyebrow 30 px/800, Laufweite .2em, Versalien, Ink2, y 470; gleitet 40 px hoch (0,35–0,95 s).
- Headline 2 Zeilen, 110 px/900, Versalien, −0,045em; Zeile 2 rot. Masken-Reveal von unten (115 % → 0), gestaffelt um 0,12 s; die ganze Headline zoomt langsam 1 → 1,04.
- Markt-Chip 420 × 200 (weiß, Radius 40) × 1,35 bei y 900, Pop 1,0–1,6 s, danach Wippen ±8 px.
- Info-Block ab y 1230 (Fade + 40 px, 1,5–2,1 s): Datums-Pill (100 hoch, Kalender-Icon 44, Text 40/800), Adresse 40/600, @handle 44/800 rot.

## 2. Angebotsseiten
- Übergang: Kreis-Wipe per `clip-path: circle()`, Radius 0 → 2400 px von s−0,45 bis s+0,45 (swipe). Das Zentrum wechselt zwischen (880, 560) und (200, 560).
- Hintergründe abwechselnd: Rot (Text weiß, Preisschild rot/weiß) und Nuss (Text Papier, Preisschild Amber/Nuss).
- Header: Lockup bei (90, 150), Chip ×0,62 bei (90, 280), rechts MarketInfo (Pill 76 hoch, Adresse 24/600 rechtsbündig, max. 560 breit, @handle 26/800). Header fährt seitlich ein (s−0,1 bis s+0,6).
- Karten: x 90, Breite 900, Start y 500, Abstand 28.
  - **3 Angebote**: Zeile 380 hoch, Raster 340 px Bild | Text. Name 2 Zeilen Versalien 900, Größe `min(56, 480 / (längste Zeile × 0,72))`, Notiz 26/600, Preisschild darunter.
  - **2 Angebote**: Karte 600 hoch, Bild oben (Zoom ×1,3), Name 66/900, Preisschild rechts bei −120 px, überlappt die Bildkante.
- Karten-Animation: von rechts (+1150 px, 7° gedreht) rein, gestaffelt 0,22 s; Preisschild poppt 0,5 s später; Bild Ken-Burns 1 → 1,07; danach leichtes Wippen und Schaukeln.
- Preisschild: Radius 24, −3° gedreht, Preis 80/900, € 40/900, Einheit 28/800. Es gibt auch eine Variante mit mehreren Preisen (`prices[]`).
- Ist keine Notiz gesetzt, zeigt die Karte den Namen in der anderen Sprache.

## 3. CTA
- Kreis-Wipe aus (540, 1500), Papier-Hintergrund.
- Lockup y 150; Headline 3 Zeilen 96/900 ab y 280 (Masken-Reveal, letzte Zeile rot, nicht versal).
- Button 700 × 124 bei y 680, rot, Text 44/800 + Pfeil, Pop + Pulsieren.
- Store-Badges (300 und 330 × 96) bei y 856.
- Handy 580 × 1260 bei y 1030, fährt von +1000 px hoch, danach schweben; zeigt `app-screen-saray.png`.
- Abstände: Headline-Ende y 628 → Button 680 (52 px) und Button-Ende 804 → Badges 856 (52 px). Die Regel „gleiche Abstände“ ist also erfüllt, aber nur durch feste Werte. Im Nachbau rechne ich die Positionen aus, damit die Regel auch bei anderen Texten hält.

## Was in der Referenz fehlt oder abweicht
1. **Bild-Assets sind nicht im Bundle**: Produktbilder (`saray-rindermett.png` usw.), `saray-logo.jpg`, sincapp-Logos (`marke-*.svg`, `wortmarke-*.svg`), Icons (`calendar.svg`, `arrow_right-white.svg`), `app-screen-saray.png`. Das Apple-Icon kommt von einem CDN und muss für den Offline-Betrieb lokal liegen.
2. **Nur eine Adresse** (String) ist vorgesehen; 1–3 Filialen müssen neu gelöst werden.
3. **Kein logoCrop**: Das Logo ist fest 380 × 175 im Chip.
4. **Große Karten skalieren den Namen nicht** (fest 66 px), sodass lange Namen überlaufen können.
5. Seitenaufteilung, Inhalte und Datum sind im Code fest verdrahtet (5 Fleisch-Angebote, „28.10. – 30.10.2026“), nicht aus Daten.
6. `story-bizim.jsx` ist nicht enthalten.
7. Die Referenz rendert über einen svg/foreignObject-Wrapper. Der Pixel-Vergleich muss deshalb im selben Chromium und mit denselben Assets laufen.
