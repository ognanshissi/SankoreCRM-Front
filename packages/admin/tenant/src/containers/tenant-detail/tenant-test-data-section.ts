import { Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TenantDataWipeResponse, TenantDataWipesApiService } from '@sankore/crm-admin-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSwitch } from '@talisoft/ui/switch';
import { TableConfig, TasTable } from '@talisoft/ui/table';

const STATUS: Record<string, { label: string; tone: string }> = {
  Pending: { label: 'En attente', tone: 'text-amber-700' },
  Running: { label: 'En cours', tone: 'text-blue-700' },
  Completed: { label: 'Terminé', tone: 'text-green-700' },
  Failed: { label: 'Échec', tone: 'text-red-700' },
};

const MODULES: Record<string, string> = {
  Leads: 'leads, projets, tâches',
  Customers: 'clients',
  Kyc: 'KYC',
  Integration: 'appels, intégrations',
  Workflow: 'circuits',
  Notifications: 'messages',
  Administration: 'imports d’utilisateurs',
};

class WipeFormModel {
  public confirmation = '';
}

/**
 * Les données de test d'une institution (purge de données, lot 4) : la marquer comme institution
 * de recette ou de démo, puis la vider de ses données métier — leads, clients, projets, KYC,
 * appels… — en gardant son paramétrage et ses utilisateurs. Seule une institution de test peut
 * l'être, et le nom doit être ressaisi : c'est irréversible.
 */
@Component({
  selector: 'tenant-test-data-section',
  imports: [DatePipe, Button, TasSwitch, TasTable, TasFormField, TasLabel, TasError, TasHint, TasInput, FormRoot, FormField],
  template: `
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-bold text-slate-800">Données de test</h2>
          <p class="text-sm text-slate-500">
            Une institution de recette ou de démo peut être vidée de ses données métier ; son paramétrage et ses
            utilisateurs sont conservés.
          </p>
        </div>
        <label class="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <tas-switch [checked]="isTest()" [isLoading]="isSavingFlag()" ariaLabel="Institution de test"
                      (toggle)="setTest($event)"></tas-switch>
          Institution de test
        </label>
      </div>

      @if (isTest()) {
        <div class="rounded-2xl border border-red-200 bg-red-50/60 p-5">
          <p class="text-sm font-semibold text-red-900">Vider les données de {{ tenantName() }}</p>
          <p class="mt-1 text-sm text-red-800">
            Leads, clients, projets, tâches, dossiers KYC et leurs pièces, appels et enregistrements, conversations,
            imports… sont supprimés définitivement. Le paramétrage (produits, formulaires, règles, gabarits, rôles,
            agences) et les utilisateurs restent.
          </p>
          @if (inFlight()) {
            <p class="mt-3 text-sm font-semibold text-red-900">Un vidage est en cours : il se termine dans la minute.</p>
          } @else {
            <form [formRoot]="wipeForm" class="mt-4 flex flex-wrap items-end gap-3">
              <tas-form-field class="min-w-72 flex-1">
                <tas-label>Ressaisissez le nom de l'institution pour confirmer</tas-label>
                <input tasInput type="text" autocomplete="off" [formField]="wipeForm.confirmation" [placeholder]="tenantName()" />
                @if (wipeForm.confirmation().touched() && wipeForm.confirmation().invalid()) {
                  <tas-error>{{ wipeForm.confirmation().errors()[0].message }}</tas-error>
                } @else {
                  <tas-hint>Exactement « {{ tenantName() }} ».</tas-hint>
                }
              </tas-form-field>
              <button tas-raised-button color="warn" type="button" class="rounded-full"
                      [disabled]="wipeForm().invalid() || wipeForm().submitting()"
                      [isLoading]="wipeForm().submitting()" (click)="wipe()">Vider les données</button>
            </form>
          }
        </div>
      }

      @if (wipes().length > 0) {
        <tas-table [data]="wipes()" identifierField="id" [config]="tableConfig" [hasCaption]="false">
          <ng-template #header>
            <tr class="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <th class="py-2.5 pl-5">Demandé le</th>
              <th class="py-2.5">Statut</th>
              <th class="py-2.5 pr-5">Résultat</th>
            </tr>
          </ng-template>
          <ng-template #body let-w>
            <tr>
              <td class="py-3 pl-5 text-sm text-slate-800 tabular-nums">{{ w.requestedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td class="py-3 text-sm font-semibold" [class]="status(w.status).tone">{{ status(w.status).label }}</td>
              <td class="py-3 pr-5 text-sm text-slate-600">
                @if (w.error) { <span class="text-red-700">{{ w.error }}</span> } @else { {{ summary(w.summary) }} }
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </section>
  `,
})
export class TenantTestDataSection implements OnInit {
  private readonly _api = inject(TenantDataWipesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly tenantId = input.required<string>();
  public readonly tenantName = input<string>('');
  public readonly initialIsTest = input<boolean>(false, { alias: 'isTest' });
  public readonly changed = output<void>();

  private readonly _isTest = signal<boolean | null>(null);
  public readonly isTest = computed(() => this._isTest() ?? this.initialIsTest());
  public readonly isSavingFlag = signal(false);
  public readonly wipes = signal<TenantDataWipeResponse[]>([]);
  public readonly inFlight = computed(() => this.wipes().some((w) => w.status === 'Pending' || w.status === 'Running'));

  public readonly tableConfig: TableConfig = {
    property: 'tenant-data-wipes',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 5, pageSizeOptions: [5] },
  };

