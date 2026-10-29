import { describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { checkPrices, extractJob } from '../src/extract/extract';
import { PageResult } from '../src/extract/schema';
import { pythonBin } from '../src/python';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pagesToRead } from '../src/firestore/firestore';
import { applyFirestoreDates, applyFirestoreMarkets, firestoreProductNames } from '../src/app/pipeline';
import { caption } from '../src/core/captions';
import { parseStory } from '../src/core/schema';
import { dealScores, offerToStory, pageBoost, selectByMarket } from '../src/select/select';
import { pagesFor } from '../src/core/pages';
import { readFileSync } from 'node:fs';
import { offerBoosts, selectOffers } from '../src/select/select';
import { CachingReader } from '../src/ai/cache';
import type { ExtractedOffer } from '../src/extract/schema';

const urls = ['a', 'b', 'c', 'd'];

describe('Seiten ohne Produkte überspringen', () => {
  it('nur wenn alle Produkte Fundstellen haben', () => {
    const loc = (page: number) => ({ page, box: [0, 0, 10, 10] });
    expect(pagesToRead({ imageUrls: urls, products: [{ name_de: 'A', locations: [loc(2)] }, { name_de: 'B', locations: [loc(3)] }] })).toEqual([1, 2, 3]); // Seite 1 immer
    expect(pagesToRead({ imageUrls: urls, products: [{ name_de: 'A', locations: [loc(2)] }, { name_de: 'B' }] })).toEqual([1, 2, 3, 4]);
    expect(pagesToRead({ imageUrls: urls, products: [] })).toEqual([1, 2, 3, 4]);
  });
});

describe('Mehrere Prospekte', () => {
  it('Datum vom frühesten Start bis zum spätesten Ende, Namen aus allen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-'));
    writeFileSync(
      join(dir, 'firestore-prospekt.json'),
      JSON.stringify([
        { validFrom: '2026-10-28', validUntil: '2026-11-07', products: [{ name_de: 'Sucuk', locations: [{ page: 1, box: [], label: { de: 'Sırma Knoblauchwurst' } }] }] },
        { validFrom: '2026-10-26', validUntil: '2026-11-01', products: [{ name_de: 'Rinderhack' }] },
      ]),
    );
    const ex = { validFrom: null, validTo: '2026-11-30', warnings: ['Gültigkeitszeitraum nicht gefunden – bitte von Hand eintragen', 'anderes'] };
    applyFirestoreDates(ex, dir);
    expect(ex).toEqual({ validFrom: '2026-10-26', validTo: '2026-11-07', warnings: ['anderes'] });
    expect(firestoreProductNames(dir)).toEqual(['Sucuk', 'Sırma Knoblauchwurst', 'Rinderhack']);
  });
});

const offer = (id: string, name: string, bbox: number[], category = 'fleisch'): ExtractedOffer => ({
  id, page: 1, pageFile: 'p.png', brand: null, name: { de: name, tr: name }, lines: { de: [name], tr: [name] }, unit: null, price: '1,99',
  note: null, category: category as ExtractedOffer['category'], bbox: bbox as ExtractedOffer['bbox'], priceTagBbox: null, confidence: 0.9, priceConfidence: 0.98, warnings: [],
});

describe('Beste Angebote', () => {
  it('große und in Firestore gepflegte Angebote kommen zuerst', () => {
    const ex = {
      pages: [{ file: 'p.png', source: 'p.png', width: 1000, height: 1000, offers: 3 }],
      offers: [offer('klein', 'Nudeln', [0, 0, 100, 100]), offer('gross', 'Lammkeule', [0, 0, 500, 500]), offer('gepflegt', 'Sırma Sucuk', [0, 0, 100, 100])],
    };
    const boost = offerBoosts(ex, ['sirma sucuk']);
    expect(boost.get('gross')).toBeGreaterThan(boost.get('klein')!);
    expect(boost.get('gepflegt')).toBeGreaterThan(boost.get('klein')!);
    const sel = selectOffers(ex.offers, { count: 2, boost });
    expect(sel.offers.map((o) => o.id).sort()).toEqual(['gepflegt', 'gross']);
  });
});

