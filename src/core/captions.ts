import { formatDateRange, hashtag, joinLines as lineName, turkishLocative } from './format';
import type { Lang, Story } from './schema';
import { badgeText } from './badges';

/**
 * Instagram-Bildtext (DE/TR) mit Angeboten und Hashtags. Ohne KI – kostet nichts
 * und ist sofort da. Nach dem Design System: kein Imperativ, als Emoji höchstens 🐿. Wird beim Export als Textdatei mitgeliefert.
 */
const tag = hashtag;

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
    return `– ${lineName(o.name[lang])}: ${o.price} €${unit ? ` (${unit})` : ''}${o.badge ? ` · ${badgeText(o, lang)}` : ''}`;
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
      `${head} bei ${m.name}!${handle}`,
      `Gültig ${dates}`,
      ...(story.banner?.de ? [story.banner.de] : []),
      '',
      ...offers,
      '',
      m.addresses.join(' · '),
      "Alle Angebote in der sincapp App, kostenlos. Wissen, wo's günstig ist. 🐿",
      '',
      [...tags].join(' '),
    ].join('\n');
  }
  return [
    `${head} – ${turkishLocative(m.name)}!${handle}`,
    `Geçerlilik: ${dates}`,
    ...(story.banner?.tr ? [story.banner.tr] : []),
    '',
    ...offers,
    '',
    m.addresses.join(' · '),
    'Tüm fırsatlar sincapp uygulamasında, ücretsiz. Ucuzu bilenler. 🐿',
    '',
    [...tags].join(' '),
  ].join('\n');
}
