import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheMarket, cleanAddress, listMarkets, listProspects, marketSlug, todayBerlin } from '../src/firestore/firestore';

const s = (v: string) => ({ stringValue: v });
const arr = (...v: object[]) => ({ arrayValue: { values: v } });
const map = (f: object) => ({ mapValue: { fields: f } });
const doc = (c: string, id: string, f: object) => ({ name: `projects/trprosp/databases/(default)/documents/${c}/${id}`, fields: f });

// Fake-Firestore: zwei Seiten bei markets, damit das Blättern geprüft wird
const fake: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('/markets')) {
    if (!url.includes('pageToken'))
      return Response.json({
        documents: [doc('markets', 'saray_market_tazrp7', { name: s('Saray Market'), profile: map({ address: s('Lange Laube 3, 30159 Hannover'), logoUrl: s('https://firebasestorage.googleapis.com/logo'), social: map({ instagram: s('saraymarket') }) }) })],
        nextPageToken: 'p2',
      });
    return Response.json({ documents: [doc('markets', 'ailem_market_mqoccf', { name: s('Ailem Market'), profile: map({ description: s('Schwarzwaldstraße 37 c, 30657 Hannover, Germany') }) })] });
  }
  if (url.includes('/prospects'))
    return Response.json({
      documents: [
        doc('prospects', 'neu', { marketIds: arr(s('saray_market_tazrp7'), s(''), s('saray_market_tazrp7')), title: s('Wochenangebote'), validFrom: s('2026-10-28'), validUntil: s('2026-11-07'), imageUrls: arr(s('a'), s('b')), thumbnailUrls: arr(s('ta'), s('tb')) }),
        doc('prospects', 'alt', { marketId: s('ailem_market_mqoccf'), title: s('Alt'), validFrom: s('2026-01-01'), validUntil: s('2026-01-07'), images: arr(s('x')) }),
        doc('prospects', 'leer', { marketIds: arr(s('x')), title: s('ohne Seiten'), validFrom: s('2026-10-28'), validUntil: s('2026-11-07') }),
      ],
    });
  if (url.endsWith('/logo')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
  return new Response('nope', { status: 404 });
};

describe('Firestore lesen', () => {
  it('Märkte: alle Seiten, Adresse aus profile.address oder Altbestand', async () => {
    const m = await listMarkets(fake);
    expect(m.map((x) => x.name)).toEqual(['Ailem Market', 'Saray Market']);
    expect(m[0].address).toBe('Schwarzwaldstraße 37 c, 30657 Hannover');
    expect(m[1]).toMatchObject({ instagram: 'saraymarket', address: 'Lange Laube 3, 30159 Hannover' });
  });

  it('Prospekte: marketIds tolerant, Altfeld images, ohne Seiten weg, neueste zuerst', async () => {
    const p = await listProspects(fake);
    expect(p.map((x) => x.id)).toEqual(['neu', 'alt']);
    expect(p[0].marketIds).toEqual(['saray_market_tazrp7']);
    expect(p[1]).toMatchObject({ marketIds: ['ailem_market_mqoccf'], imageUrls: ['x'] });
  });

  it('Markt wird als lokale Markt-Datei mit Logo abgelegt', async () => {
    process.env.SINCAPP_MARKETS_CACHE = mkdtempSync(join(tmpdir(), 'mk-'));
    const [, saray] = await listMarkets(fake);
    const m = await cacheMarket(saray, fake);
    expect(m).toMatchObject({ slug: 'saray-market-tazrp7', logo: 'saray-market-tazrp7/logo.jpg', instagram: 'saraymarket', addresses: ['Lange Laube 3, 30159 Hannover'] });
    expect(readFileSync(join(process.env.SINCAPP_MARKETS_CACHE, 'saray-market-tazrp7/logo.jpg'))[0]).toBe(0xff);
    delete process.env.SINCAPP_MARKETS_CACHE;
  });

  it('Hilfsfunktionen', () => {
    expect(marketSlug('Bizim_Market__Roderbruchmarkt_rj7em5')).toBe('bizim-market-roderbruchmarkt-rj7em5');
    expect(cleanAddress('Celler Str. 103, 38114 Braunschweig, Deutschland')).toBe('Celler Str. 103, 38114 Braunschweig');
    expect(todayBerlin(new Date('2026-10-27T23:30:00Z'))).toBe('2026-10-28');
  });
});
