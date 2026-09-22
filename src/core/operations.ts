import { CoreError, publicCreature } from './types';
import type { CommandInput, LockProvider, OperationResult, PendingCommand, PeredaiApi, Session, StorageLike } from './types';

export interface OperationOptions { namespace?: string; locks?: LockProvider | null }
function wire(input: CommandInput): { target: string; body_json: string } {
  return { target: input.kind === 'create_root' ? '/creatures' : input.kind === 'create_offspring' ? input.token : input.creature_id,
    body_json: JSON.stringify(input.body) };
}
function active(command: PendingCommand | null) { return !!command && command.status !== 'resolved' && command.status !== 'failed'; }

/** One durable operation per browser origin/mode. Storage retention policy for live use is unresolved. */
export class OperationManager {
  private readonly storageKey: string;
  private readonly lockName: string;
  private readonly locks: LockProvider | null;
  constructor(readonly api: PeredaiApi, private readonly storage: StorageLike, options: OperationOptions = {}) {
    this.storageKey = `${options.namespace ?? `peredai:operations:v1:${api.mode}`}:pending`;
    this.lockName = `${this.storageKey}:lock`;
    this.locks = options.locks === undefined ? (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null) : options.locks;
  }
  readPending(): PendingCommand | null {
    let raw: string | null;
    try { raw = this.storage.getItem(this.storageKey); } catch { throw new CoreError('STORAGE_UNAVAILABLE', 'Не удалось прочитать сохранённую операцию.'); }
    if (!raw) return null;
    try {
      const x = JSON.parse(raw) as PendingCommand;
      if (x.version !== 1 || x.mode !== this.api.mode || !x.key || !x.profile_id || typeof x.target !== 'string' ||
          typeof x.body_json !== 'string' || !['create_root', 'create_offspring', 'create_share'].includes(x.kind) ||
          !['prepared', 'sending', 'unknown', 'access_lost', 'failed', 'resolved'].includes(x.status) ||
          (x.status === 'resolved' && !x.result)) throw new Error();
      JSON.parse(x.body_json);
      return x;
    } catch { throw new CoreError('PENDING_STORAGE_CORRUPT', 'Сохранённую операцию нельзя прочитать. Новая запись заблокирована.'); }
  }
  private save(command: PendingCommand) {
    try { this.storage.setItem(this.storageKey, JSON.stringify(command)); }
    catch { throw new CoreError('STORAGE_UNAVAILABLE', 'Не удалось надёжно сохранить параметры операции.'); }
  }
  private lock<T>(name: string, run: () => Promise<T>): Promise<T> {
    if (!this.locks) return Promise.reject(new CoreError('SESSION_COORDINATION_UNSUPPORTED',
      'Браузер не поддерживает Web Locks. Без согласованного способа координации запись недоступна.'));
    return this.locks.request(name, run);
  }
  async ensureSession(): Promise<Session> {
    return this.lock(`peredai:session:${this.api.mode}`, () => this.ensureSessionInsideLock());
  }
  private async ensureSessionInsideLock(): Promise<Session> {
    const pending = this.readPending();
    try {
      const current = await this.api.getSession();
      if (active(pending) && pending!.profile_id !== current.profile_id) {
        this.save({ ...pending!, status: 'access_lost', error_code: 'PROFILE_CHANGED' });
        throw new CoreError('PROFILE_CHANGED', 'Браузерный профиль изменился. Исход прежней операции неизвестен.');
      }
      return current;
    } catch (error) {
      if (!(error instanceof CoreError) || error.status !== 401) throw error;
      if (active(pending)) {
        this.save({ ...pending!, status: 'access_lost', error_code: 'SESSION_REQUIRED' });
        throw new CoreError('PENDING_ACCESS_LOST', 'Доступ к профилю незавершённой операции потерян.', 401);
      }
      await this.api.bootstrapSession();
      // A successful POST alone never establishes that the browser accepted its cookie.
      return this.api.getSession();
    }
  }
  /** Call only on explicit confirmation; local previews never call this method. */
  async submit(input: CommandInput): Promise<OperationResult> {
    // Capture a caller's mutable selection BEFORE awaiting a lock or session.
    const captured = wire(input), kind = input.kind;
    return this.lock(this.lockName, async () => {
      const pending = this.readPending();
      if (pending) {
        if (pending.kind === kind && pending.target === captured.target && pending.body_json === captured.body_json) return this.resumeInsideLock(pending);
        if (pending.status !== 'resolved') throw new CoreError('PENDING_OPERATION', 'Сначала нужно определить исход сохранённой операции.');
      }
      const session = await this.ensureSession();
      if (kind === 'create_offspring') {
        const preview = await this.api.getShare(captured.target);
        const body = JSON.parse(captured.body_json) as { expected_source_revision_id: string; choice_id: string };
        if (preview.viewer.state === 'already_contributed') {
          if (!preview.viewer.existing_creature_id) throw new CoreError('INVALID_RESPONSE', 'Не указан сохранённый результат.');
          return { kind: 'contribution', value: { creature: await this.api.getCreature(preview.viewer.existing_creature_id), existing: true } };
        }
        const reasons: Record<string, string> = { self: 'SELF_CONTRIBUTION', complete: 'CHAIN_COMPLETE', unresolved: 'D01_UNRESOLVED', unavailable: 'TEMPORARILY_UNAVAILABLE', needs_session: 'SESSION_REQUIRED' };
        if (preview.viewer.state !== 'choose') throw new CoreError(reasons[preview.viewer.state] ?? 'INVALID_RESPONSE', 'Этот вклад сейчас недоступен.');
        if (preview.creature.revision_id !== body.expected_source_revision_id) throw new CoreError('SOURCE_MISMATCH', 'Исходный снимок изменился. Перечитайте ссылку.');
        if (!preview.options.some(o => o.choice_id === body.choice_id)) throw new CoreError('INVALID_CHOICE', 'Выберите вариант текущего шага.');
      }
      const command: PendingCommand = { version: 1, mode: this.api.mode, key: crypto.randomUUID(),
        profile_id: session.profile_id, kind, ...captured, created_at: new Date().toISOString(), status: 'prepared' };
      // No network business command occurs unless this write succeeds.
      this.save(command);
      return this.resumeInsideLock(command);
    });
  }
  /** Replays the persisted exact key/body/target, after checking the same current profile; never bootstraps. */
  async resume(): Promise<OperationResult> {
    return this.lock(this.lockName, async () => {
      const command = this.readPending(); if (!command) throw new CoreError('NO_PENDING_OPERATION', 'Нет сохранённой операции.');
      return this.resumeInsideLock(command);
    });
  }
  private async resumeInsideLock(command: PendingCommand): Promise<OperationResult> {
    if (command.status === 'resolved' && command.result) return command.result;
    let session: Session;
    try { session = await this.api.getSession(); }
    catch (error) {
      const lost = error instanceof CoreError && error.status === 401;
      this.save({ ...command, status: lost ? 'access_lost' : 'unknown', error_code: lost ? 'SESSION_REQUIRED' : 'SESSION_CHECK_FAILED' });
      if (lost) throw new CoreError('PENDING_ACCESS_LOST', 'Доступ к прежнему профилю потерян. Повтор от нового профиля заблокирован.', 401);
      throw error;
    }
    if (session.profile_id !== command.profile_id) {
      this.save({ ...command, status: 'access_lost', error_code: 'PROFILE_CHANGED' });
      throw new CoreError('PROFILE_CHANGED', 'Профиль изменился. Повтор сохранённой операции заблокирован.');
    }
    const sending: PendingCommand = { ...command, status: 'sending', error_code: undefined };
    this.save(sending);
    let result: OperationResult;
    try { result = await this.api.execute(sending, session); }
    catch (error) {
      const core = error instanceof CoreError ? error : null;
      const lost = core?.status === 401 || core?.code === 'PROFILE_CHANGED';
      const uncertain = !core || core.status === 0 || core.status >= 500 || core.status === 429;
      this.save({ ...sending, status: lost ? 'access_lost' : uncertain ? 'unknown' : 'failed', error_code: core?.code ?? 'UNKNOWN_ERROR' });
      throw error;
    }
    // Store the receipt before doing any refresh. If storage fails, the previous key remains replayable.
    let resolved: PendingCommand = { ...sending, status: 'resolved', result, refresh_required: result.kind === 'contribution' };
    this.save(resolved);
    if (result.kind === 'contribution') {
      try {
        const current = publicCreature(await this.api.getCreature(result.value.creature.id));
        if (current.id !== result.value.creature.id) throw new CoreError('INVALID_RESPONSE', 'Ответ относится к другому существу.');
        result = { kind: 'contribution', value: { ...result.value, creature: current } };
        resolved = { ...resolved, result, refresh_required: false }; this.save(resolved);
      } catch { /* Confirmed result remains, refresh_required stays visible to UI. */ }
    }
    return result;
  }
  /** Explicitly starting a fresh flow may clear a terminal receipt, never an unknown operation. */
  async clearResolved(): Promise<void> {
    return this.lock(this.lockName, async () => {
      const pending = this.readPending();
      if (pending && pending.status !== 'resolved' && pending.status !== 'failed') throw new CoreError('PENDING_OPERATION', 'Неопределённую операцию нельзя заменить новой.');
      try { this.storage.removeItem(this.storageKey); } catch { throw new CoreError('STORAGE_UNAVAILABLE', 'Не удалось очистить завершённую операцию.'); }
    });
  }
}