describe('KI-Antworten merken', () => {
  it('liest dieselbe Seite nur einmal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ki-'));
    const page = join(dir, 'seite.png');
    writeFileSync(page, 'bild');
    let calls = 0;
    const inner = {
      name: 'fake',
      async readPage() {
        calls++;
        return { market: 'X', validFrom: null, validTo: null, addresses: [], phone: null, offers: [] };
      },
      async readPrices(c: string[]) {
        calls++;
        return c.map(() => '1.99');
      },
    };
    const r = new CachingReader(inner, join(dir, 'cache'));
    await r.readPage(page, { width: 10, height: 10 });
    await r.readPage(page, { width: 10, height: 10 });
    await r.readPrices([page], page);
    await r.readPrices([page], page);
    expect(calls).toBe(2);
    expect(r.hits).toBe(2);
  });
});

describe('Prospekte mehrerer Märkte', () => {
  it('jedes Angebot bekommt den Markt seines Prospekts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-'));
    writeFileSync(join(dir, 'firestore-prospekt.json'), JSON.stringify([{ marketName: 'Saray Market' }, { marketName: 'Yıldız Market' }]));
    const ex = { offers: [{ pageFile: 'work/pages/p1-seite-01.png' }, { pageFile: 'work/pages/p2-seite-03.png' }] as { pageFile: string; market?: string }[] };
    applyFirestoreMarkets(ex, dir);
    expect(ex.offers.map((o) => o.market)).toEqual(['Saray Market', 'Yıldız Market']);
    // ein Markt (auch mit mehreren Prospekten): kein Markt am Angebot
    writeFileSync(join(dir, 'firestore-prospekt.json'), JSON.stringify([{ marketName: 'Saray Market' }, { marketName: 'Saray Market' }]));
    const one = { offers: [{ pageFile: 'work/pages/p2-seite-01.png' }] as { pageFile: string; market?: string }[] };
    applyFirestoreMarkets(one, dir);
    expect(one.offers[0].market).toBeUndefined();
  });

  it('gleiches Produkt in zwei Märkten: jeder Markt zeigt seins (kein Vergleich zwischen Märkten)', () => {
    const a = { ...offer('a', 'Sucuk', [0, 0, 100, 100]), brand: 'Egetürk', price: '9,99', market: 'Saray Market' };
    const b = { ...offer('b', 'Sucuk', [0, 0, 100, 100]), brand: 'Egetürk', price: '8,49', market: 'Yıldız Market' };
    const c = { ...offer('c', 'Tahin', [0, 0, 100, 100], 'konserven'), market: 'Saray Market' };
    const sel = selectByMarket([a, b, c], ['Saray Market', 'Yıldız Market']);
    expect(sel.offers.map((o) => o.id)).toEqual(['a', 'c', 'b']);
    expect(offerToStory(b).market).toBe('Yıldız Market');
  });

  it('Bildtext nennt den Markt je Angebot', () => {
    const story = parseStory(JSON.parse(readFileSync(join(__dirname, 'fixtures/reference-job/story.json'), 'utf8')));
    story.offers[0].market = 'Yıldız Market';
    expect(caption(story, 'de')).toContain('bei Yıldız Market');
    expect(caption(story, 'tr')).toContain('Yıldız Market’te');
    expect(caption(story, 'de')).toContain('#yildizmarket');
  });
});

