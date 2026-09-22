/** Public DTOs. Never place owner IDs, cookie values or other share tokens here. */
export type BaseId = 'B01' | 'B02' | 'B03';
export interface Appearance { base_id: BaseId; choices: readonly { step: number; choice_id: string }[] }
export interface CreatureView {
  id: string; campaign_slug: string; revision_id: string; step: number; total_steps: 16;
  catalog_version: string; appearance: Appearance; is_complete: boolean;
}
export interface Session { csrf_token: string; profile_id: string }
export interface Campaign {
  slug: string; brand: string; offer: string; cta_target: string | null;
  active_catalog_version: string; contributions_available: boolean;
}
export interface Bounds { x: number; y: number; width: number; height: number }
export interface Placement { anchor: { x: number; y: number }; x: number; y: number; scale: number; rotation_deg: number; z: number }
export interface Asset { src: string; width: number; height: number; content_bounds: Bounds }
export interface Base { base_id: BaseId; label: string; asset_id: string; placement: Placement }
export interface CatalogOption { choice_id: string; label: string; asset_id: string; placements: Readonly<Record<BaseId, Placement>>; clip_to_base: boolean }
export type Option = CatalogOption;
export interface CatalogStep { step: number; options: readonly CatalogOption[] }
export interface CatalogManifest {
  version: string; total_steps: 16; canvas: { width: number; height: number };
  assets: Readonly<Record<string, Asset>>; bases: readonly Base[]; steps: readonly CatalogStep[];
}
/** Deliberately incomplete local demo; never a published production catalog. */
export type DemoCatalog = CatalogManifest & {
  status: 'partial-demo'; available_steps: readonly number[]; missing_asset_count: number; production_ready: false;
};
export interface PreviewOption { choice_id: string; label: string; preview_asset: string | null; artwork_supported?: boolean }
export type ViewerState = 'needs_session' | 'choose' | 'already_contributed' | 'self' | 'complete' | 'unavailable' | 'unresolved';
export interface SharePreview {
  creature: CreatureView; brand: string; offer: string; cta_target: string | null;
  next_step: number | null; options: readonly PreviewOption[];
  viewer: { state: ViewerState; existing_creature_id: string | null; reason?: 'D01' };
}
export interface ContributionResult { creature: CreatureView; existing: boolean }
export interface ShareView { url: string; token: string; source_revision_id: string }
export interface MinePage { items: readonly CreatureView[]; next_cursor: string | null }
export interface FamilyPage {
  root_id: string; parent_id: string;
  items: readonly { creature: CreatureView; has_children: boolean }[]; next_cursor: string | null;
}
export type FamilyRoot = { kind: 'share'; token: string } | { kind: 'creature'; id: string };
export interface PageParams { cursor?: string | null; limit?: number }
export interface FamilyParams extends PageParams { parent_id?: string }
export interface CreateRootBody { campaign_slug: string; catalog_version: string; base_id: BaseId }
export interface CreateOffspringBody { expected_source_revision_id: string; choice_id: string }
export type CommandInput =
  | { kind: 'create_root'; body: CreateRootBody }
  | { kind: 'create_offspring'; token: string; body: CreateOffspringBody }
  | { kind: 'create_share'; creature_id: string; body: Record<string, never> };
export type OperationResult = { kind: 'contribution'; value: ContributionResult } | { kind: 'share'; value: ShareView };
export type OperationStatus = 'prepared' | 'sending' | 'unknown' | 'access_lost' | 'failed' | 'resolved';
/** csrf_token/cookie are NEVER persisted. body_json is the exact wire body. */
export interface PendingCommand {
  version: 1; mode: 'live' | 'demo'; key: string; profile_id: string; kind: CommandInput['kind'];
  target: string; body_json: string; created_at: string; status: OperationStatus;
  result?: OperationResult; error_code?: string; refresh_required?: boolean;
}
export type CtaEvent = { event_id: string; kind: 'cta_click_reported' } &
  ({ share_token: string; creature_id?: never } | { creature_id: string; share_token?: never });
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface LockProvider { request<T>(name: string, callback: () => T | Promise<T>): Promise<T> }
export interface PeredaiApi {
  readonly mode: 'live' | 'demo';
  getSession(): Promise<Session>;
  bootstrapSession(): Promise<void>;
  getCampaign(slug: string): Promise<Campaign>;
  getCatalog(version: string): Promise<CatalogManifest>;
  getCreature(id: string): Promise<CreatureView>;
  getShare(token: string): Promise<SharePreview>;
  getMine(params?: PageParams): Promise<MinePage>;
  getFamily(root: FamilyRoot, params?: FamilyParams): Promise<FamilyPage>;
  execute(command: PendingCommand, session: Session): Promise<OperationResult>;
  reportEvent(event: CtaEvent, session: Session): Promise<{ status: 200 | 202 }>;
}
export class CoreError extends Error {
  readonly name = 'CoreError';
  constructor(public readonly code: string, message: string, public readonly status = 0,
    public readonly retryAfter: string | null = null, public readonly requestId?: string) { super(message); }
}

/** Strip to public fields as well as validating before rendering or exporting. */
export function publicCreature(input: unknown): CreatureView {
  const x = input as CreatureView;
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id ||
      typeof x.campaign_slug !== 'string' || typeof x.revision_id !== 'string' || !x.revision_id ||
      typeof x.catalog_version !== 'string' || x.total_steps !== 16 || !Number.isInteger(x.step) || x.step < 1 || x.step > 16 ||
      x.is_complete !== (x.step === 16) || !x.appearance || !['B01', 'B02', 'B03'].includes(x.appearance.base_id) ||
      !Array.isArray(x.appearance.choices) || x.appearance.choices.length !== x.step - 1 ||
      x.appearance.choices.some((c, index) => !c || c.step !== index + 2 ||
        !new RegExp(`^${String(index + 2).padStart(2, '0')}[ABC]$`).test(c.choice_id)))
    throw new CoreError('INVALID_RESPONSE', 'Некорректный снимок существа.');
  return { id: x.id, campaign_slug: x.campaign_slug, revision_id: x.revision_id, step: x.step, total_steps: 16,
    catalog_version: x.catalog_version, is_complete: x.is_complete,
    appearance: { base_id: x.appearance.base_id, choices: x.appearance.choices.map(c => ({ step: c.step, choice_id: c.choice_id })) } };
}
