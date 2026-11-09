import { Component, computed, DestroyRef, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TenantDataLoadResponse, TenantDataLoadsApiService } from '@sankore/crm-admin-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';

const STATUS: Record<string, { label: string; tone: string }> = {
  Pending: { label: 'En attente', tone: 'text-amber-700' },
  Running: { label: 'En cours', tone: 'text-blue-700' },
  Completed: { label: 'Terminé', tone: 'text-green-700' },
  Failed: { label: 'Échec', tone: 'text-red-700' },
};

const KINDS: Record<string, string> = { Starter: 'Démarrage', Demo: 'Démo', DemoReload: 'Démo rechargée' };

const REFUSALS: Record<string, string> = {
  DEMO_REQUIRES_TEST_TENANT: 'La démo ne se charge que dans une institution de test.',
  DATA_LOAD_ON_TEST_TWIN: 'Un jumeau « Mode test » reçoit le paramétrage de sa production.',
  DATA_LOAD_IN_FLIGHT: 'Un chargement est déjà en cours.',
  CONFIRMATION_MISMATCH: 'Le nom ressaisi ne correspond pas.',
  DATA_WIPE_IN_FLIGHT: 'Un vidage des données de test est en cours : rechargez une fois qu’il est terminé.',
};

class ReloadFormModel {
  public confirmation = '';
}

/**
 * Les données de départ d'une institution (docs/donnees-demarrage-demo.md, 2026-11-08) : le
 * « Démarrage », un paramétrage de base sans personne fictive, ou la « Démo », qui y ajoute des comptes
 * et des dossiers fictifs et n'est proposée qu'à une institution de test. L'API charge dans la minute ;
 * un chargement relancé ne recrée pas ce qui existe déjà. « Recharger la démo » (lot 5) remet une démo à
 * neuf : les dossiers sont effacés comme par « Vider les données », puis la démo est rechargée ; d'où le
 * nom à ressaisir.
 */
@Component({
  selector: 'tenant-starting-data-section',
  imports: [DatePipe, Button, TasTable, TasFormField, TasLabel, TasError, TasHint, TasInput, FormRoot, FormField],
  template: `
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-bold text-slate-800">Données de départ</h2>
          <p class="text-sm text-slate-500">
            Le démarrage crée le paramétrage de base : agences, produits, sources de lead, gabarits de projet. La
            démo y ajoute des comptes de chaque profil et des dossiers fictifs. Relancer un chargement ne recrée pas
            ce qui existe déjà.
          </p>
        </div>
        @if (!isTwin()) {
          <div class="flex flex-wrap gap-2">
            <button tas-outlined-button type="button" class="rounded-full" [disabled]="inFlight() || isRequesting()"
                    (click)="confirm('Starter')">Charger le démarrage</button>
            @if (isTest()) {
              <button tas-raised-button color="primary" type="button" class="rounded-full"
                      [disabled]="inFlight() || isRequesting()" (click)="confirm('Demo')">Charger la démo</button>
            }
          </div>
        }
      </div>

      @if (isTwin()) {
        <p class="text-sm text-slate-600">Ce tenant est un jumeau « Mode test » : il reçoit le paramétrage de sa production.</p>
      } @else if (!isTest()) {
        <p class="text-xs text-slate-500">La démo n’est proposée qu’à une institution de test (voir « Données de test »).</p>
      }
      @if (inFlight()) {
        <p class="text-sm font-semibold text-blue-800">Un chargement est en cours : il se termine en général en quelques minutes.</p>
      }

      @if (isTest() && !isTwin()) {
        <div class="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
          <p class="text-sm font-semibold text-amber-900">Recharger la démo</p>
          <p class="mt-1 text-sm text-amber-900">
            Remet la démo à neuf après une présentation : les leads, clients, projets, tâches, dossiers KYC et
            conversations sont effacés, puis les dossiers de démo sont recréés, datés d’aujourd’hui. Les comptes de démo,
            leur mot de passe et le paramétrage restent.
          </p>
          @if (!inFlight()) {
            <form [formRoot]="reloadForm" class="mt-4 flex flex-wrap items-end gap-3">
              <tas-form-field class="min-w-72 flex-1">
                <tas-label>Ressaisissez le nom de l'institution pour confirmer</tas-label>
                <input tasInput type="text" autocomplete="off" [formField]="reloadForm.confirmation" [placeholder]="tenantName()" />
                @if (reloadForm.confirmation().touched() && reloadForm.confirmation().invalid()) {
                  <tas-error>{{ reloadForm.confirmation().errors()[0].message }}</tas-error>
                } @else {
                  <tas-hint>Exactement « {{ tenantName() }} ».</tas-hint>
                }
              </tas-form-field>
              <button tas-raised-button color="warn" type="button" class="rounded-full"
                      [disabled]="reloadForm().invalid() || reloadForm().submitting()"
                      [isLoading]="reloadForm().submitting()" (click)="reload()">Recharger la démo</button>
            </form>
          }
        </div>
      }

      @if (loads().length > 0) {
        <tas-table [data]="loads()" identifierField="id" [config]="tableConfig" [hasCaption]="false">
          <ng-template #header>
            <tr class="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <th class="py-2.5 pl-5">Demandé le</th>
              <th class="py-2.5">Données</th>
              <th class="py-2.5">Statut</th>
              <th class="py-2.5 pr-5">Résultat</th>
            </tr>
          </ng-template>
          <ng-template #body let-l>
            <tr>
              <td class="py-3 pl-5 text-sm text-slate-800 tabular-nums">{{ l.requestedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td class="py-3 text-sm text-slate-800">{{ kind(l.kind) }}</td>
              <td class="py-3 text-sm font-semibold" [class]="status(l.status).tone">{{ status(l.status).label }}</td>
              <td class="py-3 pr-5 text-sm text-slate-600">
                @if (l.error) { <span class="text-red-700">{{ l.error }}</span> } @else { {{ summary(l.summary, l.status) }} }
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </section>
  `,
})
export class TenantStartingDataSection implements OnInit {
  private readonly _api = inject(TenantDataLoadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly tenantId = input.required<string>();
  public readonly tenantName = input<string>('');
  public readonly isTest = input<boolean>(false);
  public readonly isTwin = input<boolean>(false);

  public readonly loads = signal<TenantDataLoadResponse[]>([]);
  public readonly isRequesting = signal(false);
  public readonly inFlight = computed(() => this.loads().some((l) => l.status === 'Pending' || l.status === 'Running'));

  public readonly tableConfig: TableConfig = {
    property: 'tenant-data-loads',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 5, pageSizeOptions: [5] },
  };