describe.skipIf(!existsSync(pythonBin()))('Schneller lesen', () => {
  it('liest Seiten parallel in fester Reihenfolge und prüft Preise nur für die Vorauswahl', async () => {
    const job = mkdtempSync(join(tmpdir(), 'schnell-'));
    mkdirSync(join(job, 'input'));
    for (const n of [1, 2, 3, 4, 5, 6]) copyFileSync(join(__dirname, `../reference/samples/saray-2026-10-28/seite-${n}.png`), join(job, 'input', `seite-${n}.png`));
    let running = 0;
    let most = 0;
    const priceCalls: number[] = [];
    const reader = {
      name: 'fake',
      async readPage(file: string) {
        running++;
        most = Math.max(most, running);
        await new Promise((r) => setTimeout(r, 30));
        running--;
        const n = file.match(/seite-(\d)/)![1];
        return PageResult.parse(JSON.parse(readFileSync(join(__dirname, `fixtures/saray-extraction/seite-${n}.json`), 'utf8')));
      },
      async readPrices(crops: string[]) {
        priceCalls.push(crops.length);
        return crops.map(() => null);
      },
    };
    const ex = await extractJob({ jobDir: job, reader, priceCheck: false, parallel: 3 });
    expect(most).toBe(3);
    expect(ex.pages.map((p) => p.source.match(/seite-\d/)![0])).toEqual(['seite-1', 'seite-2', 'seite-3', 'seite-4', 'seite-5', 'seite-6']);
    expect(ex.offers[0].id).toBe('s1-1');
    expect(priceCalls).toEqual([]);
    // zwei Angebote auf zwei Seiten: zwei Aufrufe mit je einem Schild, der Rest bleibt ungeprüft
    const pick = [ex.offers.find((o) => o.page === 1 && o.priceTagBbox)!, ex.offers.find((o) => o.page === 3 && o.priceTagBbox)!];
    await checkPrices(pick, ex.pages, reader, join(job, 'work'));
    expect(priceCalls).toEqual([1, 1]);
  }, 120000);
});

describe('Eine Seite pro Markt', () => {
  const o = (id: string, market: string, cat = 'fleisch', size = 100) => ({ ...offer(id, `Produkt ${id}`, [0, 0, size, size], cat), market });

  it('jeder Markt bekommt seine besten Angebote, auch wenn ein anderer viel mehr hat', () => {
    const all = [o('a1', 'A'), o('a2', 'A'), o('a3', 'A'), o('a4', 'A'), o('a5', 'A'), o('b1', 'B', 'konserven'), o('b2', 'B', 'snacks'), o('c1', 'C')];
    const sel = selectByMarket(all, ['A', 'B', 'C']);
    // jeder Markt kommt rein, je 5 Angebote (C hat nur eins)
    expect(sel.offers.map((x) => x.market)).toEqual(['A', 'A', 'A', 'A', 'A', 'B', 'B', 'C']);
    expect(sel.warnings.join()).toMatch(/C: nur 1/);
    // keine Obergrenze mehr: 12 Märkte × 5
    const names = Array.from({ length: 12 }, (_, i) => `M${i}`);
    const many = names.flatMap((m) => [1, 2, 3, 4, 5, 6].map((k) => o(`${m}-${k}`, m)));
    expect(selectByMarket(many, names).offers).toHaveLength(60);
  });

  it('Seiten folgen den Märkten', () => {
    const story = { offers: ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'C', 'C'].map((market) => ({ market, img: 'x.png', price: '1,99', name: { de: ['X'], tr: ['X'] }, imgZoom: 1 })) };
    // eine Seite pro Markt (bis 5 Angebote), in allen Formaten
    expect(pagesFor(story).map((p) => p.map((x) => x.market).join(''))).toEqual(['AAA', 'BB', 'CCCC']);
    expect(pagesFor(story, 'quadrat').map((p) => p.map((x) => x.market).join(''))).toEqual(['AAA', 'BB', 'CCCC']);
  });
});

