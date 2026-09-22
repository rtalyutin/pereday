import { useEffect, useRef, useState } from 'react';
import { demoCatalog } from './catalog';
import { createDemoApi } from './core/demo';
import { createRestApi } from './core/api';
import { OperationManager } from './core/operations';
import { CoreError } from './core/types';
import type { Appearance, BaseId, Campaign, CatalogManifest, CreatureView, FamilyRoot, OperationResult, PendingCommand, PeredaiApi, SharePreview, ShareView } from './core/types';
import { Scene, sceneLayers, useArtwork } from './Scene';

const env = import.meta.env ?? {};

type Route = { page: 'create' | 'mine' } | { page: 'share'; token: string } | { page: 'own'; id: string };
function route(): Route {
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 's' && parts[1]) return { page: 'share', token: decodeURIComponent(parts[1]) };
  if (parts[0] === 'c' && parts[1]) return { page: 'own', id: decodeURIComponent(parts[1]) };
  return { page: parts[0] === 'mine' ? 'mine' : 'create' };
}
const errorText: Record<string, string> = {
  SELF_CONTRIBUTION: 'Это ваш вклад. Передайте ссылку другому участнику.',
  PENDING_ACCESS_LOST: 'Доступ к прежнему браузерному профилю потерян. Результат операции неизвестен. Повтор от нового профиля заблокирован.',
  PROFILE_CHANGED: 'Браузерный профиль изменился. Повтор прежней операции заблокирован.',
  SOURCE_MISMATCH: 'Исходная версия изменилась. Обновите страницу и выберите деталь заново.',
  CATALOG_CHANGED: 'Каталог обновился. Обновите страницу и выберите вариант заново.',
  NOT_FOUND: 'Эта ссылка недоступна или у браузера нет доступа к результату.',
  CHAIN_COMPLETE: 'Все 16 вкладов уже собраны.',
  D01_UNRESOLVED: 'Правило повторного участия в ветке ещё не определено.',
  SESSION_COORDINATION_UNSUPPORTED: 'В этом браузере недоступно безопасное согласование сохранений. Откройте альбом в современном браузере.',
};
function message(error: unknown) { return error instanceof CoreError ? errorText[error.code] ?? error.message : 'Не удалось определить результат. Попробуйте проверить состояние ещё раз.'; }
function pendingActive(p: PendingCommand | null) { return !!p && p.status !== 'resolved' && p.status !== 'failed'; }
function safeTarget(value?: string | null) {
  if (!value) return null;
  try { const u = new URL(value); return ['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}

export function App() {
  const [services] = useState(() => {
    const api = env.VITE_API_MODE === 'live' ? createRestApi() : createDemoApi({ storage: localStorage, origin: location.origin, catalog: demoCatalog,
      campaign: { brand: '[Бренд]', offer: '[Оффер]', cta_target: env.VITE_CTA_TARGET || null } });
    return { api, manager: new OperationManager(api, localStorage) };
  });
  const { api, manager } = services;
  const [current, setCurrent] = useState<Route>(route);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [catalog, setCatalog] = useState<CatalogManifest | null>(null);
  const [source, setSource] = useState<SharePreview | null>(null);
  const [saved, setSaved] = useState<CreatureView | null>(null);
  const [selection, setSelection] = useState('');
  const [pending, setPending] = useState(() => manager.readPending());
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [share, setShare] = useState<ShareView | null>(null), [shareStatus, setShareStatus] = useState('');
  const [tree, setTree] = useState(false), [retryArt, setRetryArt] = useState(0);
  const [reload, setReload] = useState(0);
  const busyRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const demo = api.mode === 'demo';
  const navigate = (path: string) => { history.pushState({}, '', path); setCurrent(route()); };
  useEffect(() => { const update = () => setCurrent(route()); addEventListener('popstate', update); return () => removeEventListener('popstate', update); }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setSelection(''); setSaved(null); setSource(null); setShare(null); setShareStatus(''); setTree(false);
    async function load() {
      const cam = await api.getCampaign(env.VITE_CAMPAIGN_SLUG || 'peredai');
      let snapshot: SharePreview | null = null, own: CreatureView | null = null;
      if (current.page === 'share') {
        snapshot = await api.getShare(current.token);
        if (snapshot.viewer.state === 'needs_session') { await manager.ensureSession(); snapshot = await api.getShare(current.token); }
      } else if (current.page === 'own' || current.page === 'mine') {
        await manager.ensureSession();
        if (current.page === 'own') own = await api.getCreature(current.id);
      }
      const version = snapshot?.creature.catalog_version ?? own?.catalog_version ?? cam.active_catalog_version;
      const cat = await api.getCatalog(version);
      if (alive) { setCampaign(cam); setCatalog(cat); setSource(snapshot); setSaved(own); }
    }
    load().catch(e => { if (alive) setError(message(e)); }).finally(() => { if (alive) { setLoading(false); setPending(manager.readPending()); heading.current?.focus(); } });
    return () => { alive = false; };
  }, [api, manager, current, reload]);

  const inherited = source?.creature ?? saved;
  const canChoose = !saved && (current.page === 'create' || source?.viewer.state === 'choose');
  const nextStep = current.page === 'create' ? 1 : source?.next_step;
  const options = current.page === 'create' ? catalog?.bases.map(b => ({ id: b.base_id, label: b.label, src: catalog.assets[b.asset_id]?.src })) ?? []
    : source?.options.map(o => ({ id: o.choice_id, label: o.label, src: o.preview_asset })) ?? [];
  const appearance: Appearance = current.page === 'create'
    ? { base_id: (selection || 'B01') as BaseId, choices: [] }
    : inherited ? { base_id: inherited.appearance.base_id, choices: [...inherited.appearance.choices, ...(selection && nextStep ? [{ step: nextStep, choice_id: selection }] : [])] }
    : { base_id: 'B01', choices: [] };
  const sources = catalog ? sceneLayers(catalog, appearance).map(l => catalog.assets[l.id]?.src).filter(Boolean) : [];
  const art = useArtwork([...sources, ...options.flatMap(o => o.src ? [o.src] : [])], retryArt);
  const selected = options.find(o => o.id === selection);
  const artworkComplete = !!catalog && sceneLayers(catalog, appearance).length === appearance.choices.length + 1;
  const blocked = busy || pendingActive(pending);
  const canConfirm = canChoose && !!selected?.src && artworkComplete && !art.pending && !art.failed.length && !blocked && campaign?.contributions_available;

  async function perform(action: () => Promise<OperationResult>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await action();
      if (result.kind === 'contribution') { setSaved(result.value.creature); setSelection(''); navigate(`/c/${encodeURIComponent(result.value.creature.id)}`); }
      else { setShare(result.value); setShareStatus('Ссылка готова. Выберите способ передачи.'); }
    } catch (e) { setError(message(e)); }
    finally { setPending(manager.readPending()); setBusy(false); busyRef.current = false; }
  }
  function confirm() {
    if (!canConfirm || !catalog || !campaign) return;
    void perform(() => manager.submit(current.page === 'create'
      ? { kind: 'create_root', body: { campaign_slug: campaign.slug, catalog_version: catalog.version, base_id: selection as BaseId } }
      : { kind: 'create_offspring', token: current.page === 'share' ? current.token : '', body: { expected_source_revision_id: source!.creature.revision_id, choice_id: selection } }));
  }
  async function fresh() {
    try { await manager.clearResolved(); setPending(null); navigate('/'); setReload(x => x + 1); }
    catch (e) { setError(message(e)); }
  }
  async function nativeShare() {
    if (!share) return;
    if (!navigator.share) { setShareStatus('Поделиться через браузер не удалось. Скопируйте ссылку ниже.'); return; }
    try { await navigator.share({ title: 'Передай · Альбом дичи', text: 'Добавь одну деталь и передай дальше.', url: share.url }); setShareStatus('Меню передачи закрыто. Доставка получателю не проверяется.'); }
    catch (e) { setShareStatus(e instanceof DOMException && e.name === 'AbortError' ? 'Передача отменена. Ссылка остаётся доступна.' : 'Не удалось открыть меню передачи. Скопируйте ссылку.'); }
  }
  async function copy() { if (share) { try { await navigator.clipboard.writeText(share.url); setShareStatus('Ссылка скопирована.'); } catch { setShareStatus('Выделите и скопируйте ссылку вручную.'); } } }
  const familyRoot: FamilyRoot | null = current.page === 'share' ? { kind: 'share', token: current.token } : saved ? { kind: 'creature', id: saved.id } : null;
  const viewerText: Record<string, [string, string]> = {
    self: ['Это ваш вклад', 'Теперь очередь другого участника. Откройте сохранённую версию, чтобы получить ссылку.'],
    already_contributed: ['Вы уже добавили деталь', 'Ваш результат сохранён. Повторное открытие этой ссылки не создаёт ещё одну версию.'],
    complete: ['Дичь достигла предела', '16 из 16 вкладов. Полюбуйтесь результатом и посмотрите, как росла эта ветка.'],
    unavailable: ['Продолжение пока недоступно', 'Сохранённая версия остаётся здесь. Попробуйте открыть ссылку позже.'],
    unresolved: ['Правило ещё не определено', 'Вы уже участвовали раньше в этой ветке. Правило для такого продолжения ещё нужно согласовать.'],
  };
  const special = source && viewerText[source.viewer.state];
  const title = inherited?.is_complete ? 'Дичь достигла предела.' : saved ? 'Вот это ваш вклад.' : special ? special[0] : current.page === 'create' ? 'Начнём с дичи.' : 'Добавь свою странность.';
  const cta = safeTarget(source?.cta_target ?? campaign?.cta_target);
  function reportCta() {
    const context = current.page === 'share' ? { share_token: current.token } : saved ? { creature_id: saved.id } : null;
    if (context) void api.getSession().then(session => api.reportEvent({ ...context, event_id: crypto.randomUUID(), kind: 'cta_click_reported' }, session)).catch(() => {});
  }

  return <div className="app">
    <a className="skip-link" href="#main">К содержимому</a>
    <header className="header"><a href="/" className="wordmark" onClick={e => { e.preventDefault(); if (!blocked) void fresh(); }}>передай<span aria-hidden="true">↗</span></a>
      <span className="edition">АЛЬБОМ ДИЧИ / 001</span><nav aria-label="Главная"><button className="nav-button" disabled={busy} onClick={() => navigate('/mine')}>Моя дичь <span aria-hidden="true">↗</span></button></nav></header>
    {demo && <aside className="demo-notice"><b>Демо</b> Данные сохраняются в этом браузере. Доступны иллюстрации шагов 1–4 из 16.</aside>}
    <main id="main">
      {current.page === 'mine' ? <Mine api={api} catalog={catalog} loading={loading} open={id => navigate(`/c/${encodeURIComponent(id)}`)} fresh={fresh} /> : <>
        <div className="intro"><div><p className="eyebrow">ОДИН УЧАСТНИК — ОДИН ВКЛАД</p><h1 ref={heading} tabIndex={-1}>{title}</h1><p className="lede">{saved ? 'Сохранено. Передай дальше — следующий участник добавит одну новую деталь.' : special ? special[1] : current.page === 'create' ? 'Выбери основу. Остальные добавят своё — по одной детали за раз.' : 'Тебе передали существо. Примерь одну деталь, сохрани и передай дальше.'}</p></div><span className="round-sticker" aria-hidden="true">НЕ КОРМИТЬ<br />ЛОГИКОЙ<span>✳︎</span></span></div>
        {loading ? <div className="loading" role="status">Открываем альбом…</div> : catalog && <div className="workbench">
          <section className="specimen" aria-label="Существо"><div className="specimen-top"><span className="tag">{selection ? 'ПРИМЕРКА' : inherited ? 'СОХРАНЁННАЯ ВЕРСИЯ' : 'ВЫБЕРИ ОСНОВУ'}</span><span className="specimen-code">№ {String(inherited?.step ?? 0).padStart(2, '0')} / 16</span></div>
            <Scene catalog={catalog} appearance={appearance} label={`${catalog.bases.find(b => b.base_id === appearance.base_id)?.label ?? 'Существо'}${selection ? ', временный предпросмотр' : ''}`} />
            <div className="scene-caption" role="status" aria-live="polite"><span className="caption-dot" />{selection ? `${selected?.label}. Пока не сохранено.` : inherited ? 'Этот снимок сохраняется без изменений.' : 'Сначала — чистая, непредсказуемая основа.'}</div>
            <div className="progress-label"><b>Сохранено вкладов</b><strong>{inherited?.step ?? 0}<span> / 16</span></strong></div>
            <div className="progress" aria-label={`${inherited?.step ?? 0} из 16 вкладов сохранено`}>{Array.from({ length: 16 }, (_, i) => <span key={i} className={i < (inherited?.step ?? 0) ? 'filled' : ''} />)}</div>
          </section>
          <section className="choice-panel" aria-label="Действия с существом">
            {canChoose ? <><div className="step-heading"><span className="step-number">{String(nextStep).padStart(2, '0')}</span><div><p className="eyebrow">ТВОЯ ОЧЕРЕДЬ</p><h2>{current.page === 'create' ? 'Кто начнёт историю?' : nextStep === 2 ? 'Как оно смотрит на мир?' : nextStep === 3 ? 'Что у него с улыбкой?' : nextStep === 4 ? 'На чём оно уйдёт?' : 'Добавь одну деталь'}</h2></div></div>
              <fieldset disabled={blocked}><legend className="sr-only">Выберите один из трёх вариантов</legend><div className="choices">{options.map((o, i) => <label key={o.id} className={`choice ${selection === o.id ? 'selected' : ''}`}>
                <input type="radio" name="choice" value={o.id} checked={selection === o.id} onChange={() => setSelection(o.id)} disabled={!o.src} />
                <span className="choice-art">{o.src ? <img src={o.src} alt="" /> : <span>Нет<br />иллюстрации</span>}</span><span className="choice-copy"><small>ВАРИАНТ 0{i + 1}</small><b>{o.label}</b></span><span className="radio-mark" aria-hidden="true">{selection === o.id ? '✓' : ''}</span>
              </label>)}</div></fieldset>
              {!options.every(o => o.src) && <p className="inline-note">Для следующего шага ещё нет иллюстраций. Сохранение скрытой детали недоступно.</p>}
              {art.failed.length > 0 && <div role="alert" className="inline-note">Изображение не загрузилось. <button className="text-button" onClick={() => setRetryArt(x => x + 1)}>Повторить загрузку</button></div>}
              <button className="primary" disabled={!canConfirm} onClick={confirm}>{busy ? 'Сохраняем…' : 'Сохранить мой вклад'} <span aria-hidden="true">↗</span></button>
              <p className="save-note">Можно примерить все три. После сохранения — очередь следующего участника.</p>
            </> : <div className="saved-panel"><span className="big-check" aria-hidden="true">{inherited?.is_complete ? '✳︎' : '✓'}</span><h2>{saved ? saved.is_complete ? '16 из 16. Готово!' : 'Деталь на месте.' : special?.[0]}</h2><p>{saved ? 'Ссылка ведёт на сохранённую версию. У каждого получателя появится собственное продолжение.' : special?.[1]}</p>
              {saved && <button className="primary" disabled={blocked} onClick={() => perform(() => manager.submit({ kind: 'create_share', creature_id: saved.id, body: {} }))}>{busy ? 'Готовим ссылку…' : share ? 'Проверить ссылку' : 'Получить ссылку'} <span aria-hidden="true">↗</span></button>}
              {source?.viewer.state === 'self' && <button className="primary" onClick={() => navigate(`/c/${encodeURIComponent(source.creature.id)}`)}>Открыть мой вклад ↗</button>}
              {source?.viewer.existing_creature_id && <button className="primary" onClick={() => navigate(`/c/${encodeURIComponent(source.viewer.existing_creature_id!)}`)}>Открыть мой результат ↗</button>}
              {source?.viewer.state === 'complete' && !share && <button className="primary" onClick={() => { if (current.page === 'share') setShare({ url: location.href, token: current.token, source_revision_id: source.creature.revision_id }); }}>Передать финальную версию ↗</button>}
              {share && <div className="share-box"><label htmlFor="share-url">{demo ? 'Демонстрационная ссылка' : 'Ссылка на сохранённую версию'}</label><input id="share-url" readOnly value={share.url} onFocus={e => e.target.select()} /><div className="share-actions"><button onClick={nativeShare}>Поделиться ↗</button><button onClick={copy}>Копировать</button></div>{demo && <small>Это локальная демонстрация. Общего серверного дерева пока нет.</small>}</div>}
              <p role="status" className="save-note">{shareStatus}</p>
              {familyRoot && <button className="text-button" onClick={() => setTree(x => !x)}>{tree ? 'Скрыть дерево' : 'Посмотреть дерево дичи'} <span aria-hidden="true">↓</span></button>}
            </div>}
          </section>
        </div>}
        {canChoose && familyRoot && <button className="text-button tree-entry" onClick={() => setTree(x => !x)}>{tree ? 'Скрыть дерево' : 'Посмотреть дерево дичи'} ↓</button>}
      </>}
      {error && <section role="alert" className="error-box"><h2>Нужно проверить состояние</h2><p>{error}</p>{!pendingActive(pending) && <button onClick={() => { if (pending?.status === 'failed') void manager.clearResolved().then(() => setReload(x => x + 1)); else setReload(x => x + 1); }}>Обновить состояние</button>}</section>}
      {pendingActive(pending) && <section className="pending-box" aria-live="polite"><h2>{busy ? 'Сохраняем вклад…' : 'Исход операции пока неизвестен'}</h2><p>Параметры операции сохранены. Повторная проверка использует тот же запрос и не создаёт новый вклад.</p><button disabled={busy || pending?.status === 'access_lost'} onClick={() => perform(() => manager.resume())}>Проверить результат</button></section>}
      {pending?.refresh_required && <p className="inline-note">Сохранение подтверждено. Свежую версию получить пока не удалось. <button onClick={() => setReload(x => x + 1)}>Обновить</button></p>}
      {tree && familyRoot && catalog && <section className="family"><p className="eyebrow">КАЖДАЯ ПЕРЕДАЧА — НОВАЯ ВЕТКА</p><h2>Генеалогия странного</h2><Family api={api} root={familyRoot} catalog={catalog} /></section>}
      <aside className="brand-card"><span className="brand-icon" aria-hidden="true">✳︎</span><div><p className="eyebrow">ЭТУ ДИЧЬ ПОДДЕРЖИВАЕТ</p><h2>{source?.brand ?? campaign?.brand ?? '[Бренд]'}</h2><p>{source?.offer ?? campaign?.offer ?? '[Оффер]'}</p></div>{cta ? <a className="brand-cta" href={cta} target="_blank" rel="noopener noreferrer" onClick={reportCta}>Узнать больше ↗</a> : <span className="cta-unconfigured">[Контакт]<small>Контакт ещё не указан</small></span>}</aside>
    </main><footer><span>передай / альбом дичи</span><span>Одна деталь. Много непредсказуемого.</span></footer>
  </div>;
}

function Mine({ api, catalog, loading, open, fresh }: { api: PeredaiApi; catalog: CatalogManifest | null; loading: boolean; open: (id: string) => void; fresh: () => void }) {
  const [items, setItems] = useState<CreatureView[]>([]), [cursor, setCursor] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function load(next = false) { setBusy(true); try { const p = await api.getMine({ limit: 6, cursor: next ? cursor : undefined }); setItems(x => next ? [...x, ...p.items] : [...p.items]); setCursor(p.next_cursor); setError(''); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  useEffect(() => { if (!loading) void load(); }, [loading]);
  return <section className="collection"><p className="eyebrow">СОХРАНЕНО В ЭТОМ БРАУЗЕРНОМ ПРОФИЛЕ</p><h1>Моя дичь.</h1>{loading || busy ? <p role="status">Загружаем…</p> : !items.length && !error ? <div className="empty"><h2>Здесь пока тихо.</h2><p>Создай первую дичь или добавь деталь по ссылке друга.</p><button onClick={fresh}>Начать историю ↗</button></div> : null}{error && <p role="alert">{error} <button onClick={() => load()}>Повторить</button></p>}<div className="mine-grid">{items.map(c => <button className="mine-card" key={c.id} onClick={() => open(c.id)}>{catalog && c.catalog_version === catalog.version ? <Scene catalog={catalog} appearance={c.appearance} label="Сохранённое существо" /> : <span>Открыть иллюстрацию</span>}<b>{c.step} / 16 вкладов</b><span>Открыть ↗</span></button>)}</div>{cursor && <button disabled={busy} onClick={() => load(true)}>Ещё</button>}</section>;
}

function Family({ api, root, catalog, parentId }: { api: PeredaiApi; root: FamilyRoot; catalog: CatalogManifest; parentId?: string }) {
  const [rows, setRows] = useState<{ creature: CreatureView; has_children: boolean }[]>([]), [cursor, setCursor] = useState<string | null>(null), [expanded, setExpanded] = useState<string[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  async function load(next = false) { setBusy(true); try { const p = await api.getFamily(root, { parent_id: parentId, limit: 4, cursor: next ? cursor : undefined }); setRows(x => next ? [...x, ...p.items] : [...p.items]); setCursor(p.next_cursor); setError(''); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, [parentId]);
  return <div className="family-level">{error && <p role="alert">{error} <button onClick={() => load()}>Повторить</button></p>}{busy && <p role="status">Открываем ветку…</p>}{!busy && !rows.length && !error && <p>Продолжений в этой ветке пока нет.</p>}{rows.map(({ creature: c, has_children }) => <article className="family-node" key={c.id}><div className="family-row"><Scene catalog={catalog} appearance={c.appearance} label={`Ветка: ${c.step} вкладов`} /><b>{c.step} / 16</b>{has_children && <button aria-expanded={expanded.includes(c.id)} onClick={() => setExpanded(x => x.includes(c.id) ? x.filter(id => id !== c.id) : [...x, c.id])}>{expanded.includes(c.id) ? 'Свернуть' : 'Открыть ветку'}</button>}</div>{expanded.includes(c.id) && <Family api={api} root={root} catalog={catalog} parentId={c.id} />}</article>)}{cursor && <button disabled={busy} onClick={() => load(true)}>Ещё продолжения</button>}</div>;
}