  public readonly reloadModel = signal(new ReloadFormModel());
  public readonly reloadForm = form(this.reloadModel, (schema) => {
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

  public kind(code: string | null | undefined): string {
    return KINDS[code ?? ''] ?? code ?? '—';
  }

  /** « Agences 2 · Produits 9 · Sources de lead 5 » ; « Rien de nouveau » pour un chargement relancé. */
  public summary(json: string | null | undefined, status: string | null | undefined): string {
    if (status !== 'Completed') return '';
    try {
      const counts = Object.entries(JSON.parse(json ?? '{}') as Record<string, number>).filter(([, n]) => n > 0);
      return counts.length === 0
        ? 'Rien de nouveau : tout existait déjà.'
        : counts.map(([label, n]) => `${label} ${n.toLocaleString('fr-FR')}`).join(' · ');
    } catch {
      return json ?? '';
    }
  }

  public confirm(kind: 'Starter' | 'Demo'): void {
    const demo = kind === 'Demo';
    this._confirm.confirm({
      title: demo ? 'Charger la démo ?' : 'Charger le démarrage ?',
      message: demo
        ? `${this.tenantName()} recevra le paramétrage de base, un compte fictif par profil (adresses contact+…@talisoft.net, mot de passe commun de la configuration du serveur) et des dossiers fictifs.`
        : `${this.tenantName()} recevra le paramétrage de base : agences « Siège » et « Agence principale », produits actifs des modules souscrits, sources de lead et gabarits de projet. Ce qui existe déjà n’est pas modifié.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Charger', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._request(kind),
    });
  }

  public reload(): void {
    submit(this.reloadForm, async (field) => {
      const started = await firstValueFrom(
        this._api.requestTenantDataLoad(this.tenantId(), {
          kind: 'DemoReload',
          confirmationName: field().value().confirmation.trim(),
        }).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Rechargement refusé', REFUSALS[err.error?.error] ?? 'La demande n’a pas pu être enregistrée.');
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!started) return;
      this.reloadModel.set(new ReloadFormModel());
      // Champ vidé mais encore « touché » : sans ce reset, « Le nom ne correspond pas. » s'affichait aussitôt.
      this.reloadForm().reset();
      this._snackbar.success('Rechargement demandé', 'La démo sera remise à neuf dans les minutes qui viennent.');
      this._load();
    });
  }

  private _request(kind: 'Starter' | 'Demo'): void {
    this.isRequesting.set(true);
    this._api.requestTenantDataLoad(this.tenantId(), { kind }).pipe(
      catchError((err: HttpErrorResponse) => {
        this.isRequesting.set(false);
        this._snackbar.error('Chargement refusé', REFUSALS[err.error?.error] ?? 'La demande n’a pas pu être enregistrée.');
        return EMPTY;
      }),
    ).subscribe(() => {
      this.isRequesting.set(false);
      this._snackbar.success('Chargement demandé', 'Il sera réalisé dans la minute.');
      this._load();
    });
  }

  /** Relu toutes les 5 s tant qu'un chargement est en vol : le résultat arrive de l'API. */
  private _load(): void {
    this._api.listTenantDataLoads(this.tenantId()).pipe(catchError(() => EMPTY)).subscribe((loads) => {
      this.loads.set(loads ?? []);
      if (this._timer) clearTimeout(this._timer);
      if (this.inFlight()) this._timer = setTimeout(() => this._load(), 5000);
    });
  }
}
