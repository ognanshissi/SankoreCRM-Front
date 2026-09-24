import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SourceQualityDto } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { LeadSourcesService } from './lead-sources.service';

/**
 * FE-23 — Tableau de qualité des fournisseurs
 */

const PERIOD_OPTIONS = [
  { label: '7 derniers jours', value: '7' },
  { label: '30 derniers jours', value: '30' },
  { label: '90 derniers jours', value: '90' },
  { label: 'Cette année', value: 'year' },
  { label: 'Tout', value: 'all' },
];

@Component({
  selector: 'source-quality',
  standalone: true,
  imports: [
    FormsModule, DecimalPipe, RouterLink,
    TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasSelect,
  ],
  template: `
    <div class="pb-6">
      <!-- Header -->
      <div class="flex items-start justify-between mb-6">
        <div>
          <h1 class="text-lg font-semibold text-slate-800">Qualité des fournisseurs</h1>
          <p class="text-sm text-slate-500 mt-0.5">
            Comparez les sources sur la quantité, la qualité et le coût d'acquisition.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <tas-form-field>
            <tas-select
              [options]="periodOptions"
              optionLabel="label" optionValue="value"
              [ngModel]="selectedPeriod()" (ngModelChange)="onPeriodChange($event)"
            ></tas-select>
          </tas-form-field>
        </div>
      </div>

      <!-- Summary cards -->
      @if (!isLoading()) {
        <div class="grid grid-cols-4 gap-4 mb-6">
          <tas-card>
            <div class="p-4">
              <p class="text-xs text-slate-400 mb-1">Total reçus</p>
              <p class="text-xl font-semibold text-slate-800">{{ totals().received | number }}</p>
            </div>
          </tas-card>
          <tas-card>
            <div class="p-4">
              <p class="text-xs text-slate-400 mb-1">Taux de contact</p>
              <p class="text-xl font-semibold text-blue-600">{{ totals().contactRate | number:'1.1-1' }}%</p>
            </div>
          </tas-card>
          <tas-card>
            <div class="p-4">
              <p class="text-xs text-slate-400 mb-1">Taux de conversion</p>
              <p class="text-xl font-semibold text-green-600">{{ totals().conversionRate | number:'1.1-1' }}%</p>
            </div>
          </tas-card>
          <tas-card>
            <div class="p-4">
              <p class="text-xs text-slate-400 mb-1">Coût total</p>
              <p class="text-xl font-semibold text-slate-800">{{ totals().totalCost | number:'1.0-0' }} {{ totals().currency }}</p>
            </div>
          </tas-card>
        </div>
      }

      @if (isLoading()) {
        <div class="flex justify-center py-16">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      } @else {
        <!-- Table -->
        <tas-card class="block">
          <div class="flex items-center px-4 py-2 bg-slate-50 text-xs font-medium text-slate-500 border-b border-slate-100">
            <div class="w-[20%]">Source</div>
            <div class="w-[10%] text-right">Reçus</div>
            <div class="w-[10%] text-right">Rejetés</div>
            <div class="w-[10%] text-right">Doublons</div>
            <div class="w-[10%] text-right">Contactés</div>
            <div class="w-[10%] text-right">Convertis</div>
            <div class="w-[10%] text-right">Taux contact</div>
            <div class="w-[10%] text-right">Taux conv.</div>
            <div class="w-[10%] text-right">Coût/converti</div>
          </div>

          @if (sources().length === 0) {
            <div class="flex flex-col items-center py-12 text-center">
              <tas-icon iconName="feather:bar-chart-2" class="text-slate-300 mb-2" style="font-size:24px"></tas-icon>
              <p class="text-sm text-slate-400">Aucune donnée pour cette période.</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (src of sources(); track src.sourceId) {
                <div class="flex items-center px-4 py-3 hover:bg-slate-50 transition-colors">
                  <!-- Source name -->
                  <div class="w-[20%] min-w-0">
                    <a [routerLink]="['/settings/lead-sources', src.sourceId]"
                       class="text-sm font-medium text-primary hover:underline truncate block">
                      {{ src.label }}
                    </a>
                    <span class="text-[10px] text-slate-400 font-mono">{{ src.code }}</span>
                  </div>

                  <!-- Received -->
                  <div class="w-[10%] text-right text-xs text-slate-700 font-medium">
                    {{ src.received ?? 0 | number }}
                  </div>

                  <!-- Rejected -->
                  <div class="w-[10%] text-right text-xs">
                    <span [class]="(src.rejected ?? 0) > 0 ? 'text-red-500 font-medium' : 'text-slate-400'">
                      {{ src.rejected ?? 0 | number }}
                    </span>
                  </div>

                  <!-- Duplicates -->
                  <div class="w-[10%] text-right text-xs">
                    <span class="text-amber-600 cursor-pointer hover:underline"
                          (click)="exportDuplicates(src)">
                      {{ src.duplicates ?? 0 | number }}
                    </span>
                  </div>

                  <!-- Contacted -->
                  <div class="w-[10%] text-right text-xs text-slate-700">
                    {{ src.contacted ?? 0 | number }}
                  </div>

                  <!-- Converted -->
                  <div class="w-[10%] text-right text-xs text-green-600 font-medium">
                    {{ src.converted ?? 0 | number }}
                  </div>

                  <!-- Contact rate -->
                  <div class="w-[10%] text-right text-xs text-slate-600">
                    {{ contactRate(src) | number:'1.1-1' }}%
                  </div>

                  <!-- Conversion rate -->
                  <div class="w-[10%] text-right text-xs">
                    <span [class]="conversionRate(src) >= 5 ? 'text-green-600 font-medium' : 'text-slate-600'">
                      {{ conversionRate(src) | number:'1.1-1' }}%
                    </span>
                  </div>

                  <!-- Cost per converted -->
                  <div class="w-[10%] text-right text-xs text-slate-700">
                    @if (src.costPerConvertedLead != null) {
                      {{ src.costPerConvertedLead | number:'1.0-0' }} {{ src.costCurrency ?? 'XOF' }}
                    } @else {
                      <span class="text-slate-400">—</span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </tas-card>
      }
    </div>
  `,
})
export class SourceQuality implements OnInit {
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumb = inject(BreadcrumbService);

