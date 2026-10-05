import type { AeroModel } from '../../paper/aero';

const ROWS: { key: keyof AeroModel['friendly']; label: string; color: string; hint: string }[] = [
  { key: 'glide', label: 'Glide', color: 'var(--teal-l)', hint: 'How far it travels per height lost' },
  { key: 'speed', label: 'Speed', color: 'var(--red)', hint: 'Cruising speed when hands-off' },
  { key: 'float', label: 'Float', color: 'var(--sky)', hint: 'How much drafts carry it (light wing loading)' },
  { key: 'stability', label: 'Stable', color: 'var(--navy-l)', hint: 'Resists wobbles and holds its trim' },
  { key: 'agility', label: 'Agility', color: 'var(--mustard)', hint: 'Quick turnarounds and pitch response' },
  { key: 'toughness', label: 'Tough', color: 'var(--plum)', hint: 'Shrugs off bumps' },
];

export function StatBar(props: { label: string; value: number; color: string; detail?: string; title?: string }) {
  const v = Math.max(0, Math.min(10, props.value));
  return (
    <div class="stat" title={props.title}>
      <span class="stat__label">{props.label}</span>
      <span class="stat__bar" style={{ '--seg': props.color }}>
        {Array.from({ length: 10 }, (_, i) => (
          <span class={`stat__seg ${v >= i + 1 ? 'is-on' : v > i + 0.4 ? 'is-half' : ''}`} />
        ))}
      </span>
      <span class="stat__val">{props.detail ?? v.toFixed(1)}</span>
    </div>
  );
}

export function FriendlyStats(props: { aero: AeroModel; details?: boolean }) {
  const a = props.aero;
  const detail = (k: string): string | undefined => {
    if (!props.details) return undefined;
    switch (k) {
      case 'glide':
        return a.perf.trim ? `${a.perf.trim.LD.toFixed(1)}:1` : '—';
      case 'speed':
        return `${(a.perf.trim?.v ?? a.perf.vBest).toFixed(1)}m/s`;
      case 'float':
        return `${a.wingLoading.toFixed(1)}N/m²`;
      case 'stability':
        return `${(a.SM * 100).toFixed(0)}%`;
      case 'agility':
        return `${a.perf.turnTime.toFixed(2)}s`;
      case 'toughness':
        return `${a.toughness.toFixed(1)}`;
    }
    return undefined;
  };
  return (
    <div>
      {ROWS.map((r) => (
        <StatBar label={r.label} value={a.friendly[r.key]} color={r.color} detail={detail(r.key)} title={r.hint} />
      ))}
    </div>
  );
}
