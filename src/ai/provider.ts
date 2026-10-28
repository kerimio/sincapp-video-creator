import { ClaudeReader, type PageReader } from '../extract/claude';
import { ClaudeMatcher, type ProductMatcher } from '../images/match';
import { GeminiMatcher, GeminiReader } from './gemini';

export type AiProvider = 'claude' | 'gemini';

/**
 * Welche KI liest die Prospekte? Die, deren Key eingetragen ist.
 * Sind beide da, gewinnt SINCAPP_AI (claude|gemini), sonst Claude.
 */
export function aiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  const want = env.SINCAPP_AI?.toLowerCase();
  if (want === 'gemini' && env.GEMINI_API_KEY) return 'gemini';
  if (want === 'claude' && env.ANTHROPIC_API_KEY) return 'claude';
  if (env.ANTHROPIC_API_KEY) return 'claude';
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
}

export const NO_AI_KEY = 'Zum Auslesen fehlt ein KI-Key (Anthropic oder Google Gemini) – bitte unter Einstellungen eintragen.';

export function makeReader(): PageReader {
  const p = aiProvider();
  if (p === 'gemini') return new GeminiReader();
  if (p === 'claude') return new ClaudeReader();
  throw new Error(NO_AI_KEY);
}

/** Abgleich Internet-Bild ↔ Prospekt; null ohne Key (dann wird nur vorgeschlagen, nicht automatisch übernommen). */
export function makeMatcher(): ProductMatcher | null {
  const p = aiProvider();
  return p === 'gemini' ? new GeminiMatcher() : p === 'claude' ? new ClaudeMatcher() : null;
}
