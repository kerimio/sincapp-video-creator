// Wählt den KI-Anbieter (Claude oder Gemini) anhand der Einstellungen und hängt immer den Antwort-Cache davor.
import { CachingMatcher, CachingReader } from './cache';
import { ClaudeReader, type PageReader } from '../extract/claude';
import { ClaudeMatcher, type ProductMatcher } from '../images/match';
import { GeminiMatcher, GeminiReader, geminiCheckModel, geminiModel } from './gemini';
import { CHECK_MODEL, MODEL } from '../extract/claude';

export type AiProvider = 'claude' | 'gemini';

/**
 * Welche KI liest die Prospekte? Die, deren Key eingetragen ist.
 * Sind beide da, gewinnt SINCAPP_AI (claude|gemini), sonst Gemini (Flash ist am günstigsten).
 */
export function aiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const want = env.SINCAPP_AI?.toLowerCase();
  if (want === 'gemini' && env.GEMINI_API_KEY) return 'gemini';
  if (want === 'claude' && env.ANTHROPIC_API_KEY) return 'claude';
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.ANTHROPIC_API_KEY) return 'claude';
  return null;
}

export const NO_AI_KEY = 'Zum Auslesen fehlt ein KI-Key (Anthropic oder Google Gemini) – bitte unter Einstellungen eintragen.';

export function makeReader(): PageReader {
  const p = aiProvider();
  if (p === 'gemini') return new CachingReader(new GeminiReader());
  if (p === 'claude') return new CachingReader(new ClaudeReader());
  throw new Error(NO_AI_KEY);
}

/** Abgleich Internet-Bild ↔ Prospekt; null ohne Key (dann wird nur vorgeschlagen, nicht automatisch übernommen). */
export function makeMatcher(): ProductMatcher | null {
  const p = aiProvider();
  const m = p === 'gemini' ? new GeminiMatcher() : p === 'claude' ? new ClaudeMatcher() : null;
  return m && new CachingMatcher(m);
}

/** Welche Modelle gerade benutzt würden (für die Einstellungen). */
export function currentModels() {
  const p = aiProvider();
  if (p === 'gemini') return { read: geminiModel(), check: geminiCheckModel() };
  if (p === 'claude') return { read: MODEL, check: CHECK_MODEL };
  return null;
}
