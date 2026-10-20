import { DispatchingRuleDtoStrategyEnum, ScoringWeightsDto } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';

export interface StrategyOption {
  key: DispatchingRuleDtoStrategyEnum;
  label: string;
  description: string;
  icon: string;
}

export const STRATEGIES: StrategyOption[] = [
  {
    key: DispatchingRuleDtoStrategyEnum.RoundRobin,
    label: 'Tour de rôle',
    description: 'Chaque agent reçoit un lead à son tour.',
    icon: 'feather:repeat',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.WeightedRoundRobin,
    label: 'Tour de rôle pondéré',
    description: 'Plus de leads aux agents qui ont plus de capacité.',
    icon: 'feather:sliders',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.CompatibilityScoring,
    label: 'Meilleur profil',
    description: 'L\'agent le plus adapté au lead, selon des critères pondérés.',
    icon: 'feather:target',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.CherryPicking,
    label: 'File partagée',
    description: 'Les agents choisissent eux-mêmes leurs leads.',
    icon: 'feather:inbox',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.StickyAssignment,
    label: 'Agent attitré',
    description: 'Le lead reste toujours au même agent.',
    icon: 'feather:link',
  },
];

export type WeightKey = keyof ScoringWeightsDto;

export interface Criterion {
  key: WeightKey;
  label: string;
  hint: string;
  /** Couleur de la pastille et du segment dans la barre de score de l'aperçu. */
  color: string;
}

export const CRITERIA: Criterion[] = [
  { key: 'language', label: 'Langue', hint: 'parle la langue du prospect', color: 'bg-blue-400' },
  { key: 'product', label: 'Produit', hint: 'connaît le produit demandé', color: 'bg-primary' },
  { key: 'geography', label: 'Proximité', hint: 'proche du prospect', color: 'bg-amber-500' },
  { key: 'workload', label: 'Disponibilité', hint: 'peu de leads ouverts', color: 'bg-emerald-600' },
  { key: 'performance', label: 'Performance', hint: 'taux de conversion', color: 'bg-violet-400' },
  { key: 'agency', label: 'Agence', hint: 'agence souhaitée par le prospect', color: 'bg-slate-400' },
];

export const WEIGHT_KEYS: WeightKey[] = CRITERIA.map((c) => c.key);

export type Weights = Record<WeightKey, number>;

export interface WeightPreset {
  label: string;
  weights: Weights;
}

export const WEIGHT_PRESETS: WeightPreset[] = [
  {
    label: 'Équilibré',
    weights: { language: 20, product: 20, geography: 15, workload: 20, performance: 15, agency: 10 },
  },
  {
    label: 'Expertise produit',
    weights: { language: 10, product: 40, geography: 5, workload: 20, performance: 20, agency: 5 },
  },
  {
    label: 'Proximité',
    weights: { language: 15, product: 15, geography: 35, workload: 15, performance: 10, agency: 10 },
  },
];

export const DEFAULT_WEIGHTS: Weights = { ...WEIGHT_PRESETS[0].weights };

export function toWeights(dto: ScoringWeightsDto | undefined | null): Weights {
  const weights = { ...DEFAULT_WEIGHTS };
  if (!dto) return weights;
  for (const key of WEIGHT_KEYS) weights[key] = Math.max(0, Math.min(100, Math.round(dto[key] ?? 0)));
  return weights;
}

/**
 * Ramène les importances saisies à des parts entières qui font exactement 100.
 *
 * Le moteur additionne les poids sans les normaliser (`CompatibilityScorer`, borné à 100) :
 * des poids qui totalisaient 230 saturaient le score et rendaient les agents indiscernables.
 * Arrondi au plus fort reste pour que la somme affichée ne tombe jamais à 99 ou 101.
 */
export function normalizeWeights(raw: Weights): Weights {
  const total = WEIGHT_KEYS.reduce((sum, k) => sum + Math.max(0, raw[k] || 0), 0);
  const result = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 0])) as Weights;
  if (total <= 0) return result;

  const exact = WEIGHT_KEYS.map((k) => ({ k, v: (Math.max(0, raw[k] || 0) * 100) / total }));
  let remaining = 100;
  for (const e of exact) {
    result[e.k] = Math.floor(e.v);
    remaining -= result[e.k];
  }
  exact
    .sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)))
    .slice(0, remaining)
    .forEach((e) => result[e.k]++);
  return result;
}

/** `TimeSpan` .NET (`hh:mm:ss` ou `d.hh:mm:ss`) vers minutes. */
export function timeSpanToMinutes(value: string | null | undefined): number | null {
  const match = /^(?:(\d+)\.)?(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value ?? '');
  if (!match) return null;
  const [, days, hours, minutes] = match;
  return Number(days ?? 0) * 1440 + Number(hours) * 60 + Number(minutes);
}

export function minutesToTimeSpan(totalMinutes: number): string {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const hhmm = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
  return days > 0 ? `${days}.${hhmm}` : hhmm;
}

export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, '0')}`;
}

export function strategySeverity(strategy: DispatchingRuleDtoStrategyEnum | undefined): Severity {
  switch (strategy) {
    case DispatchingRuleDtoStrategyEnum.RoundRobin:           return 'info';
    case DispatchingRuleDtoStrategyEnum.WeightedRoundRobin:   return 'primary';
    case DispatchingRuleDtoStrategyEnum.CompatibilityScoring: return 'success';
    case DispatchingRuleDtoStrategyEnum.CherryPicking:        return 'warning';
    case DispatchingRuleDtoStrategyEnum.StickyAssignment:     return 'accent';
    default: return 'neutral';
  }
}

export function strategyLabel(strategy: DispatchingRuleDtoStrategyEnum | string | undefined): string {
  return STRATEGIES.find((s) => s.key === strategy)?.label ?? (strategy ?? '—');
}

export function needsWeights(strategy: DispatchingRuleDtoStrategyEnum): boolean {
  return strategy === DispatchingRuleDtoStrategyEnum.CompatibilityScoring
     || strategy === DispatchingRuleDtoStrategyEnum.CherryPicking || strategy === DispatchingRuleDtoStrategyEnum.StickyAssignment;
}