  public readonly model = signal(new WipeFormModel());
  public readonly wipeForm = form(this.model, (schema) => {
    validate(schema.confirmation, (ctx) =>
      ctx.value().trim() === this.tenantName().trim() ? null : { kind: 'mismatch', message: 'Le nom ne correspond pas.' });
  });

  private _timer: ReturnType<typeof setTimeout> | null = null;

  public ngOnInit(): void {
    this._destroyRef.onDestroy(() => this._timer && clearTimeout(this._timer));
    this._load();
  }

  public status(code: string | null | undefined) {
    return STATUS[code ?? ''] ?? { label: code ?? '—', tone: 'text-slate-600' };
  }

  /** « 9 624 lignes supprimées (leads, projets, tâches 6 120 · clients 2 210 · …) ». */
  public summary(json: string | null | undefined): string {
    if (!json) return '';
    try {
      const counts = JSON.parse(json) as Record<string, number>;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const detail = Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([m, n]) => `${MODULES[m] ?? m} ${n.toLocaleString('fr-FR')}`)
        .join(' · ');
      return `${total.toLocaleString('fr-FR')} lignes supprimées${detail ? ` (${detail})` : ''}`;
    } catch {
      return json;
    }
  }

  public setTest(isTest: boolean): void {
    this.isSavingFlag.set(true);
    this._api.setTenantTestFlag(this.tenantId(), { isTest }).pipe(
      catchError(() => {
        this.isSavingFlag.set(false);
        this._snackbar.error('Erreur', 'Le statut de test n’a pas pu être changé.');
        return EMPTY;
      }),
    ).subscribe(() => {
      this.isSavingFlag.set(false);
      this._isTest.set(isTest);
      this.changed.emit();
    });
  }

  public wipe(): void {
    submit(this.wipeForm, async (field) => {
      const started = await firstValueFrom(
        this._api.requestTenantDataWipe(this.tenantId(), { confirmationName: field().value().confirmation.trim() }).pipe(
          catchError((err: HttpErrorResponse) => {
            const code = err.error?.error;
            this._snackbar.error('Vidage refusé',
              code === 'TENANT_NOT_TEST' ? 'L’institution n’est pas marquée comme institution de test.'
              : code === 'CONFIRMATION_MISMATCH' ? 'Le nom ressaisi ne correspond pas.'
              : code === 'DATA_WIPE_IN_FLIGHT' ? 'Un vidage est déjà en cours.'
              : 'La demande n’a pas pu être enregistrée.');
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!started) return;
      this.model.set(new WipeFormModel());
      this._snackbar.success('Vidage demandé', 'Il sera réalisé dans la minute.');
      this._load();
    });
  }

  /** Relu toutes les 5 s tant qu'un vidage est en vol : le résultat arrive de l'API. */
  private _load(): void {
    this._api.listTenantDataWipes(this.tenantId()).pipe(catchError(() => EMPTY)).subscribe((wipes) => {
      this.wipes.set(wipes ?? []);
      if (this._timer) clearTimeout(this._timer);
      if (this.inFlight()) this._timer = setTimeout(() => this._load(), 5000);
    });
  }
}