describe('Konzept fürs Wochenvideo', () => {
  const o = (id: string, name: string, cat: string, price: string, unit: string | null, market = 'A', pageFile = 'work/pages/p1-seite-05.png') =>
    ({ ...offer(id, name, [0, 0, 100, 100], cat), price, unit, market, pageFile });

  it('vordere Prospektseiten zählen am meisten, hintere kaum', () => {
    expect(pageBoost(1, 20)).toBe(4);
    expect(pageBoost(2, 20)).toBe(2.5);
    expect(pageBoost(3, 20)).toBe(1.5);
    expect(pageBoost(20, 20)).toBe(-2);
    expect(pageBoost(11, 20)).toBeLessThan(0);
  });

  it('günstig im Vergleich: Grundpreis gegen den Median, Märkte werden nicht verglichen', () => {
    const all = [
      o('reis', 'Reis', 'grundnahrung', '4,99', '5 kg'), o('r2', 'Bulgur', 'grundnahrung', '2,99', '1 kg', 'B'),
      o('r3', 'Mehl', 'grundnahrung', '1,99', '1 kg', 'B'), o('r4', 'Linsen', 'grundnahrung', '3,49', '1 kg', 'B'),
      o('tee', 'Schwarztee', 'getraenke', '2,99', '500 g'), o('teeB', 'Schwarztee', 'getraenke', '3,49', '500 g', 'B'),
    ];
    const d = dealScores(all);
    expect(d.get('reis')).toBe(1.5); // 1 €/kg statt 2,99 €/kg Median
    expect(d.get('r4')).toBeLessThan(0);
    expect(d.get('tee')).toBe(0); // bei B teurer – zählt nicht mehr
    expect(d.get('teeB')).toBe(0);
  });

  it('pro Markt 5: groß nur frisches Fleisch (sonst das Beste außer Wurst), dann 3 aus verschiedenen Gruppen, Oliven nur zur Not', () => {
    const all = [
      o('wurst1', 'Sucuk', 'wurst', '3,99', '400 g', 'A', 'work/pages/p1-seite-01.png'),
      o('wurst2', 'Salami', 'wurst', '1,99', '200 g'),
      o('fleisch', 'Hähnchenschenkel', 'fleisch', '4,99', '1 kg'),
      o('oliven', 'Oliven', 'konserven', '1,49', '400 g', 'A', 'work/pages/p1-seite-02.png'),
      o('reis', 'Reis', 'grundnahrung', '4,99', '5 kg'),
      o('reis2', 'Bulgur', 'grundnahrung', '1,99', '1 kg'),
      o('milch', 'Ayran', 'kaese_milch', '0,99', '1 l'),
      o('grill', 'Kontaktgrill', 'sonstiges', '19,99', null, 'A', 'work/pages/p1-seite-01.png'),
    ];
    const ex = { pages: [], offers: all };
    const boost = offerBoosts(ex);
    const sel = selectByMarket(all, ['A'], { boost });
    expect(sel.offers.map((x) => x.id)).toEqual(['fleisch', 'reis', 'wurst1', 'milch', 'oliven']);
    // zwei Mal frisches Fleisch: beide groß vorn, Wurst erst danach
    const hack = o('hack', 'Gemischtes Hack', 'fleisch', '5,99', '1 kg', 'A', 'work/pages/p1-seite-09.png');
    expect(selectByMarket([...all, hack], ['A'], { boost: offerBoosts({ pages: [], offers: [...all, hack] }) }).offers.slice(0, 2).map((x) => x.id)).toEqual(['fleisch', 'hack']);
  });
});

describe('Süßes und Snacks zuletzt', () => {
  const o = (id: string, name: string, cat: string, price: string, unit: string | null, market = 'A', pageFile = 'work/pages/p1-seite-05.png') =>
    ({ ...offer(id, name, [0, 0, 100, 100], cat), price, unit, market, pageFile });
  it('Tomatenmark und Konserven vor Chips und Schokolade, auch wenn die Chips günstiger sind', () => {
    const all = [
      o('fleisch', 'Hähnchenschenkel', 'fleisch', '4,99', '1 kg'),
      o('hack', 'Gemischtes Hack', 'fleisch', '6,99', '1 kg'),
      o('takis', 'Takis Blue Heat', 'snacks', '1,49', '93 g', 'A', 'work/pages/p1-seite-01.png'),
      o('schoko', 'Schokolade', 'suesses', '0,99', '100 g', 'A', 'work/pages/p1-seite-01.png'),
      o('mark', 'Tomatenmark', 'konserven', '2,49', '830 g'),
      o('bohnen', 'Weiße Bohnen', 'konserven', '1,29', '800 g'),
      o('oel', 'Sonnenblumenöl', 'grundnahrung', '3,99', '2 l'),
    ];
    const sel = selectByMarket(all, ['A'], { boost: offerBoosts({ pages: [], offers: all }) });
    expect(sel.offers.map((x) => x.id)).not.toContain('takis');
    expect(sel.offers.map((x) => x.id)).not.toContain('schoko');
    expect(sel.offers.map((x) => x.id)).toContain('mark');
    // nichts anderes mehr da: dann dürfen Snacks die Seite füllen
    const few = selectByMarket(all.filter((x) => !['mark', 'bohnen', 'oel'].includes(x.id)), ['A'], { boost: new Map() });
    expect(few.offers.map((x) => x.id).slice(-2).sort()).toEqual(['schoko', 'takis']);
  });
});

