// Instagram-API: Konto lesen, Container anlegen, veröffentlichen, Token verlängern.
// Zwei Arten von Token: Instagram-Login (graph.instagram.com) und Facebook-Login / „Unified Login“ bei neueren Meta-Apps
// (graph.facebook.com, z. B. Systemnutzer-Token). Welche es ist, merkt `me()` beim ersten Aufruf – die Endpunkte sind gleich.
// Der Token steht nie in einer Fehlermeldung oder im Log – Meldungen kommen nur aus dem Fehlertext von Instagram.

const IG_HOST = 'https://graph.instagram.com';
const FB_HOST = 'https://graph.facebook.com';
const VERSION = 'v25.0';
/** Token → Host, damit nicht jeder neue Client erneut ausprobiert */
const hosts = new Map<string, string>();

type Fetch = typeof fetch;
type Params = Record<string, string | number | boolean | object | undefined>;

export interface IgAccount {
  id: string;
  username: string;
}

export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED';

/** Instagram-Fehler in verständlichem Deutsch; die häufigen Fälle bekommen einen Hinweis, was zu tun ist. */
export function igErrorText(e: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } | undefined, status: number) {
  const msg = e?.error_user_msg || e?.message || `HTTP ${status}`;
  if (e?.code === 190) return 'Der Instagram-Zugang ist abgelaufen oder ungültig. Bitte in den Einstellungen einen neuen Token eintragen.';
  if (e?.code === 10 || e?.code === 200) return `Instagram erlaubt das nicht (fehlende Berechtigung): ${msg}`;
  if (e?.code === 4 || e?.code === 9 || e?.error_subcode === 2207042) return 'Instagram-Limit erreicht (höchstens 100 Beiträge pro 24 Stunden). Bitte später erneut versuchen.';
  return `Instagram: ${msg}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class InstagramClient {
  constructor(
    private token: string,
    private fetchImpl: Fetch = fetch,
    private wait: (ms: number) => Promise<void> = sleep,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, params: Params = {}, host?: string): Promise<T> {
    if (!host && !hosts.has(this.token)) await this.me();
    host ??= hosts.get(this.token)!;
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    body.set('access_token', this.token);
    const url = `${host}${path.startsWith('/refresh') ? '' : `/${VERSION}`}${path}`;
    let res: Response;
    try {
      res = method === 'GET' ? await this.fetchImpl(`${url}?${body}`, { signal: AbortSignal.timeout(60_000) }) : await this.fetchImpl(url, { method, body, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new Error(`Instagram nicht erreichbar (${(e as Error).name === 'TimeoutError' ? 'Zeitüberschreitung' : 'keine Verbindung'})`);
    }
    const data = (await res.json().catch(() => ({}))) as { error?: Parameters<typeof igErrorText>[0] } & T;
    if (!res.ok || data.error) throw new Error(igErrorText(data.error, res.status));
    return data;
  }

  /**
   * Eigenes Instagram-Konto, unter dem veröffentlicht wird. Erst Instagram-Login probieren, sonst Facebook-Login:
   * dort hängt das Instagram-Konto an einer Facebook-Seite (`/me/accounts`) oder der Token gehört direkt zum Instagram-Konto.
   */
  async me(): Promise<IgAccount> {
    let first: Error;
    try {
      const r = await this.call<{ user_id?: string; id: string; username: string }>('GET', '/me', { fields: 'user_id,username' }, IG_HOST);
      hosts.set(this.token, IG_HOST);
      return { id: r.user_id ?? r.id, username: r.username };
    } catch (e) {
      first = e as Error;
      if (/nicht erreichbar/.test(first.message)) throw first;
    }
    const direct = await this.call<{ id: string; username?: string }>('GET', '/me', { fields: 'id,username' }, FB_HOST).catch(() => null);
    if (direct?.username) {
      hosts.set(this.token, FB_HOST);
      return { id: direct.id, username: direct.username };
    }
    const pages = await this.call<{ data?: { instagram_business_account?: { id: string; username?: string } }[] }>('GET', '/me/accounts', { fields: 'instagram_business_account{id,username}' }, FB_HOST).catch(() => null);
    const ig = pages?.data?.find((p) => p.instagram_business_account)?.instagram_business_account;
    if (ig) {
      hosts.set(this.token, FB_HOST);
      return { id: ig.id, username: ig.username ?? ig.id };
    }
    if (pages) throw new Error('Der Token gehört zu keinem Instagram-Business-Konto. Beim Erzeugen des Tokens das Instagram-Konto (bzw. die Facebook-Seite mit dem Instagram-Konto) auswählen.');
    throw first;
  }

  /** Instagram-Login-Token lassen sich verlängern; Facebook-/Systemnutzer-Token nicht (laufen 60 Tage bzw. nie ab). */
  get refreshable() {
    return hosts.get(this.token) === IG_HOST;
  }

  async createContainer(igId: string, params: Params): Promise<string> {
    return (await this.call<{ id: string }>('POST', `/${igId}/media`, params)).id;
  }

  async status(containerId: string): Promise<{ code: ContainerStatus; text?: string }> {
    const r = await this.call<{ status_code: ContainerStatus; status?: string }>('GET', `/${containerId}`, { fields: 'status_code,status' });
    return { code: r.status_code, text: r.status };
  }

  /** Wartet, bis Instagram die Datei geladen und verarbeitet hat (Videos brauchen bis zu ein paar Minuten). */
  async waitFinished(containerId: string, timeoutMs = 10 * 60_000, everyMs = 5_000) {
    for (let waited = 0; ; waited += everyMs) {
      const s = await this.status(containerId);
      if (s.code === 'FINISHED' || s.code === 'PUBLISHED') return;
      if (s.code === 'ERROR' || s.code === 'EXPIRED') throw new Error(`Instagram konnte die Datei nicht verarbeiten${s.text ? `: ${s.text}` : ''}`);
      if (waited >= timeoutMs) throw new Error('Instagram verarbeitet die Datei zu lange – bitte später erneut versuchen');
      await this.wait(everyMs);
    }
  }

  async publish(igId: string, containerId: string): Promise<string> {
    return (await this.call<{ id: string }>('POST', `/${igId}/media_publish`, { creation_id: containerId })).id;
  }

  async permalink(mediaId: string): Promise<string | null> {
    return (await this.call<{ permalink?: string }>('GET', `/${mediaId}`, { fields: 'permalink' }).catch(() => ({ permalink: undefined }))).permalink ?? null;
  }

  /** Wie viele Beiträge in den letzten 24 Stunden schon über die API veröffentlicht wurden (Limit 100). */
  async quota(igId: string): Promise<{ used: number; total: number } | null> {
    const r = await this.call<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>('GET', `/${igId}/content_publishing_limit`, { fields: 'quota_usage,config' }).catch(() => null);
    const d = r?.data?.[0];
    return d ? { used: d.quota_usage ?? 0, total: d.config?.quota_total ?? 100 } : null;
  }

  /** Langlebigen Token um 60 Tage verlängern (geht, sobald er mindestens 24 h alt ist). */
  async refresh(): Promise<string> {
    if (!hosts.has(this.token)) await this.me();
    if (!this.refreshable) return this.token;
    return (await this.call<{ access_token: string }>('GET', '/refresh_access_token', { grant_type: 'ig_refresh_token' })).access_token;
  }
}
