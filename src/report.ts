import { formatDateRange } from './core/format';
import type { Extraction } from './extract/schema';

/** report.md: was erkannt wurde und was jemand prüfen sollte. */
export function extractionReport(ex: Extraction, extra: { seconds?: number; notes?: string[] } = {}) {
  const L: string[] = [];
  const flagged = ex.offers.filter((o) => o.priceConfidence < 0.9 || o.warnings.length);
  L.push(`# Bericht: Extraktion`, '');
  L.push(`- Markt: ${ex.market ?? '**nicht erkannt**'}`);
  L.push(`- Gültig: ${ex.validFrom && ex.validTo ? formatDateRange(ex.validFrom, ex.validTo) : '**nicht erkannt**'}`);
  L.push(`- Adressen: ${ex.addresses.length ? ex.addresses.join(' · ') : '**keine erkannt**'}`);
  if (ex.phone) L.push(`- Telefon: ${ex.phone}`);
  L.push(`- Seiten: ${ex.pages.length}, Angebote: ${ex.offers.length}, davon zu prüfen: ${flagged.length}`);
  L.push(`- Gelesen mit: ${ex.model}${extra.seconds ? `, Dauer ${extra.seconds.toFixed(0)} s` : ''}`, '');

  L.push('## Angebote', '');
  L.push('| ID | Marke | Name DE | Name TR (Zeilen) | Menge | Preis | Preis sicher | Bild |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const o of ex.offers) {
    const sure = o.priceConfidence >= 0.9 ? '✓' : `⚠ ${o.priceConfidence.toFixed(2)}`;
    const img = o.img ? (o.warnings.some((w) => w.startsWith('Bild:')) ? '⚠' : '✓') : '✗';
    L.push(`| ${o.id} | ${o.brand ?? ''} | ${o.name.de}${o.note ? ` (${o.note.de})` : ''} | ${o.lines.tr.join(' / ')} | ${o.unit ?? ''} | ${o.price ?? '–'} | ${sure} | ${img} |`);
  }
  L.push('');

  const notes = [...ex.warnings, ...(extra.notes ?? [])];
  if (flagged.length || notes.length) {
    L.push('## Bitte prüfen', '');
    for (const w of notes) L.push(`- ${w}`);
    for (const o of flagged) for (const w of o.warnings) L.push(`- **${o.id}** ${o.brand ?? ''} ${o.name.de}: ${w}`);
    for (const o of flagged) if (o.priceConfidence < 0.9 && !o.warnings.some((w) => w.startsWith('Preis'))) L.push(`- **${o.id}**: Preis ${o.price ?? '–'} nicht sicher (${o.priceConfidence.toFixed(2)})`);
    L.push('');
  } else {
    L.push('Keine Auffälligkeiten.', '');
  }
  return L.join('\n');
}
