import { Component, inject, input, signal, OnInit } from '@angular/core';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  OpportunityDto,
  OpportunityStore,
  OPPORTUNITY_STAGES,
} from './opportunity.model';
import { CreateOpportunityDrawer } from './create-opportunity-drawer';

function stageSeverity(stage: string): Severity {
  switch (stage) {
    case 'Prospection':  return 'info';
    case 'Qualification': return 'primary';
    case 'Proposition':  return 'info';
    case 'Négociation':  return 'warning';
    case 'Clôture':      return 'accent';
    case 'Gagnée':       return 'success';
    case 'Perdue':       return 'error';
    default:             return 'neutral';
  }
}

function formatMoney(opp: OpportunityDto): string {
  if (!opp.value?.amount) return '—';
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: opp.value.currency || 'XOF',
      maximumFractionDigits: 0,
    }).format(opp.value.amount);
  } catch {
    return `${opp.value.amount.toLocaleString('fr-FR')} ${opp.value.currency ?? ''}`;
  }
}

@Component({
  selector: 'lead-opportunities',
  imports: [TasCard, TasIcon, TasTag, Button],
  template: `
    <div class="pb-6">
      <tas-card>
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p class="font-semibold text-slate-800">Opportunités</p>
            <p class="text-sm text-slate-500 mt-0.5">Potentiel commercial lié à ce lead</p>
          </div>
          <div class="flex items-center gap-2">
            @if (opportunities().length > 0) {
              <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium tabular-nums">
                {{ opportunities().length }}
              </span>
            }
            <button
              tas-button
              color="primary"
              type="button"
              class="text-xs"
              (click)="openCreateDrawer()"
            >
              <tas-icon iconName="feather:plus" style="font-size:12px"></tas-icon>
              Nouvelle
            </button>
          </div>
        </div>

        @if (opportunities().length === 0) {
          <div class="flex flex-col items-center justify-center py-16 text-center">
            <tas-icon iconName="feather:briefcase" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
            <p class="text-sm text-slate-400">Aucune opportunité</p>
            <p class="text-xs text-slate-400 mt-1">Créez une opportunité pour suivre le potentiel commercial.</p>
          </div>
        } @else {
          <div class="divide-y divide-slate-100">
            @for (opp of opportunities(); track opp.id) {
              <div class="p-4 hover:bg-slate-50 transition-colors">
                <div class="flex items-start gap-3">
                  <!-- Stage color dot -->
                  <div
                    class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                    [style.background-color]="stageColor(opp.stage)"
                  ></div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-0.5">
                      <p class="text-sm font-medium text-slate-800 truncate">{{ opp.title }}</p>
                      <tas-tag [severity]="stageSeverity(opp.stage)">{{ opp.stage }}</tas-tag>
                    </div>

                    @if (opp.description) {
                      <p class="text-xs text-slate-500 mt-0.5 line-clamp-1">{{ opp.description }}</p>
                    }

                    <div class="flex items-center gap-4 mt-2">
                      <!-- Amount -->
                      <span class="text-xs font-semibold text-slate-700 tabular-nums">
                        {{ formatMoney(opp) }}
                      </span>

                      <!-- Probability -->
                      @if (opp.probability != null) {
                        <span class="text-xs text-slate-400 tabular-nums flex items-center gap-1">
                          <tas-icon iconName="feather:percent" style="font-size:9px"></tas-icon>
                          {{ opp.probability }}%
                        </span>
                      }

                      <!-- Expected close -->
                      @if (opp.expectedCloseDate) {
                        <span class="text-xs text-slate-400 flex items-center gap-1">
                          <tas-icon iconName="feather:calendar" style="font-size:9px"></tas-icon>
                          {{ opp.expectedCloseDate }}
                        </span>
                      }
                    </div>
                  </div>

                  <!-- Weighted value -->
                  @if (opp.value?.amount && opp.probability) {
                    <div class="text-right shrink-0">
                      <p class="text-xs text-slate-400">Pondéré</p>
                      <p class="text-sm font-semibold text-slate-700 tabular-nums">
                        {{ formatWeighted(opp) }}
                      </p>
                    </div>
                  }
                </div>
              </div>
            }
          </div>

          <!-- Total -->
          @if (opportunities().length > 0) {
            <div class="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <span class="text-xs text-slate-500">Total pipeline</span>
              <span class="text-sm font-semibold text-slate-800 tabular-nums">{{ totalAmount() }}</span>
            </div>
          }
        }
      </tas-card>
    </div>
  `,
})
export class LeadOpportunitiesPage implements OnInit {
  private readonly _sideDrawer = inject(SideDrawerService);

  public readonly id = input.required<string>();
  public readonly stageSeverity = stageSeverity;
  public readonly formatMoney = formatMoney;

  public opportunities = signal<OpportunityDto[]>([]);

  ngOnInit(): void {
    this._load();
  }

  public stageColor(stage: string): string {
    return OPPORTUNITY_STAGES.find((s) => s.value === stage)?.color ?? '#94a3b8';
  }

  public formatWeighted(opp: OpportunityDto): string {
    if (!opp.value?.amount || !opp.probability) return '—';
    const weighted = opp.value.amount * opp.probability / 100;
    try {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: opp.value.currency || 'XOF',
        maximumFractionDigits: 0,
      }).format(weighted);
    } catch {
      return `${weighted.toLocaleString('fr-FR')} ${opp.value.currency ?? ''}`;
    }
  }

  public totalAmount(): string {
    const total = this.opportunities().reduce((sum, o) => sum + (o.value?.amount ?? 0), 0);
    if (total === 0) return '—';
    const cur = this.opportunities()[0]?.value?.currency || 'XOF';
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(total);
    } catch {
      return `${total.toLocaleString('fr-FR')} ${cur}`;
    }
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawer.open(CreateOpportunityDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { leadId: this.id(), leadName: 'Lead' } as any,
    });

    ref.closed.subscribe((result: any) => {
      if (result && typeof result === 'object' && result.id) {
        this.opportunities.update((list) => [result, ...list]);
      }
    });
  }

  private _load(): void {
    this.opportunities.set(OpportunityStore.list(this.id()));
  }
}

export default LeadOpportunitiesPage;
