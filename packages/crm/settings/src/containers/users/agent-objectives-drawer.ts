import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { applyEach, form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, finalize, firstValueFrom, forkJoin, map, of, retry, throwError, timer } from 'rxjs';
import { AgentObjectiveDto, LeadsAnalyticsApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasFormField } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTitle } from '@talisoft/ui/title';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';

const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const MAX_CONVERSIONS = 1000;

interface ObjectiveRow {
  agentId: string;
  name: string;
  /** Le mois dont viennent les valeurs (« aaaa-mm ») ; nul quand aucun objectif n'a jamais été fixé. */
  setFor: string | null;
  firstContact: string;
  conversions: string;
}

class AgentObjectivesFormModel {
  public rows!: ObjectiveRow[];

  public static fromDtos(dtos: AgentObjectiveDto[]): AgentObjectivesFormModel {
    const m = new AgentObjectivesFormModel();
    m.rows = dtos.map((d) => ({
      agentId: d.agentId ?? '',
      name: d.agentName?.trim() || 'Agent sans nom',
      setFor: d.setFor ?? null,
      firstContact: d.firstContactWithin24hPercent == null ? '' : String(d.firstContactWithin24hPercent),
      conversions: d.conversions == null ? '' : String(d.conversions),
    }));
    return m;
  }
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
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

/**
 * Les objectifs du mois des agents de l'équipe, depuis la liste des utilisateurs : premier contact
 * sous 24 h et conversions. Un mois sans objectif reprend le dernier fixé — la ligne le dit — et
 * l'enregistrer le fixe pour ce mois et les suivants. Les mois passés ne se modifient plus.
 */
@Component({
  selector: 'agent-objectives-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button, TasFormField, TasInput, TasSelect, TasTable,
    FormsModule, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Objectifs de l’équipe</tas-title>
      </tas-drawer-title>
      <tas-drawer-content>
        <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
          <p class="max-w-xl text-sm text-slate-600">
            Le premier contact sous 24 h et les conversions attendus de chaque agent. Un mois sans objectif reprend
            le dernier fixé ; un champ vide veut dire « pas d’objectif ».
          </p>
          <div class="w-52">
            <tas-select [options]="monthOptions" [ngModel]="month()" (ngModelChange)="setMonth($event)" aria-label="Mois"></tas-select>
          </div>
        </div>

        <form [formRoot]="formSchema">
          <tas-table [data]="model().rows" identifierField="agentId" [config]="tableConfig()" [isLoading]="isLoading()" [hasCaption]="false">
            <ng-template #header>
              <tr>
                <th>Agent</th>
                <th class="w-44">Premier contact sous 24 h</th>
                <th class="w-44">Conversions du mois</th>
              </tr>
            </ng-template>
            <ng-template #body let-item>
              @if (field(item); as row) {
                <tr>
                  <td class="py-3">
                    <p class="text-sm font-semibold text-slate-900">{{ item.name }}</p>
                    <p class="text-xs text-slate-500">{{ origin(item) }}</p>
                  </td>
                  <td class="py-3">
                    <div class="flex items-center gap-2">
                      <tas-form-field class="w-24">
                        <input tasInput type="text" inputmode="numeric" [formField]="row.firstContact"
                          [attr.aria-label]="'Premier contact sous 24 h, ' + item.name" />
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
                        [attr.aria-label]="'Conversions du mois, ' + item.name" />
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

        @if (!isLoading() && !model().rows.length) {
          <p class="mt-4 text-sm text-slate-600">Aucun agent dans votre équipe : les objectifs se fixent pour les rôles Agent et Agent commercial de votre agence et de ses sous-agences.</p>
        }
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex w-full items-center gap-3">
          <button tas-outlined-button type="button" (click)="close()">Fermer</button>
          <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
            [disabled]="!changedCount() || formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()">
            Enregistrer@if (changedCount()) { ({{ changedCount() }}) }
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class AgentObjectivesDrawer implements OnInit {
  private readonly _api = inject(LeadsAnalyticsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);

  /** Le mois en cours et les deux suivants : un mois passé ne se modifie plus. */
  public readonly monthOptions = [0, 1, 2].map((offset) => {
    const now = new Date();
    const key = monthKey(new Date(now.getFullYear(), now.getMonth() + offset, 1));
    return { label: monthLabel(key), value: key };
  });

  public readonly month = signal(this.monthOptions[0].value);
  public readonly isLoading = signal(true);
  /** Les valeurs telles que chargées : seules les lignes changées partent. */
  private readonly _loaded = signal<Map<string, ObjectiveRow>>(new Map());

  public readonly model = signal(AgentObjectivesFormModel.fromDtos([]));
  public readonly formSchema = form(this.model, (schema) => {
    applyEach(schema.rows, (row) => {
      validate(row.firstContact, ({ value }) =>
        readTarget(value(), 100) === 'invalid' ? { kind: 'range', message: 'Un entier de 0 à 100' } : null);
      validate(row.conversions, ({ value }) =>
        readTarget(value(), MAX_CONVERSIONS) === 'invalid' ? { kind: 'range', message: `Un entier de 0 à ${MAX_CONVERSIONS}` } : null);
    });
  });

  public readonly changed = computed(() => {
    const loaded = this._loaded();
    return this.model().rows.filter((r) => {
      const before = loaded.get(r.agentId);
      return !before || before.firstContact.trim() !== r.firstContact.trim() || before.conversions.trim() !== r.conversions.trim();
    });
  });
  public readonly changedCount = computed(() => this.changed().length);

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'agentObjectives',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 25,
      pageSizeOptions: [25, 50, 100],
      totalElements: this.model().rows.length,
    },
  }));

