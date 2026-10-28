import { formatDateRange, turkishLocative } from './format';
import type { Lang, Story } from './schema';

/**
 * Instagram-Bildtext (DE/TR) mit Angeboten und Hashtags. Ohne KI – kostet nichts
 * und ist sofort da. Wird beim Export als Textdatei mitgeliefert.
 */
const lineName = (lines: string[]) =>
  lines.reduce((acc, l) => (!acc ? l : acc.endsWith('-') ? (/^\p{Lu}/u.test(l) ? acc + l : acc.slice(0, -1) + l.toLowerCase()) : `${acc} ${l}`), '');

const tag = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/ı/g, 'i').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

export function cityOf(address: string): string | null {
  const m = address.match(/\b\d{5}\s+([A-Za-zÄÖÜäöüß-]+)/);
  return m ? m[1] : null;
}

export function caption(story: Story, lang: Lang): string {
  const dates = formatDateRange(story.dates.from, story.dates.to);
  const m = story.market;
  const unitOf = (u: Story['offers'][number]['unit']) => (typeof u === 'string' ? u : u?.[lang]);
  const offers = story.offers.map((o) => {
    const unit = unitOf(o.unit);
    return `✅ ${lineName(o.name[lang])} – ${o.price} €${unit ? ` (${unit})` : ''}`;
  });
  const city = cityOf(m.addresses[0] ?? '');
  const head = story.headline[lang].join(' ').replace(/- /g, '');
  const tags = new Set<string>();
  const add = (t: string | null) => t && tags.add(`#${tag(t)}`);
  if (lang === 'de') {
    ['angebote', 'wochenangebote', 'sparen', 'supermarkt'].forEach(add);
    add(`angebote${city ?? ''}`);
  } else {
    ['indirim', 'kampanya', 'firsat', 'turkmarket'].forEach(add);
  }
  add(m.name);
  add(city);
  add('sincapp');
  const handle = m.instagram ? ` @${m.instagram}` : '';
  if (lang === 'de') {
    return [
      `🔥 ${head} bei ${m.name}!${handle}`,
      `🗓 Gültig ${dates}`,
      '',
      ...offers,
      '',
      `📍 ${m.addresses.join(' · ')}`,
      '📲 Alle Angebote in der sincapp App – jetzt kostenlos laden!',
      '',
      [...tags].join(' '),
    ].join('\n');
  }
  return [
    `🔥 ${head} – ${turkishLocative(m.name)}!${handle}`,
    `🗓 Geçerlilik: ${dates}`,
    '',
    ...offers,
    '',
    `📍 ${m.addresses.join(' · ')}`,
    '📲 Tüm fırsatlar sincapp uygulamasında – hemen ücretsiz indir!',
    '',
    [...tags].join(' '),
  ].join('\n');
}
