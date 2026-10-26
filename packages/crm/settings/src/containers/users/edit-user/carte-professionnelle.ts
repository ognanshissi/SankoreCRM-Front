import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { CredentialDto, DistributionCredentialsApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { credentialCategoryLabel, formatDay } from './credential.models';
import { EditUserState } from './edit-user-state';
import { IssueCredentialDrawer, IssueCredentialDrawerData } from './issue-credential-drawer';
import { WithdrawCredentialDrawer, WithdrawCredentialDrawerData } from './withdraw-credential-drawer';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Même horizon que le rapport des cartes à échéance (`distribution-credentials/expiring`). */
const EXPIRY_WARNING_DAYS = 60;

/**
 * La carte professionnelle d'intermédiaire d'assurance (CIMA art. 503, 510). Le serveur l'exigeait
 * déjà pour signer un contrat d'assurance et recevoir un lead assurance, sans qu'aucun écran
 * permette de l'enregistrer : la signature était impossible depuis l'interface.
 *
 * Une carte n'est jamais modifiée : un renouvellement clôt la précédente, qui reste à l'historique,
 * parce qu'un contrôle demande si l'agent était habilité le jour où il a présenté un contrat.
 */
@Component({
  selector: 'user-carte-professionnelle',
  imports: [Button, TasIcon, TasSpinner, TasTable, TasTag],
  template: `
    @if (isLoading() && !loaded()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else if (loadFailed()) {
      <p class="text-sm text-slate-600 py-24 text-center">Les cartes de cet utilisateur n'ont pas pu être chargées.</p>
    } @else {
      <section class="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 class="text-xl font-bold text-primary">Carte professionnelle</h2>
            <p class="text-sm text-slate-600 mt-0.5">
              Exigée pour signer un contrat d'assurance et recevoir un lead assurance.
            </p>
          </div>
          @if (canManage()) {
            <div class="flex shrink-0 gap-2">
              @if (current()) {
                <button tas-outlined-button color="warn" type="button" class="rounded-full" (click)="openWithdraw()">Retirer</button>
              }
              <button tas-raised-button color="primary" type="button" class="rounded-full" (click)="openIssue()">
                <tas-icon [iconName]="current() ? 'feather:refresh-cw' : 'feather:plus'" style="font-size:14px"></tas-icon>
                {{ current() ? 'Renouveler' : 'Enregistrer une carte' }}
              </button>
            </div>
          }
        </div>

        @if (current(); as c) {
          <div class="mt-5 flex items-center gap-2">
            <tas-tag [severity]="validity().severity">{{ validity().label }}</tas-tag>
            @if (validity().detail; as detail) {
              <span class="text-sm text-slate-600">{{ detail }}</span>
            }
          </div>
          <dl class="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div>
              <dt class="text-xs text-slate-500">Catégorie</dt>
              <dd class="text-sm font-semibold text-slate-900 mt-0.5">{{ categoryLabel(c.category) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Délivrée par</dt>
              <dd class="text-sm font-semibold text-slate-900 mt-0.5">{{ c.issuingAuthority }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Validité</dt>
              <dd class="text-sm font-semibold text-slate-900 mt-0.5 tabular-nums">du {{ day(c.issuedOn) }} au {{ day(c.expiresOn) }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">RC professionnelle</dt>
              <dd class="text-sm font-semibold text-slate-900 mt-0.5">
                @if (c.hasIndemnityCover) {
                  {{ c.indemnityInsurer || 'Assureur non précisé' }} · jusqu'au {{ day(c.indemnityExpiresOn) }}
                } @else {
                  <span class="text-amber-700">Non renseignée</span>
                }
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">Formation</dt>
              <dd class="text-sm font-semibold text-slate-900 mt-0.5">
                @if (c.trainingHours != null) {
                  {{ c.trainingHours }} h
                  @if (c.trainingCompletedOn) { · terminée le {{ day(c.trainingCompletedOn) }} }
                } @else {
                  Non renseignée
                }
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-500">N° de carte</dt>
              <dd class="text-sm text-slate-600 mt-0.5">Enregistré chiffré, non affiché</dd>
            </div>
          </dl>
        } @else {
          <div class="mt-5 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
            <tas-icon iconName="feather:alert-triangle" class="mt-0.5 shrink-0" style="font-size:14px"></tas-icon>
            <p>
              Aucune carte en vigueur : cet utilisateur ne peut ni signer un contrat d'assurance ni recevoir de
              lead assurance.
            </p>
          </div>
        }
      </section>

      @if (history().length) {
        <section class="rounded-2xl bg-white shadow-sm border border-slate-100 p-6 mt-4">
          <h3 class="text-base font-semibold text-slate-900">Historique</h3>
          <p class="text-sm text-slate-600 mt-0.5">Les cartes closes, conservées pour les contrats présentés pendant leur validité.</p>
          <div class="mt-4">
            <tas-table [data]="history()" identifierField="id" [hasCaption]="false">
              <ng-template #header>
                <tr class="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th class="py-2 pr-4 font-medium">Catégorie</th>
                  <th class="py-2 pr-4 font-medium">Validité</th>
                  <th class="py-2 pr-4 font-medium">Close le</th>
                  <th class="py-2 pr-4 font-medium">Motif</th>
                </tr>
              </ng-template>
              <ng-template #body let-row>
                <tr class="text-sm">
                  <td class="py-3 pr-4 text-slate-900">{{ categoryLabel(row.category) }}</td>
                  <td class="py-3 pr-4 text-slate-700 tabular-nums">{{ day(row.issuedOn) }} – {{ day(row.expiresOn) }}</td>
                  <td class="py-3 pr-4 text-slate-700 tabular-nums">{{ day(row.validTo) }}</td>
                  <td class="py-3 pr-4 text-slate-600">{{ row.closedReason || '—' }}</td>
                </tr>
              </ng-template>
            </tas-table>
          </div>
        </section>
      }
    }
  `,
})
export class UserCarteProfessionnellePage {
  private readonly _api = inject(DistributionCredentialsApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _state = inject(EditUserState);

  public readonly id = input.required<string>();
  public readonly canManage = inject(PermissionsService).can('user:credential:manage');

  public readonly isLoading = signal(true);
  public readonly loaded = signal(false);
  public readonly loadFailed = signal(false);
  private readonly _credentials = signal<CredentialDto[]>([]);

  public readonly current = computed(() => this._credentials().find((c) => c.isCurrent) ?? null);
  public readonly history = computed(() => this._credentials().filter((c) => !c.isCurrent));

  public readonly categoryLabel = credentialCategoryLabel;
  public readonly day = formatDay;

  /** Le serveur dit si la carte est valide aujourd'hui (dates ET RC) ; l'écran explique pourquoi. */
  public readonly validity = computed<{ label: string; severity: Severity; detail: string | null }>(() => {
    const c = this.current();
    if (!c) return { label: 'Aucune carte', severity: 'neutral', detail: null };
    const today = new Date().toISOString().slice(0, 10);
    if (!c.isValidToday) {
      if (c.issuedOn && c.issuedOn > today) return { label: 'Pas encore valide', severity: 'warning', detail: `à partir du ${formatDay(c.issuedOn)}` };
      if (c.expiresOn && c.expiresOn < today) return { label: 'Échue', severity: 'error', detail: `depuis le ${formatDay(c.expiresOn)}` };
      return { label: 'Invalide', severity: 'error', detail: 'la RC professionnelle est échue' };
    }
    const daysLeft = Math.ceil((Date.parse(c.expiresOn ?? '') - Date.parse(today)) / DAY_MS);
    return daysLeft <= EXPIRY_WARNING_DAYS
      ? { label: 'Valide', severity: 'warning', detail: `échéance dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}` }
      : { label: 'Valide', severity: 'success', detail: null };
  });

  constructor() {
    effect(() => this._load(this.id()));
  }

  public openIssue(): void {
    const ref = this._drawer.open<boolean, IssueCredentialDrawerData, IssueCredentialDrawer>(IssueCredentialDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: {
        userId: this.id(),
        userName: this._userName(),
        current: this.current(),
      } satisfies IssueCredentialDrawerData,
    });
    ref.closed.subscribe((done) => {
      if (done) this._load(this.id());
    });
  }

  public openWithdraw(): void {
    const ref = this._drawer.open<boolean, WithdrawCredentialDrawerData, WithdrawCredentialDrawer>(WithdrawCredentialDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { userId: this.id(), userName: this._userName() } satisfies WithdrawCredentialDrawerData,
    });
    ref.closed.subscribe((done) => {
      if (done) this._load(this.id());
    });
  }

  private _userName(): string {
    const u = this._state.user();
    return u?.fullName ?? u?.email ?? 'cet utilisateur';
  }

  private _load(id: string): void {
    this.isLoading.set(true);
    this._api
      .listUserCredentials(id)
      .pipe(catchError(() => of(null)))
      .subscribe((rows) => {
        this.loadFailed.set(rows === null);
        this._credentials.set(rows ?? []);
        this.loaded.set(true);
        this.isLoading.set(false);
      });
  }
}

export default UserCarteProfessionnellePage;
