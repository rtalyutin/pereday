/** Local, unauthenticated demonstration. This file is never used as a REST fallback. */
import { CoreError, publicCreature } from './types';
import type { Campaign, CtaEvent, DemoCatalog, FamilyParams, FamilyRoot, OperationResult, PageParams,
  PendingCommand, PeredaiApi, Session, SharePreview, ShareView, StorageLike, CreatureView } from './types';

const LABELS: readonly (readonly string[])[] = [
  ['Один глаз-яичница', 'Два глаза-фары', 'Три глаза-горошины'],
  ['Застёжка-молния', 'Улыбка из клавиш пианино', 'Щель банкомата'],
  ['Куриные лапы в носках', 'Миниатюрные гусеницы', 'Пружины в тапочках'],
  ['Макаронные щупальца', 'Клешни-прищепки', 'Надутые резиновые перчатки'],
  ['Спутниковая тарелка', 'Пучок брокколи', 'Корона из сосисок'],
  ['Ложки-локаторы', 'Уши из чайных пакетиков', 'Плавники из чеков'],
  ['Иллюминатор с маленькой грозой', 'Пломба «НЕ ВСКРЫВАТЬ»', 'Кнопка «НЕ НАЖИМАТЬ»'],
  ['Вафельные крылья', 'Веер из квитанций', 'Пара кухонных лопаток'],
  ['Шнур с вилкой', 'Хвост-круассан', 'Пружина с колокольчиком'],
  ['Созвездия-веснушки', 'Леопардовые огурцы', 'Мелкие штампы «БРАК»'],
  ['Скипетр-вантуз', 'Чемодан с зубами', 'Банка с маленькой чёрной дырой'],
  ['Картофельный ангел', 'Улитка-сирена', 'Глаз на крошечных ножках'],
  ['Кольцо из скрепок', 'Орбита из сосисок', 'Кольцо из потерянных носков'],
  ['Лужа звёзд', 'Крошки радуги', 'Печать «ОДОБРЕНО БЕЗДНОЙ»'],
  ['«НЕ КОРМИТЬ ЛОГИКОЙ»', '«СБОЙ, НО МОЙ»', '«ВЫЗВАЛИ — ТЕРПИТЕ»'],
];
interface Node { view: CreatureView; owner_id: string | null; parent_id: string | null; ancestor_ids: string[] }
interface Receipt { fingerprint: string; result: OperationResult }
interface Database { version: 1; nodes: Record<string, Node>; receipts: Record<string, Receipt>; events: Record<string, string> }
export interface DemoOptions {
  storage: StorageLike; origin: string; catalog: DemoCatalog; campaign?: Partial<Campaign>; namespace?: string;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const id = () => crypto.randomUUID();
function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string): unknown {
  if (value.length > 24000) throw new CoreError('NOT_FOUND', 'Демонстрационная ссылка недоступна.', 404);
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); }
  catch { throw new CoreError('NOT_FOUND', 'Демонстрационная ссылка недоступна.', 404); }
}
function fail(code: string, status = 409): never { throw new CoreError(code, 'Локальный демонстрационный запрос не выполнен.', status); }

