import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { applyEach, form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, finalize, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { AgentObjectiveDto, AgentObjectiveHistoryDto, LeadsAnalyticsApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasFormField } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';

const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const MAX_CONVERSIONS = 1000;

function monthLabel(key: string | null | undefined): string {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  const label = MONTH_LABEL.format(new Date(y, m - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Vide, ou un entier entre 0 et `max`. */
function readTarget(text: string, max: number): number | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return 'invalid';
  const n = Number(t);
  return n > max ? 'invalid' : n;
}

interface MonthRow {
  month: string;
  setFor: string | null;
  firstContact: string;
  conversions: string;
}

class ObjectivesFormModel {
  public months!: MonthRow[];

  public static of(dtos: AgentObjectiveDto[]): ObjectivesFormModel {
    const m = new ObjectivesFormModel();
    m.months = dtos.map((d) => ({
      month: d.month ?? '',
      setFor: d.setFor ?? null,
      firstContact: d.firstContactWithin24hPercent == null ? '' : String(d.firstContactWithin24hPercent),
      conversions: d.conversions == null ? '' : String(d.conversions),
    }));
    return m;
  }
}

/**
 * L'onglet « Objectifs » de la fiche d'un agent (objectifs dans l'écran Utilisateurs, propriétaire,
 * 2026-11-01) : le mois en cours et les deux suivants, modifiables, et ce qui a été fixé avant.
 * Un mois sans objectif reprend le dernier fixé ; l'enregistrer le fixe pour ce mois et les suivants.
 */
@Component({
  selector: 'user-objectifs',
  imports: [DatePipe, Button, TasFormField, TasInput, TasSpinner, TasTable, FormRoot, FormField],
  template: `
    @if (isLoading() && !loaded()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else if (!loaded()) {
      <section class="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <p class="text-sm text-slate-600">Les objectifs de cet agent ne sont pas disponibles : il ne fait pas partie de votre équipe.</p>
      </section>
    } @else {
      <section class="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 class="text-xl font-bold text-primary">Objectifs</h2>
        <p class="mt-0.5 text-sm text-slate-600">
          Ce que vous attendez de l’agent chaque mois. Un mois sans objectif reprend le dernier fixé ; un champ vide veut dire « pas d’objectif ».
          L’agent les voit dans « Ma journée ».
        </p>

        <form [formRoot]="formSchema" class="mt-5">
          <tas-table [data]="model().months" identifierField="month" [config]="upcomingConfig()" [hasCaption]="false">
            <ng-template #header>
              <tr>
                <th>Mois</th>
                <th class="w-56">Premier contact sous 24 h</th>
                <th class="w-56">Conversions du mois</th>
              </tr>
            </ng-template>
            <ng-template #body let-item>
              @if (field(item); as row) {
                <tr>
                  <td class="py-3">
                    <p class="text-sm font-semibold text-slate-900">{{ label(item.month) }}</p>
                    <p class="text-xs text-slate-500">{{ origin(item) }}</p>
                  </td>
                  <td class="py-3">
                    <div class="flex items-center gap-2">
                      <tas-form-field class="w-24">
                        <input tasInput type="text" inputmode="numeric" [formField]="row.firstContact"
                          [attr.aria-label]="'Premier contact sous 24 h, ' + label(item.month)" />
                      </tas-form-field>
                      <span class="text-sm text-slate-600">%</span>
                    </div>
                    @if (row.firstContact().invalid()) {
                      <p class="mt-1 text-xs text-functional-error">{{ row.firstContact().errors()[0].message }}</p>
                    }
                  </td>
                  <td class="py-3">
                    <tas-form-field class="w-24">
                      <input tasInput type="text" inputmode="numeric" [formField]="row.conversions"
                        [attr.aria-label]="'Conversions du mois, ' + label(item.month)" />
                    </tas-form-field>
                    @if (row.conversions().invalid()) {
                      <p class="mt-1 text-xs text-functional-error">{{ row.conversions().errors()[0].message }}</p>
                    }
                  </td>
                </tr>
              }
            </ng-template>
          </tas-table>
        </form>

        <div class="mt-4 flex justify-end">
          <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
            [disabled]="!changed().length || formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()">
            Enregistrer@if (changed().length) { ({{ changed().length }}) }
          </button>
        </div>
      </section>

      <section class="mt-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <h3 class="text-base font-bold text-slate-900">Déjà fixés</h3>
        <p class="mt-0.5 text-sm text-slate-600">Chaque mois pour lequel un objectif a été enregistré, le plus récent d’abord.</p>
        <div class="mt-4">
          <tas-table [data]="history()" identifierField="month" [config]="historyConfig()" [hasCaption]="false">
            <ng-template #header>
              <tr>
                <th>À partir de</th>
                <th>Premier contact sous 24 h</th>
                <th>Conversions du mois</th>
                <th>Fixé par</th>
              </tr>
            </ng-template>
            <ng-template #body let-item>
              <tr>
                <td class="py-2.5 text-sm font-semibold text-slate-900">{{ label(item.month) }}</td>
                <td class="py-2.5 text-sm tabular-nums">{{ item.firstContactWithin24hPercent != null ? item.firstContactWithin24hPercent + ' %' : 'Aucun' }}</td>
                <td class="py-2.5 text-sm tabular-nums">{{ item.conversions ?? 'Aucun' }}</td>
                <td class="py-2.5 text-xs text-slate-600">{{ item.updatedByName || '—' }} · {{ item.updatedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              </tr>
            </ng-template>
          </tas-table>
          @if (!history().length) {
            <p class="mt-2 text-sm text-slate-500">Aucun objectif n’a encore été fixé pour cet agent.</p>
          }
        </div>
      </section>
    }
  `,
})
export class UserObjectifs {
  private readonly _api = inject(LeadsAnalyticsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly id = input.required<string>();

  public readonly isLoading = signal(true);
  public readonly loaded = signal(false);
  public readonly history = signal<AgentObjectiveHistoryDto[]>([]);
  private readonly _initial = signal<Map<string, MonthRow>>(new Map());

  public readonly model = signal(ObjectivesFormModel.of([]));
  public readonly formSchema = form(this.model, (schema) => {
    applyEach(schema.months, (row) => {
      validate(row.firstContact, ({ value }) =>
        readTarget(value(), 100) === 'invalid' ? { kind: 'range', message: 'Un entier de 0 à 100' } : null);
      validate(row.conversions, ({ value }) =>
        readTarget(value(), MAX_CONVERSIONS) === 'invalid' ? { kind: 'range', message: `Un entier de 0 à ${MAX_CONVERSIONS}` } : null);
    });
  });

  public readonly changed = computed(() => {
    const initial = this._initial();
    return this.model().months.filter((r) => {
      const before = initial.get(r.month);
      return !before || before.firstContact.trim() !== r.firstContact.trim() || before.conversions.trim() !== r.conversions.trim();
    });
  });

  public readonly upcomingConfig = computed<TableConfig>(() => ({
    property: 'agentObjectivesUpcoming',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10], totalElements: this.model().months.length },
  }));
  public readonly historyConfig = computed<TableConfig>(() => ({
    property: 'agentObjectivesHistory',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 12, pageSizeOptions: [12, 24], totalElements: this.history().length },
  }));

  public readonly label = monthLabel;

  constructor() {
    effect(() => this._load(this.id()));
  }

  public field(item: MonthRow) {
    const index = this.model().months.findIndex((r) => r.month === item.month);
    return index < 0 ? null : this.formSchema.months[index];
  }

  public origin(item: MonthRow): string {
    if (!item.setFor) return 'Aucun objectif fixé';
    return item.setFor === item.month ? 'Fixé pour ce mois' : `Repris de ${monthLabel(item.setFor).toLowerCase()}`;
  }

  public handleSubmit(): void {
    submit(this.formSchema, async () => {
      const agentId = this.id();
      const rows = this.changed();
      const requests = rows.map((r) => {
        const firstContact = readTarget(r.firstContact, 100);
        const conversions = readTarget(r.conversions, MAX_CONVERSIONS);
        return this._api
          .setAgentObjective(agentId, r.month, {
            firstContactWithin24hPercent: firstContact === 'invalid' ? null : firstContact,
            conversions: conversions === 'invalid' ? null : conversions,
          })
          .pipe(
            map(() => null),
            catchError((err: HttpErrorResponse) => of(`${monthLabel(r.month)} : ${err.error?.detail ?? 'enregistrement impossible'}`)),
          );
      });
      const failures = (await firstValueFrom(forkJoin(requests))).filter((f): f is string => !!f);
      if (failures.length) this._snackbar.error('Objectifs en partie enregistrés', failures.join(' — '));
      else this._snackbar.success('Objectifs enregistrés', rows.map((r) => monthLabel(r.month).toLowerCase()).join(', '));
      this._load(agentId);
    });
  }

  private _load(agentId: string): void {
    this.isLoading.set(true);
    this._api
      .getAgentObjectivePlan(agentId)
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((plan) => {
        this.loaded.set(!!plan);
        if (!plan) return;
        const model = ObjectivesFormModel.of(plan.upcoming ?? []);
        this._initial.set(new Map(model.months.map((r) => [r.month, { ...r }])));
        this.model.set(model);
        this.history.set(plan.history ?? []);
      });
  }
}

export default UserObjectifs;
