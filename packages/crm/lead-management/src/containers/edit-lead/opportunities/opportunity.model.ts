import { Money } from '@sankore/crm-api';

export interface OpportunityDto {
  id: string;
  leadId: string;
  title: string;
  description?: string | null;
  value?: Money;
  probability?: number;
  stage: OpportunityStage;
  expectedCloseDate?: string | null;
  createdAt: string;
}

export type OpportunityStage =
  | 'Prospection'
  | 'Qualification'
  | 'Proposition'
  | 'Négociation'
  | 'Clôture'
  | 'Gagnée'
  | 'Perdue';

export const OPPORTUNITY_STAGES: { value: OpportunityStage; label: string; color: string }[] = [
  { value: 'Prospection',  label: 'Prospection',  color: '#6366f1' },
  { value: 'Qualification', label: 'Qualification', color: '#8b5cf6' },
  { value: 'Proposition',  label: 'Proposition',  color: '#3b82f6' },
  { value: 'Négociation',  label: 'Négociation',  color: '#f59e0b' },
  { value: 'Clôture',      label: 'Clôture',      color: '#14b8a6' },
  { value: 'Gagnée',       label: 'Gagnée',       color: '#22c55e' },
  { value: 'Perdue',       label: 'Perdue',       color: '#ef4444' },
];

export const STAGE_OPTIONS = OPPORTUNITY_STAGES.map((s) => ({ label: s.label, value: s.value }));

const STORAGE_KEY = 'crm_opportunities';

/** Client-side opportunity store (until backend API is available) */
export class OpportunityStore {
  static list(leadId: string): OpportunityDto[] {
    return this._all().filter((o) => o.leadId === leadId);
  }

  static create(opp: Omit<OpportunityDto, 'id' | 'createdAt'>): OpportunityDto {
    const record: OpportunityDto = {
      ...opp,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const all = this._all();
    all.unshift(record);
    this._save(all);
    return record;
  }

  private static _all(): OpportunityDto[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    } catch { return []; }
  }

  private static _save(data: OpportunityDto[]): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }
}