describe('Einheitliche Namen', () => {
  it('Schwarztee heißt immer Schwarztee, die Marke steht davor; frisches Fleisch hat keine Marke', async () => {
    const { findGlossary, DEFAULT_GLOSSARY } = await import('../src/core/glossary');
    const { applyGlossary, applyCatalogNames } = await import('../src/library/glossar');
    const { Library } = await import('../src/library/library');
    expect(findGlossary({ de: 'Goran Tee Mevlana Çay', tr: 'Mevlana Çay' }, DEFAULT_GLOSSARY)?.de).toBe('Schwarztee');
    expect(findGlossary({ de: 'Grüner Tee', tr: 'Yeşil Çay' }, DEFAULT_GLOSSARY)?.de).toBe('Grüner Tee');
    expect(findGlossary({ de: 'Pfefferminztee', tr: 'Nane Çayı' }, DEFAULT_GLOSSARY)).toBeNull();

    // Katalog kennt die Marke "Mevlana": sie wird zur Marke, auch wenn die KI "Goran" las
    const dir = mkdtempSync(join(tmpdir(), 'lib-'));
    const lib = await Library.open(dir);
    const png = join(dir, 'x.png');
    writeFileSync(png, 'bild');
    await lib.put({ brand: 'Mevlana', name: { de: 'Schwarztee', tr: 'Siyah Çay' }, unit: '1 kg' }, png, { type: 'web' }, true);
    const tee = { ...offer('t', 'Tee Mevlana Çay', [0, 0, 1, 1], 'getraenke'), brand: 'Goran', name: { de: 'Tee Mevlana Çay', tr: 'Mevlana Çay' } };
    applyCatalogNames([tee], lib);
    applyGlossary([tee], DEFAULT_GLOSSARY);
    expect([tee.brand, tee.name.de, tee.name.tr]).toEqual(['Mevlana', 'Schwarztee', 'Siyah Çay']);

    // Katalog-Treffer: Name wie im Katalog (nach eigener Korrektur jede Woche gleich)
    await lib.put({ brand: 'Tat', name: { de: 'Tomatenmark', tr: 'Domates Salçası' }, unit: '830 g' }, png, { type: 'web' }, true);
    lib.entries[1].aliases.push('tat|tomatenmark-3-fach');
    const mark = { ...offer('m', 'Tomatenmark 3-fach', [0, 0, 1, 1], 'konserven'), brand: 'Tat', unit: '830 g', name: { de: 'Tomatenmark 3-fach', tr: 'Salça' } };
    applyCatalogNames([mark], lib);
    expect(mark.name).toEqual({ de: 'Tomatenmark', tr: 'Domates Salçası' });

    const hack = { ...offer('h', 'Gemischtes Hackfleisch', [0, 0, 1, 1]), brand: 'Saray' };
    applyGlossary([hack], DEFAULT_GLOSSARY);
    expect([hack.brand, hack.lines.de]).toEqual([null, ['Gemischtes Hack']]);
  });
});

