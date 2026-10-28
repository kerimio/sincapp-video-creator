import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GeminiMatcher, GeminiReader } from '../src/ai/gemini';
import { aiProvider } from '../src/ai/provider';

// Fake-API im Format von generateContent
const seen: { url: string; headers: Record<string, string | string[] | undefined>; body: any }[] = [];
let reply: unknown = {};
let finish = 'STOP';
/** Simuliert ein Modell, das keine Denk-Einstellung kennt */
let rejectThinking = false;
const server = createServer((req, res) => {
  let data = '';
  req.on('data', (d) => (data += d));
  req.on('end', () => {
    const body = JSON.parse(data);
    seen.push({ url: req.url ?? '', headers: req.headers, body });
    if (rejectThinking && body.generationConfig?.thinkingConfig) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'thinking_level is not supported by this model' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(reply) }] }, finishReason: finish }] }),
    );
  });
});
let base = '';
beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
afterAll(() => server.close());

const PAGE = join(__dirname, '../reference/samples/saray-2026-10-28/seite-4.png');

describe('Gemini-Anfrage', () => {
  it('Seite: Bild + JSON-Schema, Antwort wird geprüft', async () => {
    finish = 'STOP';
    const offer = { brand: 'Egetürk', name_de: 'Sırma Knoblauchwurst', name_tr: 'Parmak Sucuk', unit: '1 kg', price: '13.99', note_de: null, note_tr: null, category: 'wurst', bbox: [100, 50, 500, 400], price_tag_bbox: null, confidence: 0.9 };
    reply = { market: 'Saray Market', validFrom: '2026-10-28', validTo: '2026-11-07', addresses: [], phone: null, offers: [offer] };
    const r = await new GeminiReader('test-key', base).readPage(PAGE, { width: 1200, height: 1500 });
    expect(r.validTo).toBe('2026-11-07');
    // [ymin, xmin, ymax, xmax] 0–1000 → Pixel [x0, y0, x1, y1]
    expect(r.offers[0].bbox).toEqual([60, 150, 480, 750]);
    const { url, headers, body } = seen.at(-1)!;
    expect(url).toMatch(/models\/gemini-3.8-flash:generateContent/);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(headers['x-goog-api-key']).toBe('test-key');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema.properties.offers.type).toBe('array');
    const parts = body.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe('image/png');
    expect(parts[1].text).toContain('1200×1500');
    expect(parts[1].text).toContain('[ymin, xmin, ymax, xmax]');
  });

  it('Preis-Gegencheck und Bildabgleich ordnen nach Nummer zu', async () => {
    reply = { prices: [{ id: 2, price: '1.99' }, { id: 1, price: '7.99' }] };
    expect(await new GeminiReader('k', base).readPrices([PAGE, PAGE], PAGE)).toEqual(['7.99', '1.99']);
    expect(seen.at(-1)!.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    reply = { candidates: [{ id: 1, same_product: true, same_variant: true, clean_shot: true, note: 'passt' }] };
    const m = await new GeminiMatcher('k', base).compare(PAGE, [PAGE, PAGE], 'Egetürk Sırma');
    expect(m.map((c) => c.same_product)).toEqual([true, false]);
  });

  it('abgeschnittene oder ungültige Antworten werden nicht übernommen', async () => {
    finish = 'MAX_TOKENS';
    await expect(new GeminiReader('k', base).readPrices([PAGE], PAGE)).rejects.toThrow(/MAX_TOKENS/);
    finish = 'STOP';
    reply = { prices: 'kaputt' };
    const before = seen.length;
    await expect(new GeminiReader('k', base).readPrices([PAGE], PAGE)).rejects.toThrow();
    // kaputte Antwort: nur einmal neu gefragt (jede Anfrage kostet)
    expect(seen.length - before).toBe(2);
  }, 30_000);

  it('kennt das Modell die Denk-Einstellung nicht, wird ohne sie gefragt', async () => {
    rejectThinking = true;
    finish = 'STOP';
    reply = { prices: [{ id: 1, price: '2.49' }] };
    try {
      expect(await new GeminiReader('k', base).readPrices([PAGE], PAGE)).toEqual(['2.49']);
      expect(seen.at(-1)!.body.generationConfig.thinkingConfig).toBeUndefined();
    } finally {
      rejectThinking = false;
    }
  });
});

describe('KI-Auswahl', () => {
  it('nimmt den vorhandenen Key, bei beiden Gemini (günstiger), außer SINCAPP_AI sagt etwas anderes', () => {
    expect(aiProvider({})).toBeNull();
    expect(aiProvider({ GEMINI_API_KEY: 'g' })).toBe('gemini');
    expect(aiProvider({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toBe('gemini');
    expect(aiProvider({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', SINCAPP_AI: 'claude' })).toBe('claude');
    expect(aiProvider({ ANTHROPIC_API_KEY: 'a', SINCAPP_AI: 'gemini' })).toBe('claude');
  });
});
