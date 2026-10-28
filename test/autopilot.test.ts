import { describe, expect, it } from 'vitest';
import { dueProspects } from '../src/app/autopilot';
import type { FsProspect } from '../src/firestore/firestore';

const pr = (id: string, marketIds: string[], validFrom: string, validUntil: string): FsProspect => ({ id, marketIds, title: id, validFrom, validUntil, imageUrls: ['x'], thumbnailUrls: [], products: [] });

describe('Wochen-Autopilot', () => {
  const today = '2026-10-28';
  const all = [
    pr('kw44', ['saray', 'yildiz'], '2026-10-26', '2026-11-01'),
    pr('kw45', ['saray'], '2026-11-02', '2026-11-08'),
    pr('alt', ['saray'], '2026-10-19', '2026-10-25'),
    pr('spaeter', ['saray'], '2026-11-20', '2026-11-26'),
    pr('fremd', ['anderer'], '2026-10-26', '2026-11-01'),
  ];

  it('nimmt nur neue, gültige Prospekte der gewählten Märkte, frühester zuerst', () => {
    const due = dueProspects({ markets: ['saray'], done: [] }, all, [], today);
    expect(due.map((d) => d.prospect.id)).toEqual(['kw44', 'kw45']);
  });

  it('liest nichts doppelt: erledigt oder schon von Hand als Job angelegt', () => {
    const due = dueProspects({ markets: ['saray', 'yildiz'], done: ['saray/kw44'] }, all, [{ marketId: 'saray', prospects: ['kw45'] }], today);
    expect(due.map((d) => `${d.marketId}/${d.prospect.id}`)).toEqual(['yildiz/kw44']);
  });

  it('ohne gewählte Märkte passiert nichts', () => {
    expect(dueProspects({ markets: [], done: [] }, all, [], today)).toEqual([]);
  });
});
