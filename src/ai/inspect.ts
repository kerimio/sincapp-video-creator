// KI-Blick auf das fertige Video: Standbilder jeder Seite + die Daten der Story, gemeldet werden nur Unstimmigkeiten.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { CHECK_MODEL, fallbackParams } from '../extract/claude';
import { image } from '../images/match';
import { aiCacheDir, hashFiles } from './cache';
import { logUsage } from './usage';

export const InspectResult = z.object({
  findings: z.array(
    z.object({
      image: z.number().describe('Nummer des Bildes, auf dem es zu sehen ist'),
      offer: z.string().nullable().describe('betroffenes Produkt wie in den Daten, sonst null'),
      severity: z.enum(['fehler', 'hinweis']).describe('fehler = so nicht veröffentlichen; hinweis = bitte ansehen'),
      text: z.string().describe('was nicht stimmt, ein kurzer deutscher Satz'),
    }),
  ),
});
export type Finding = z.infer<typeof InspectResult>['findings'][number];

/** Ein Standbild für die Prüfung: "Seite 2 (Saray Market) DE" + Datei (verkleinert). */
export interface Still {
  label: string;
  file: string;
}

export interface StoryInspector {
  name: string;
  /** `fingerprint`: Inhalt des Videos (story.json + Bilder) – Screenshots sind nie ganz bytegleich, taugen also nicht zum Merken */
  inspect(stills: Still[], data: string, fingerprint?: string): Promise<Finding[]>;
}

export const INSPECT_PROMPT = (data: string) => `Du prüfst ein fertiges Instagram-Video eines türkischen Supermarkts in Deutschland, bevor es veröffentlicht wird. Die Bilder oben sind Standbilder jeder Seite (deutsche und türkische Fassung) und danach jedes Produktbild einzeln auf grauem Grund. Unten steht, was im Video stehen soll.

Prüfe jedes Produktbild auf Artefakte vom Ausschneiden aus dem Prospekt:
- Reste von Preisschild, Preis, Schrift, Logo oder Sticker im Bild
- Reste vom Hintergrund, vom Holzbrett/Podest oder von einem Nachbarprodukt
- Packung oder Produkt abgeschnitten, Löcher, zackige oder ausgefranste Kanten, Flecken, doppelte Ränder
- Bild zeigt ein anderes Produkt als der Name
Ein Foto mit natürlichem Hintergrund (frisches Fleisch auf Brett mit Kräutern) ist gewollt, solange kein Preis oder Text darin steht.

Melde außerdem nur echte Unstimmigkeiten im Video, zum Beispiel:
- Produktfoto passt nicht zum Namen (Name „Reis“, Foto zeigt Nudeln; Name „Hähnchenbrust“, Foto zeigt Hack)
- Preis oder Menge im Bild weicht von den Daten ab, oder ein Preis ist für das Produkt unplausibel (Hähnchenbrust 5 kg für 0,29 €, Tee 800 g für 29,90 €)
- dasselbe Produkt zweimal auf einer Seite
- Text abgeschnitten, überlappend oder unlesbar
- falsche Sprache: türkische Fassung mit deutschen Produktnamen oder umgekehrt (Marken zählen nicht)
- türkischer Name ist eine falsche Übersetzung
- Markt, Adresse oder Datum passen nicht zusammen

Nicht melden: Geschmack, Design, Bildausschnitt oder Bildqualität ohne echten Fehler. Ist alles stimmig, gib eine leere Liste zurück.

Daten:
${data}`;

export class ClaudeInspector implements StoryInspector {
  name = CHECK_MODEL;
  private client: Anthropic;
  constructor(apiKey = process.env.ANTHROPIC_API_KEY, baseURL?: string) {
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt');
    this.client = new Anthropic({ apiKey, baseURL, maxRetries: 4 });
  }

  async inspect(stills: Still[], data: string) {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const [i, s] of stills.entries()) content.push({ type: 'text', text: `Bild ${i + 1}: ${s.label}` }, await image(s.file));
    content.push({ type: 'text', text: INSPECT_PROMPT(data) });
    const res = await this.client.beta.messages.parse({
      model: CHECK_MODEL,
      max_tokens: 8000,
      ...fallbackParams(CHECK_MODEL),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: betaZodOutputFormat(InspectResult) },
      messages: [{ role: 'user', content }],
    });
    await logUsage({ model: CHECK_MODEL, task: 'pruefung', input: res.usage.input_tokens, output: res.usage.output_tokens });
    if (res.stop_reason === 'refusal') throw new Error('Prüfung abgelehnt (refusal)');
    if (!res.parsed_output) throw new Error('Prüfung: Antwort nicht lesbar');
    return res.parsed_output.findings;
  }
}

/** Gleiches Video (gleiche Bilder, gleiche Daten) wird nur einmal geprüft – ein erneuter Export kostet nichts. */
export class CachingInspector implements StoryInspector {
  name: string;
  hits = 0;
  constructor(private inner: StoryInspector, private dir = aiCacheDir()) {
    this.name = inner.name;
  }

  async inspect(stills: Still[], data: string, fingerprint?: string) {
    const salt = `inspect|${stills.map((s) => s.label).join('|')}|${data}`;
    const key = fingerprint ? createHash('sha256').update(`${salt}|${fingerprint}`).digest('hex').slice(0, 32) : await hashFiles(stills.map((s) => s.file), salt);
    const f = join(this.dir, `${key}.json`);
    if (existsSync(f)) {
      try {
        const v = InspectResult.shape.findings.parse(JSON.parse(await readFile(f, 'utf8')));
        this.hits++;
        return v;
      } catch {
        /* kaputt → neu prüfen */
      }
    }
    const v = await this.inner.inspect(stills, data);
    await mkdir(this.dir, { recursive: true });
    await writeFile(f, JSON.stringify(v));
    return v;
  }
}
