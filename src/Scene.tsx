import { useEffect, useId, useState } from 'react';
import type { Appearance, CatalogManifest, Placement } from './core/types';

export function sceneLayers(catalog: CatalogManifest, appearance: Appearance) {
  const base = catalog.bases.find(b => b.base_id === appearance.base_id);
  if (!base) return [];
  const layers: { id: string; placement: Placement; clipToBase?: boolean }[] = [{ id: base.asset_id, placement: base.placement }];
  for (const choice of appearance.choices) {
    const option = catalog.steps.find(s => s.step === choice.step)?.options.find(o => o.choice_id === choice.choice_id);
    if (option) layers.push({ id: option.asset_id, placement: option.placements[appearance.base_id], clipToBase: option.clip_to_base });
  }
  return layers.sort((a, b) => a.placement.z - b.placement.z);
}

export function Scene({ catalog, appearance, label, className = '' }: {
  catalog: CatalogManifest; appearance: Appearance; label: string; className?: string;
}) {
  const layers = sceneLayers(catalog, appearance);
  const missing = layers.length !== appearance.choices.length + 1;
  const maskId = useId();
  const base = catalog.bases.find(b => b.base_id === appearance.base_id);
  const transform = (p: Placement) => `translate(${p.x} ${p.y}) rotate(${p.rotation_deg}) scale(${p.scale}) translate(${-p.anchor.x} ${-p.anchor.y})`;
  return <div className={`scene ${className}`}>
    <svg viewBox={`0 0 ${catalog.canvas.width} ${catalog.canvas.height}`} role="img" aria-label={label}>
      <title>{label}</title>
      {base && layers.some(l => l.clipToBase) && <defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={catalog.canvas.width} height={catalog.canvas.height} style={{ maskType: 'alpha' }}>
        <g transform={transform(base.placement)}><image href={catalog.assets[base.asset_id].src} width={catalog.assets[base.asset_id].width} height={catalog.assets[base.asset_id].height} /></g>
      </mask></defs>}
      {layers.map(({ id, placement: p, clipToBase }) => {
        const asset = catalog.assets[id];
        return asset && <g key={id} mask={clipToBase ? `url(#${maskId})` : undefined}><g transform={transform(p)}>
          <image href={asset.src} width={asset.width} height={asset.height} />
        </g></g>;
      })}
    </svg>
    {missing && <p className="missing-art">Показаны доступные детали. Полная иллюстрация ещё не готова.</p>}
  </div>;
}

export function useArtwork(sources: string[], retry: number) {
  const key = [...new Set(sources)].sort().join('|');
  const [state, setState] = useState<{ key: string; pending: boolean; failed: string[] }>({ key: '', pending: true, failed: [] });
  useEffect(() => {
    let active = true;
    const urls = key ? key.split('|') : [];
    setState({ key, pending: true, failed: [] });
    Promise.all(urls.map(src => new Promise<string | null>(resolve => {
      const img = new Image();
      img.onload = () => resolve(null); img.onerror = () => resolve(src); img.src = src;
    }))).then(results => { if (active) setState({ key, pending: false, failed: results.filter((v): v is string => !!v) }); });
    return () => { active = false; };
  }, [key, retry]);
  return state.key === key ? state : { key, pending: true, failed: [] };
}