  ngOnInit(): void {
    this._load();
  }

  public setMonth(month: string): void {
    if (!month || month === this.month()) return;
    this.month.set(month);
    this._load();
  }

  /** Le champ d'une ligne : la table rend les lignes du modèle, retrouvées par agent. */
  public field(item: ObjectiveRow) {
    const index = this.model().rows.findIndex((r) => r.agentId === item.agentId);
    return index < 0 ? null : this.formSchema.rows[index];
  }

  public origin(item: ObjectiveRow): string {
    if (!item.setFor) return 'Aucun objectif fixé';
    return item.setFor === this.month() ? `Fixé pour ${monthLabel(item.setFor).toLowerCase()}` : `Repris de ${monthLabel(item.setFor).toLowerCase()}`;
  }

  public handleSubmit(): void {
    submit(this.formSchema, async () => {
      const month = this.month();
      const requests = this.changed().map((r) => {
        const firstContact = readTarget(r.firstContact, 100);
        const conversions = readTarget(r.conversions, MAX_CONVERSIONS);
        return this._api
          .setAgentObjective(r.agentId, month, {
            firstContactWithin24hPercent: firstContact === 'invalid' ? null : firstContact,
            conversions: conversions === 'invalid' ? null : conversions,
          })
          .pipe(
            map(() => null),
            catchError((err: HttpErrorResponse) => of(`${r.name} : ${err.error?.detail ?? 'enregistrement impossible'}`)),
          );
      });
      const failures = (await firstValueFrom(forkJoin(requests))).filter((f): f is string => !!f);
      if (failures.length) {
        this._snackbar.error('Objectifs en partie enregistrés', failures.join(' — '));
      } else {
        this._snackbar.success('Objectifs enregistrés', `${requests.length} agent${requests.length > 1 ? 's' : ''} · ${monthLabel(month).toLowerCase()}`);
      }
      this._load();
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api
      .listAgentObjectives(this.month())
      .pipe(
        // La limite de débit de l'API (200 appels par minute) peut répondre 429 quelques secondes :
        // on attend plutôt que d'afficher une erreur.
        retry({ count: 3, delay: (err: HttpErrorResponse, attempt) => (err.status === 429 ? timer(1500 * attempt) : throwError(() => err)) }),
        catchError(() => {
          this._snackbar.error('Erreur', 'Les objectifs de l’équipe n’ont pas pu être chargés.');
          return of([] as AgentObjectiveDto[]);
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((dtos) => {
        const model = AgentObjectivesFormModel.fromDtos(dtos);
        this._loaded.set(new Map(model.rows.map((r) => [r.agentId, { ...r }])));
        this.model.set(model);
      });
  }
}