function makeDemoApi(options: DemoOptions, profileSlot = 'browser'): PeredaiApi {
  const ns = options.namespace ?? 'peredai:demo:v1';
  const databaseKey = `${ns}:database`, profileKey = `${ns}:profile:${profileSlot}`;
  const origin = new URL(options.origin).origin;
  const campaign: Campaign = { slug: 'peredai', brand: 'Передай', offer: 'Демонстрация одного вклада и передачи.',
    cta_target: null, active_catalog_version: options.catalog.version, contributions_available: true, ...options.campaign };
  function read(): Database {
    const raw = options.storage.getItem(databaseKey);
    if (!raw) return { version: 1, nodes: {}, receipts: {}, events: {} };
    try { const db = JSON.parse(raw) as Database; if (db.version !== 1 || !db.nodes || !db.receipts || !db.events) throw new Error(); return db; }
    catch { fail('DEMO_STORAGE_CORRUPT', 0); }
  }
  function write(db: Database) { try { options.storage.setItem(databaseKey, JSON.stringify(db)); } catch { fail('STORAGE_UNAVAILABLE', 0); } }
  const profile = () => options.storage.getItem(profileKey);
  function session(): Session { const p = profile(); if (!p) fail('SESSION_REQUIRED', 401); return { profile_id: p, csrf_token: `demo-csrf-${p}` }; }
  function checkSession(s: Session) { const current = session(); if (s.profile_id !== current.profile_id) fail('SESSION_REQUIRED', 401); if (s.csrf_token !== current.csrf_token) fail('CSRF_REJECTED', 403); }
  function own(db: Database, creatureId: string): Node {
    const p = session().profile_id, node = db.nodes[creatureId]; if (!node || node.owner_id !== p) fail('NOT_FOUND', 404); return node;
  }
  function snapshot(token: string, db: Database): Node {
    if (!token.startsWith('demo.')) fail('NOT_FOUND', 404);
    const payload = decode(token.slice(5)) as { creature?: unknown; ancestor_ids?: unknown };
    let view: CreatureView;
    try { view = publicCreature(payload.creature); } catch { return fail('NOT_FOUND', 404); }
    if (!view.id.startsWith('demo-') || !Array.isArray(payload.ancestor_ids) || payload.ancestor_ids.length !== view.step - 1 ||
        payload.ancestor_ids.some(x => typeof x !== 'string' || !x.startsWith('demo-')) ||
        new Set(payload.ancestor_ids).size !== payload.ancestor_ids.length || payload.ancestor_ids.includes(view.id)) fail('NOT_FOUND', 404);
    const known = db.nodes[view.id];
    // A token is a demo snapshot, not permission to alter a known immutable node.
    if (known) { if (JSON.stringify(known.view) !== JSON.stringify(view) || JSON.stringify(known.ancestor_ids) !== JSON.stringify(payload.ancestor_ids)) fail('SOURCE_MISMATCH'); return known; }
    return { view, owner_id: null, parent_id: payload.ancestor_ids.at(-1) ?? null, ancestor_ids: payload.ancestor_ids as string[] };
  }
  function share(node: Node): ShareView {
    const token = `demo.${encode({ creature: publicCreature(node.view), ancestor_ids: node.ancestor_ids })}`;
    return { token, url: `${origin}/s/${token}`, source_revision_id: node.view.revision_id };
  }
  function preview(node: Node, db: Database): SharePreview {
    const p = profile(), v = node.view;
    let state: SharePreview['viewer']['state'];
    let existingId: string | null = null;
    if (v.is_complete) state = 'complete';
    else if (node.owner_id && node.owner_id === p) state = 'self';
    else {
      const existing = p && Object.values(db.nodes).find(n => n.parent_id === v.id && n.owner_id === p);
      if (existing) { state = 'already_contributed'; existingId = existing.view.id; }
      else if (p && node.ancestor_ids.some(ancestor => db.nodes[ancestor]?.owner_id === p)) state = 'unresolved';
      else if (!campaign.contributions_available || v.catalog_version !== options.catalog.version) state = 'unavailable';
      else state = p ? 'choose' : 'needs_session';
    }
    const next = state === 'choose' || state === 'needs_session' ? v.step + 1 : null;
    const metadata = next ? options.catalog.steps.find(s => s.step === next) : undefined;
    const choices = next ? ['A', 'B', 'C'].map((letter, index) => {
      const choice_id = `${String(next).padStart(2, '0')}${letter}`, option = metadata?.options.find(o => o.choice_id === choice_id);
      const asset = option && options.catalog.assets[option.asset_id];
      return { choice_id, label: option?.label ?? LABELS[next - 2][index], preview_asset: asset?.src ?? null, artwork_supported: !!asset };
    }) : [];
    return { creature: publicCreature(v), brand: campaign.brand, offer: campaign.offer, cta_target: campaign.cta_target,
      next_step: next, options: choices, viewer: { state, existing_creature_id: existingId, ...(state === 'unresolved' ? { reason: 'D01' as const } : {}) } };
  }
  function page<T>(items: T[], params: PageParams, scope: string, getId: (value: T) => string) {
    const limit = params.limit ?? 10; if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('INVALID_REQUEST', 400);
    let start = 0;
    if (params.cursor) {
      const cursor = decode(params.cursor) as { scope?: string; after?: string };
      if (cursor.scope !== scope || typeof cursor.after !== 'string') fail('INVALID_REQUEST', 400);
      const index = items.findIndex(item => getId(item) === cursor.after); if (index === -1) fail('INVALID_REQUEST', 400); start = index + 1;
    }
    const batch = items.slice(start, start + limit);
    return { items: batch, next_cursor: start + limit < items.length ? encode({ scope, after: getId(batch[batch.length - 1]) }) : null };
  }
  return {
    mode: 'demo',
    async getSession() { return session(); },
    async bootstrapSession() { if (!profile()) { try { options.storage.setItem(profileKey, id()); } catch { fail('STORAGE_UNAVAILABLE', 0); } } },
    async getCampaign(slug) { if (slug !== campaign.slug) fail('NOT_FOUND', 404); return clone(campaign); },
    async getCatalog(version) { if (version !== options.catalog.version) fail('NOT_FOUND', 404); return clone(options.catalog); },
    async getCreature(creatureId) { return publicCreature(own(read(), creatureId).view); },
    async getShare(token) { const db = read(); return preview(snapshot(token, db), db); },
    async getMine(params: PageParams = {}) {
      const p = session().profile_id;
      const nodes = Object.values(read().nodes).filter(n => n.owner_id === p).map(n => publicCreature(n.view));
      // Cursor contains context IDs only; own profile identity never appears in pagination or tree payloads.
      return page(nodes, params, 'mine', n => n.id);
    },
    async getFamily(root: FamilyRoot, params: FamilyParams = {}) {
      const db = read(), node = root.kind === 'share' ? snapshot(root.token, db) : own(db, root.id);
      const parentId = params.parent_id ?? node.view.id;
      const parent = parentId === node.view.id ? node : db.nodes[parentId];
      if (!parent || (parentId !== node.view.id && !parent.ancestor_ids.includes(node.view.id))) fail('NOT_FOUND', 404);
      const children = Object.values(db.nodes).filter(n => n.parent_id === parentId).map(n => ({ creature: publicCreature(n.view),
        has_children: Object.values(db.nodes).some(child => child.parent_id === n.view.id) }));
      return { root_id: node.view.id, parent_id: parentId,
        ...page(children, params, `family:${node.view.id}:${parentId}`, child => child.creature.id) };
    },
    async execute(command: PendingCommand, s: Session): Promise<OperationResult> {
      checkSession(s); if (command.mode !== 'demo' || command.profile_id !== s.profile_id) fail('PROFILE_CHANGED');
      const db = read(), receiptKey = `${s.profile_id}:${command.key}`;
      const fingerprint = JSON.stringify([command.kind, command.target, command.body_json]);
      const receipt = db.receipts[receiptKey];
      if (receipt) { if (receipt.fingerprint !== fingerprint) fail('IDEMPOTENCY_KEY_REUSED'); return clone(receipt.result); }
      let body: Record<string, unknown>; try { body = JSON.parse(command.body_json); } catch { return fail('INVALID_REQUEST', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_REQUEST', 400);
      let result: OperationResult;
      if (command.kind === 'create_share') {
        if (Object.keys(body).length) fail('INVALID_REQUEST', 400);
        result = { kind: 'share', value: share(own(db, command.target)) };
      } else if (command.kind === 'create_root') {
        if (Object.keys(body).sort().join(',') !== 'base_id,campaign_slug,catalog_version') fail('INVALID_REQUEST', 400);
        if (body.campaign_slug !== campaign.slug) fail('NOT_FOUND', 404);
        if (!campaign.contributions_available) fail('CAMPAIGN_CLOSED');
        if (body.catalog_version !== campaign.active_catalog_version) fail('CATALOG_CHANGED');
        if (!['B01', 'B02', 'B03'].includes(String(body.base_id))) fail('INVALID_CHOICE', 400);
        const view = publicCreature({ id: `demo-${id()}`, campaign_slug: campaign.slug, revision_id: `demo-rev-${id()}`,
          step: 1, total_steps: 16, catalog_version: body.catalog_version, appearance: { base_id: body.base_id, choices: [] }, is_complete: false });
        db.nodes[view.id] = { view, owner_id: s.profile_id, parent_id: null, ancestor_ids: [] };
        result = { kind: 'contribution', value: { creature: publicCreature(view), existing: false } };
      } else {
        if (Object.keys(body).sort().join(',') !== 'choice_id,expected_source_revision_id') fail('INVALID_REQUEST', 400);
        const source = snapshot(command.target, db), v = source.view;
        if (body.expected_source_revision_id !== v.revision_id) fail('SOURCE_MISMATCH');
        const state = preview(source, db);
        if (state.viewer.state === 'already_contributed') {
          result = { kind: 'contribution', value: { creature: publicCreature(db.nodes[state.viewer.existing_creature_id!].view), existing: true } };
        } else {
          if (state.viewer.state === 'self') fail('SELF_CONTRIBUTION');
          if (state.viewer.state === 'complete') fail('CHAIN_COMPLETE');
          if (state.viewer.state === 'unresolved') fail('D01_UNRESOLVED');
          if (state.viewer.state === 'unavailable') fail('CAMPAIGN_CLOSED');
          if (state.viewer.state !== 'choose') fail('SESSION_REQUIRED', 401);
          if (!state.options.some(o => o.choice_id === body.choice_id)) fail('INVALID_CHOICE', 400);
          const view = publicCreature({ ...v, id: `demo-${id()}`, revision_id: `demo-rev-${id()}`, step: v.step + 1,
            is_complete: v.step + 1 === 16, appearance: { base_id: v.appearance.base_id,
              choices: [...v.appearance.choices, { step: v.step + 1, choice_id: body.choice_id }] } });
          if (!db.nodes[v.id]) db.nodes[v.id] = clone(source);
          db.nodes[view.id] = { view, owner_id: s.profile_id, parent_id: v.id, ancestor_ids: [...source.ancestor_ids, v.id] };
          result = { kind: 'contribution', value: { creature: publicCreature(view), existing: false } };
        }
      }
      db.receipts[receiptKey] = { fingerprint, result: clone(result) }; write(db); return clone(result);
    },
    async reportEvent(event: CtaEvent, s: Session) {
      checkSession(s); if (Number(!!event.share_token) + Number(!!event.creature_id) !== 1) fail('INVALID_REQUEST', 400);
      const db = read(); if (event.share_token) snapshot(event.share_token, db); else own(db, event.creature_id!);
      const key = `${s.profile_id}:${event.event_id}`, payload = JSON.stringify(event);
      if (db.events[key]) { if (db.events[key] !== payload) fail('EVENT_ID_REUSED'); return { status: 200 }; }
      db.events[key] = payload; write(db); return { status: 202 };
    },
  };
}

export function createDemoApi(options: DemoOptions): PeredaiApi { return makeDemoApi(options); }

/** Tests and explicitly labelled scenario harness ONLY. No identity selector in the product. */
export function createDemoHarness(options: DemoOptions) {
  return { forProfile: (scenarioProfile: string): PeredaiApi => makeDemoApi(options, `harness:${scenarioProfile}`) };
}