describe('Eine Marke, ein Name', () => {
  it('Mevlana-Tee aus vier Märkten heißt überall MEVLANA SCHWARZTEE', async () => {
    const { DEFAULT_GLOSSARY } = await import('../src/core/glossary');
    const { applyGlossary, applyCatalogNames } = await import('../src/library/glossar');
    const { Library } = await import('../src/library/library');
    const lib = await Library.open(mkdtempSync(join(tmpdir(), 'lib-')));
    const t = (id: string, brand: string | null, de: string, tr: string) => ({ ...offer(id, de, [0, 0, 1, 1], 'getraenke'), brand, name: { de, tr } });
    const all = [
      t('a', 'Mevlâna Çay', 'Sade Yaprak Çay', 'Sade Yaprak Çay'),
      t('b', 'Mevlana', 'Ceylon Tee', 'Seylan Çayı'),
      t('c', 'Mevlana', 'Schwarztee', 'Siyah Çay'),
      t('d', 'Goran-Tee', 'Mevlana Cay', 'Mevlana Çay'),
      t('e', 'Çaykur', 'Rize Turist Çayı', 'Rize Turist Çayı'),
      t('f', 'Doğadan', 'Grüner Tee', 'Yeşil Çay'),
      t('g', 'Doğadan', 'Kräutertee Minze', 'Nane Çayı'),
    ];
    applyCatalogNames(all, lib);
    applyGlossary(all, DEFAULT_GLOSSARY);
    expect(all.slice(0, 4).map((o) => `${o.brand} ${o.name.de}`)).toEqual(Array(4).fill('Mevlana Schwarztee'));
    expect(all[3].lines.de.join(' ')).toBe('Mevlana Schwarztee');
    expect(all.slice(0, 4).map((o) => o.name.tr)).toEqual(Array(4).fill('Siyah Çay'));
    expect(all[4].name.de).toBe('Schwarztee');
    expect(all[5].name.de).toBe('Grüner Tee');
    expect(all[6].name.de).toBe('Kräutertee Minze');
  });
});

describe('Namen für alle Produkte', () => {
  it('jede neue Schreibweise einmal an die KI, danach gemerkt; bekannte Namen gehen als Vorlage mit', async () => {
    const { normalizeNames } = await import('../src/library/names');
    const old = process.env.SINCAPP_LIBRARY;
    process.env.SINCAPP_LIBRARY = mkdtempSync(join(tmpdir(), 'namen-'));
    try {
      const calls: { items: string[]; known: string[] }[] = [];
      const namer = {
        normalize: async (items: { id: string; brand: string | null; de: string }[], known: string[]) => {
          calls.push({ items: items.map((i) => i.de), known });
          return items.map((i) => (i.de.includes('Salça') || i.de.includes('Tomaten') ? { id: i.id, brand: 'Tat', de: 'Tomatenmark', tr: 'Domates Salçası' } : { id: i.id, brand: 'Ülker', de: 'Haselnusswaffeln', tr: 'Fındıklı Gofret' }));
        },
      };
      const mk = (id: string, brand: string, de: string) => ({ ...offer(id, de, [0, 0, 1, 1], 'konserven'), brand, name: { de, tr: de } });
      const week1 = [mk('a', 'TAT', 'Tomaten Salça'), mk('b', 'Tat Gıda', 'Tomatenmark 3-fach'), mk('c', 'Ülker', 'Gofret Fındıklı'), mk('d', 'TAT', 'Tomaten Salça')];
      const notes = await normalizeNames(week1, { namer });
      expect(calls).toHaveLength(1);
      expect(calls[0].items).toEqual(['Tomaten Salça', 'Tomatenmark 3-fach', 'Gofret Fındıklı']); // doppelte Schreibweise nur einmal
      expect(week1.map((o) => `${o.brand} ${o.name.de}`)).toEqual(['Tat Tomatenmark', 'Tat Tomatenmark', 'Ülker Haselnusswaffeln', 'Tat Tomatenmark']);
      expect(week1[0].lines.de.join(' ')).toBe('Tat Tomatenmark');
      expect(notes.some((n) => n.startsWith('Name:'))).toBe(true);
      // nächste Woche: gleiche Schreibweise ohne KI, neue mit den festen Namen als Vorlage
      const week2 = [mk('e', 'Tat', 'Tomaten Salça'), mk('f', 'Tat', 'Domates Salçası')];
      await normalizeNames(week2, { namer });
      expect(calls).toHaveLength(2);
      expect(calls[1].items).toEqual(['Domates Salçası']);
      expect(calls[1].known).toContain('Tat | Tomatenmark | Domates Salçası');
      expect(week2.map((o) => o.name.de)).toEqual(['Tomatenmark', 'Tomatenmark']);
      // ohne KI-Key: gemerkte Namen greifen trotzdem, neue bleiben, wie sie sind
      const week3 = [mk('g', 'TAT', 'Tomaten Salça'), mk('h', 'Pınar', 'Labne')];
      await normalizeNames(week3, { namer: null });
      expect(week3.map((o) => o.name.de)).toEqual(['Tomatenmark', 'Labne']);
      // KI-Fehler bricht nichts ab
      const broken = { normalize: async () => { throw new Error('Überlast'); } };
      const w4 = [mk('i', 'Sek', 'Ayran')];
      expect((await normalizeNames(w4, { namer: broken }))[0]).toMatch(/Überlast/);
      expect(w4[0].name.de).toBe('Ayran');
    } finally {
      if (old === undefined) delete process.env.SINCAPP_LIBRARY;
      else process.env.SINCAPP_LIBRARY = old;
    }
  });
});