  public isLoading = signal(true);
  public sources = signal<SourceQualityDto[]>([]);
  public selectedPeriod = signal('30');
  public readonly periodOptions = PERIOD_OPTIONS;

  public readonly totals = computed(() => {
    const list = this.sources();
    const received = list.reduce((s, r) => s + (r.received ?? 0), 0);
    const contacted = list.reduce((s, r) => s + (r.contacted ?? 0), 0);
    const converted = list.reduce((s, r) => s + (r.converted ?? 0), 0);
    const totalCost = list.reduce((s, r) => s + (r.totalCost ?? 0), 0);
    const currency = list.find((r) => r.costCurrency)?.costCurrency ?? 'XOF';
    return {
      received,
      contactRate: received > 0 ? (contacted / received) * 100 : 0,
      conversionRate: received > 0 ? (converted / received) * 100 : 0,
      totalCost,
      currency,
    };
  });

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Sources & Campagnes', link: ['/settings/lead-sources'] },
      { label: 'Qualité des fournisseurs' },
    ]);
    this._load();
  }

  public onPeriodChange(period: string): void {
    this.selectedPeriod.set(period);
    this._load();
  }

  public contactRate(src: SourceQualityDto): number {
    return (src.received ?? 0) > 0
      ? ((src.contacted ?? 0) / (src.received ?? 1)) * 100
      : 0;
  }

  public conversionRate(src: SourceQualityDto): number {
    return (src.received ?? 0) > 0
      ? ((src.converted ?? 0) / (src.received ?? 1)) * 100
      : 0;
  }

  public exportDuplicates(src: SourceQualityDto): void {
    if (!src.sourceId || (src.duplicates ?? 0) === 0) return;

    this._sourcesService.exportDuplicates(src.sourceId).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible d\'exporter les doublons.');
        return EMPTY;
      }),
    ).subscribe((blob: any) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `doublons-${src.code ?? src.sourceId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this._snackbar.success('Export', 'Fichier CSV téléchargé.');
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    const { from, to } = this._periodRange();

    this._sourcesService.getSourceQuality(from, to).pipe(
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((data) => {
      this.sources.set(data);
      this.isLoading.set(false);
    });
  }

  private _periodRange(): { from?: string; to?: string } {
    const now = new Date();
    const to = now.toISOString();
    const period = this.selectedPeriod();

    if (period === 'all') return {};

    let from: Date;
    if (period === 'year') {
      from = new Date(now.getFullYear(), 0, 1);
    } else {
      from = new Date(now.getTime() - Number(period) * 24 * 60 * 60 * 1000);
    }
    return { from: from.toISOString(), to };
  }
}

export default SourceQuality;
