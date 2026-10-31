// Produktbilder ohne KI auf Artefakte prüfen (tools/artifacts.py): schon beim Erstellen, damit man ein schlechtes Bild vor dem Rendern tauscht.
import { runPython } from '../python';

/**
 * Warnungen je Bild in derselben Reihenfolge ("2 lose Flecken neben dem Produkt …"); leer = unauffällig.
 * Ein Python-Prozess für alle Bilder. Klappt die Prüfung nicht (kein Python), gibt es einfach keine Warnungen.
 */
export async function imageArtifacts(files: string[]): Promise<string[][]> {
  if (!files.length) return [];
  try {
    const lines = await runPython('artifacts.py', [], files.map((image, i) => ({ id: String(i), image })));
    const out: string[][] = files.map(() => []);
    for (const l of lines) {
      const r = JSON.parse(l) as { id: string; warnings: string[] };
      out[Number(r.id)] = r.warnings;
    }
    return out;
  } catch {
    return files.map(() => []);
  }
}
