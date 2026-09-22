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
    label: 'Round Robin',
    description: 'Distribution égale et séquentielle entre les agents disponibles.',
    icon: 'feather:refresh-cw',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.WeightedRoundRobin,
    label: 'Round Robin pondéré',
    description: 'Distribution proportionnelle à la capacité ou aux poids configurés par agent.',
    icon: 'feather:sliders',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.CompatibilityScoring,
    label: 'Score de compatibilité',
    description: 'Affectation à l\'agent ayant le meilleur score basé sur langue, produit, géographie, charge et performance.',
    icon: 'feather:target',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.CherryPicking,
    label: 'Cherry Picking',
    description: 'L\'agent choisit lui-même les leads dans une file d\'attente partagée.',
    icon: 'feather:inbox',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.StickyAssignment,
    label: 'Assignation persistante',
    description: 'Le lead reste assigné au même agent malgré les changements de statut ou de cycle.',
    icon: 'feather:link',
  },
];

export const WEIGHT_LABELS: Record<keyof ScoringWeightsDto, string> = {
  language: 'Langue',
  product: 'Produit',
  geography: 'Géographie',
  workload: 'Charge de travail',
  performance: 'Performance',
  agency: 'Agence',
};

export const WEIGHT_KEYS: (keyof ScoringWeightsDto)[] = ['language', 'product', 'geography', 'workload', 'performance', 'agency'];

export const DEFAULT_WEIGHTS: ScoringWeightsDto = { language: 50, product: 50, geography: 30, workload: 40, performance: 40, agency: 20 };

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
