import { CoreError, publicCreature } from './types';
import type { Campaign, CatalogManifest, CtaEvent, FamilyPage, FamilyParams, FamilyRoot, MinePage,
  OperationResult, PageParams, PendingCommand, PeredaiApi, Session, SharePreview, ShareView } from './types';

type FetchLike = typeof fetch;
function liveToken(token: string): void {
  if (token.startsWith('demo.')) throw new CoreError('DEMO_TOKEN_NOT_LIVE', 'Демонстрационная ссылка не является серверной.');
}
function query(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) q.set(key, String(value));
  return q.size ? `?${q}` : '';
}
function invalid(): never { throw new CoreError('INVALID_RESPONSE', 'Сервер вернул неподдерживаемый ответ.'); }
function object(x: unknown): Record<string, any> { if (!x || typeof x !== 'object' || Array.isArray(x)) invalid(); return x as Record<string, any>; }
function string(x: unknown): string { if (typeof x !== 'string') invalid(); return x; }
function nullableString(x: unknown): string | null { return x === null ? null : string(x); }
export function parseShare(input: unknown): ShareView {
  const x = object(input);
  const url = string(x.url);
  // Prevent a malformed response becoming an executable href.
  if (!/^https?:\/\//.test(url) && !/^\/(?!\/)/.test(url)) invalid();
  return { url, token: string(x.token), source_revision_id: string(x.source_revision_id) };
}
export function parsePreview(input: unknown): SharePreview {
  const x = object(input), creature = publicCreature(x.creature), viewer = object(x.viewer);
  const states = ['needs_session', 'choose', 'already_contributed', 'self', 'complete', 'unavailable', 'unresolved'];
  if (!states.includes(viewer.state) || !Array.isArray(x.options)) invalid();
  const options = x.options.map((v: unknown) => { const o = object(v); return {
    choice_id: string(o.choice_id), label: string(o.label), preview_asset: nullableString(o.preview_asset),
    ...(typeof o.artwork_supported === 'boolean' ? { artwork_supported: o.artwork_supported } : {}),
  }; });
  if (creature.is_complete && (viewer.state !== 'complete' || x.next_step !== null || options.length !== 0)) invalid();
  if (viewer.state === 'complete' && !creature.is_complete) invalid();
  if (viewer.state === 'choose' || viewer.state === 'needs_session') {
    if (x.next_step !== creature.step + 1 || options.length !== 3 ||
        options.some((o: { choice_id: string }, i: number) => o.choice_id !== `${String(x.next_step).padStart(2, '0')}${'ABC'[i]}`)) invalid();
  }
  if (viewer.state === 'already_contributed' && typeof viewer.existing_creature_id !== 'string') invalid();
  if (x.next_step !== null && (!Number.isInteger(x.next_step) || x.next_step < 2 || x.next_step > 16)) invalid();
  return { creature, brand: string(x.brand), offer: string(x.offer), cta_target: nullableString(x.cta_target),
    next_step: x.next_step, options, viewer: { state: viewer.state,
      existing_creature_id: nullableString(viewer.existing_creature_id), ...(viewer.reason === 'D01' ? { reason: 'D01' } : {}) } };
}

/** Real REST transport only. No automatic local fallback, credentials or mock results. */
export function createRestApi(options: { baseUrl?: string; fetch?: FetchLike } = {}): PeredaiApi {
  const base = (options.baseUrl ?? '/api/v1').replace(/\/$/, '');
  if (!/^\/(?!\/)/.test(base)) throw new CoreError('INVALID_CONFIG', 'API должен находиться на текущем origin.');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  async function request(path: string, init: RequestInit = {}): Promise<{ data: unknown; status: number }> {
    let response: Response;
    try { response = await fetcher(`${base}${path}`, { ...init, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }); }
    catch { throw new CoreError('NETWORK_ERROR', 'Не удалось определить результат запроса.'); }
    let data: unknown;
    try { data = response.status === 204 ? null : await response.json(); }
    catch { throw new CoreError('INVALID_RESPONSE', 'Ответ сервера не удалось прочитать.', response.status >= 400 ? response.status : 0); }
    if (!response.ok) {
      const error = (data as { error?: { code?: unknown; request_id?: unknown } })?.error;
      throw new CoreError(typeof error?.code === 'string' ? error.code : 'HTTP_ERROR',
        'Запрос не выполнен. Состояние можно проверить повторно.', response.status,
        response.headers.get('Retry-After'), typeof error?.request_id === 'string' ? error.request_id : undefined);
    }
    return { data, status: response.status };
  }
  const get = async (path: string) => (await request(path)).data;
  return {
    mode: 'live',
    async getSession() { const x = object(await get('/session'));
      if (!x.csrf_token || !x.profile_id) invalid(); return { csrf_token: string(x.csrf_token), profile_id: string(x.profile_id) }; },
    async bootstrapSession() { await request('/session', { method: 'POST', body: '{}' }); },
    async getCampaign(slug) { const x = object(await get(`/campaigns/${encodeURIComponent(slug)}`));
      if (typeof x.contributions_available !== 'boolean') invalid();
      return { slug, brand: string(x.brand), offer: string(x.offer), cta_target: nullableString(x.cta_target),
        active_catalog_version: string(x.active_catalog_version), contributions_available: x.contributions_available } satisfies Campaign; },
    async getCatalog(version) { const x = object(await get(`/catalogs/${encodeURIComponent(version)}`));
      if (x.version !== version || x.total_steps !== 16 || !Array.isArray(x.bases) || !Array.isArray(x.steps)) invalid();
      return x as unknown as CatalogManifest; },
    async getCreature(id) { return publicCreature(await get(`/creatures/${encodeURIComponent(id)}`)); },
    async getShare(token) { liveToken(token); return parsePreview(await get(`/shares/${encodeURIComponent(token)}`)); },
    async getMine(params: PageParams = {}) { const x = object(await get(`/me/creatures${query({ ...params })}`));
      if (!Array.isArray(x.items)) invalid();
      return { items: x.items.map(publicCreature), next_cursor: nullableString(x.next_cursor) } satisfies MinePage; },
    async getFamily(root: FamilyRoot, params: FamilyParams = {}) {
      if (root.kind === 'share') liveToken(root.token);
      const path = root.kind === 'share' ? `/shares/${encodeURIComponent(root.token)}` : `/creatures/${encodeURIComponent(root.id)}`;
      const x = object(await get(`${path}/family${query({ ...params })}`));
      if (!Array.isArray(x.items)) invalid();
      return { root_id: string(x.root_id), parent_id: string(x.parent_id), next_cursor: nullableString(x.next_cursor),
        items: x.items.map((raw: unknown) => { const row = object(raw); if (typeof row.has_children !== 'boolean') invalid();
          return { creature: publicCreature(row.creature), has_children: row.has_children }; }) } satisfies FamilyPage;
    },
    async execute(command: PendingCommand, session: Session): Promise<OperationResult> {
      if (command.mode !== 'live' || command.profile_id !== session.profile_id) throw new CoreError('PROFILE_CHANGED', 'Изменился браузерный профиль.');
      if (command.kind === 'create_offspring') liveToken(command.target);
      const path = command.kind === 'create_root' ? '/creatures' : command.kind === 'create_share'
        ? `/creatures/${encodeURIComponent(command.target)}/shares` : `/shares/${encodeURIComponent(command.target)}/offspring`;
      const { data } = await request(path, { method: 'POST', body: command.body_json,
        headers: { 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': command.key } });
      if (command.kind === 'create_share') return { kind: 'share', value: parseShare(data) };
      const x = object(data); if (typeof x.existing !== 'boolean') invalid();
      return { kind: 'contribution', value: { creature: publicCreature(x.creature), existing: x.existing } };
    },
    async reportEvent(event: CtaEvent, session: Session) {
      if (event.share_token) liveToken(event.share_token);
      if (Number(!!event.share_token) + Number(!!event.creature_id) !== 1) throw new CoreError('INVALID_REQUEST', 'Нужен один контекст события.');
      const { status } = await request('/events', { method: 'POST', body: JSON.stringify(event), headers: { 'X-CSRF-Token': session.csrf_token } });
      if (status !== 200 && status !== 202) invalid(); return { status };
    },
  };
}