describe('Glossar', () => {
  it('setzt feste Namen ein, egal wie der Prospekt schreibt; die längste Schreibweise gewinnt', async () => {
    const { findGlossary, mergeGlossary, DEFAULT_GLOSSARY } = await import('../src/core/glossary');
    const { applyGlossary } = await import('../src/library/glossar');
    expect(findGlossary({ de: 'Rinderhackfleisch-Mischung (Gemischtes Hackfleisch)', tr: 'Dana kıyma karışımı' }, DEFAULT_GLOSSARY)?.tr).toBe('Karışık Kıyma');
    expect(findGlossary({ de: 'Rinderhackfleisch', tr: 'Dana Kıyma' }, DEFAULT_GLOSSARY)?.de).toBe('Rinderhack');
    expect(findGlossary({ de: 'Hähnchenschenkel', tr: '' }, DEFAULT_GLOSSARY)?.tr).toBe('Tavuk But');
    expect(findGlossary({ de: 'Hackbraten-Gewürz', tr: 'Baharat' }, DEFAULT_GLOSSARY)).toBeNull();
    // eigener Eintrag ersetzt den Grundbestand
    const own = mergeGlossary([{ de: 'Gemischtes Hack', tr: 'Karışık Kıyma', match: ['mett'] }]);
    expect(own.filter((e) => e.de === 'Gemischtes Hack')).toHaveLength(1);
    const offers = [{ ...offer('x', 'Rinderhackfleisch-Mischung', [0, 0, 1, 1], 'sonstiges'), name: { de: 'Rinderhackfleisch-Mischung (Gemischtes Hackfleisch)', tr: 'Karışık dana kıyma' } }];
    const notes = applyGlossary(offers, DEFAULT_GLOSSARY);
    expect(offers[0].name).toEqual({ de: 'Gemischtes Hack', tr: 'Karışık Kıyma' });
    expect(offers[0].lines.tr).toEqual(['Karışık Kıyma']);
    expect(offers[0].category).toBe('fleisch');
    expect(notes[0]).toMatch(/Glossar/);
  });

  it('prüft eigene Einträge', async () => {
    const { checkGlossary } = await import('../src/library/glossar');
    expect(checkGlossary([{ de: ' Sucuk ', tr: 'Sucuk', match: 'Knoblauchwurst, Parmak Sucuk' }])).toEqual([{ de: 'Sucuk', tr: 'Sucuk', match: ['Knoblauchwurst', 'Parmak Sucuk'] }]);
    expect(() => checkGlossary([{ de: 'X', tr: '' }])).toThrow(/Zeile 1/);
  });
});
