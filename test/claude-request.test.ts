import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClaudeReader } from '../src/extract/claude';

// Fake-API: prüft, wie die Anfrage aussieht, und antwortet mit einer gespeicherten Seite.
const seen: { headers: Record<string, string | string[] | undefined>; body: any }[] = [];
let reply: unknown = {};
const server = createServer((req, res) => {
  let data = '';
  req.on('data', (d) => (data += d));
  req.on('end', () => {
    seen.push({ headers: req.headers, body: JSON.parse(data) });
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: JSON.stringify(reply) }],
      }),
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

describe('Claude-Anfrage', () => {
  it('Seite: Bild, Structured Output, günstiges Modell (Sonnet), mittlerer Aufwand', async () => {
    reply = { market: 'Saray Market', validFrom: '2026-10-28', validTo: '2026-11-07', addresses: [], phone: null, offers: [] };
    const r = await new ClaudeReader('test-key', base).readPage(PAGE, { width: 1200, height: 1500 });
    expect(r.market).toBe('Saray Market');
    const { headers, body } = seen.at(-1)!;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    // Ausweich-Modus nur bei Opus
    expect(body.fallbacks).toBeUndefined();
    expect(String(headers['anthropic-beta'] ?? '')).not.toContain('server-side-fallback');
    expect(body.messages[0].content[0].type).toBe('image');
    expect(body.messages[0].content[1].text).toContain('1200×1500');
  });

  it('Preis-Gegencheck: ordnet Antworten nach Nummer zu', async () => {
    reply = { prices: [{ id: 2, price: '1.99' }, { id: 1, price: '7.99' }] };
    const r = await new ClaudeReader('test-key', base).readPrices([PAGE, PAGE], PAGE);
    expect(r).toEqual(['7.99', '1.99']);
    expect(seen.at(-1)!.body.model).toBe('claude-haiku-5-5');
    expect(seen.at(-1)!.body.output_config.effort).toBe('low');
  });

  it('ohne Key gibt es eine verständliche Meldung', () => {
    expect(() => new ClaudeReader('')).toThrow(/ANTHROPIC_API_KEY/);
  });
});
