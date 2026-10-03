import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, Observable, of } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { PermissionCode, PermissionsService } from '@sankore/crm/common';
import {
  AgenciesApiService,
  AgencyDto,
  ClientDetailDto,
  ClientLifecycleApiService,
  ClientLifecycleStateDto,
  UserDto,
  UsersApiService,
} from '@sankore/crm-api';
import { clientStatusLabel } from '../../models/client-labels';

/** Les cinq actions de cycle de vie exposées par `ClientLifecycleApiService`. */
export type LifecycleActionKind =
  | 'suspend'
  | 'reactivate'
  | 'archive'
  | 'assignAdvisor'
  | 'transfer';

export interface LifecycleActionDrawerData {
  action: LifecycleActionKind;
  client: ClientDetailDto;
}

/**
 * Permission exigée par le serveur, action par action. Le swagger la déclare endpoint par
 * endpoint et la répartition ne se devine pas : `customers:update` ne couvre que
 * l'affectation d'un conseiller, la suspension / réactivation / transfert relèvent de
 * `customers:update_sensitive`, et l'archivage de `customers:archive` (comme
 * l'anonymisation, qui n'est pas exposée par ce menu). Un seul droit global rendrait le menu
 * menteur : il proposerait des actions que le serveur refuserait en 403.
 */
export const LIFECYCLE_ACTION_PERMISSIONS: Record<LifecycleActionKind, PermissionCode> = {
  suspend: 'customers:update_sensitive',
  reactivate: 'customers:update_sensitive',
  archive: 'customers:archive',
  assignAdvisor: 'customers:update',
  transfer: 'customers:update_sensitive',
};

/**
 * Alias de type et non interface : `tas-select` déclare `options` en
 * `{ [key: string]: any }[]`, et seul un alias d'objet reçoit la signature d'index
 * implicite qui rend l'affectation légale sous `strictTemplates`.
 */
type ReasonOption = { label: string; value: string };

/**
 * Tout ce qui change d'une action à l'autre. Le reste du drawer — motif, commentaire,
 * gestion d'erreur, message de succès — est commun, ce qui garantit qu'un bouton porte
 * le même nom de son déclenchement à son message de succès.
 */
interface LifecycleActionSpec {
  title: string;
  icon: string;
  /** Libellé du bouton, repris mot pour mot dans le titre du succès. */
  cta: string;
  successTitle: string;
  successMessage: string;
  errorFallback: string;
  /**
   * Le contrat impose un motif (`REASON_REQUIRED`) pour la suspension, l'archivage et le
   * transfert. `reactivateClient` n'accepte aucun corps de requête et `AssignAdvisorRequest`
   * ne porte que `advisorUserId` : demander un motif sur ces deux actions afficherait un
   * champ que le serveur jetterait sans le stocker.
   */
  requiresReason: boolean;
  needsAdvisor: boolean;
  needsAgency: boolean;
  reasons: ReasonOption[];
  /** L'archivage demande une seconde confirmation avant l'appel. */
  secondConfirmation: boolean;
}

/** Choisir « Autre » rend le commentaire libre obligatoire : sinon le motif ne dit rien. */
const OTHER_REASON = 'Autre';

/**
 * Listes de motifs paramétrées côté front. Le contrat ne définit aucune nomenclature de
 * motifs : `reason` est une chaîne libre dans `SuspendClientRequest`, `ArchiveClientRequest`
 * et `TransferClientRequest`. Ces listes sont donc une proposition métier à confirmer côté
 * API — le jour où le serveur expose un référentiel, seules ces constantes changent.
 */
const SUSPEND_REASONS: ReasonOption[] = [
  'Soupçon de fraude',
  'Documents KYC expirés',
  'Décision de conformité',
  'Impayés persistants',
  'Demande du client',
  OTHER_REASON,
].map((label) => ({ label, value: label }));

const ARCHIVE_REASONS: ReasonOption[] = [
  'Clôture de la relation commerciale',
  'Départ vers un autre établissement',
  'Client décédé',
  'Inactivité prolongée',
  'Doublon conservé sur une autre fiche',
  OTHER_REASON,
].map((label) => ({ label, value: label }));

const TRANSFER_REASONS: ReasonOption[] = [
  'Déménagement du client',
  'Rapprochement géographique',
  'Réorganisation du réseau',
  'Demande du client',
  OTHER_REASON,
].map((label) => ({ label, value: label }));

const ACTION_SPECS: Record<LifecycleActionKind, LifecycleActionSpec> = {
  suspend: {
    title: 'Suspendre le client',
    icon: 'feather:pause-circle',
    cta: 'Suspendre',
    successTitle: 'Client suspendu',
    successMessage: 'Le client est suspendu et le motif est enregistré dans son historique.',
    errorFallback: 'Impossible de suspendre ce client.',
    requiresReason: true,
    needsAdvisor: false,
    needsAgency: false,
    reasons: SUSPEND_REASONS,
    secondConfirmation: false,
  },
  reactivate: {
    title: 'Réactiver le client',
    icon: 'feather:play-circle',
    cta: 'Réactiver',
    successTitle: 'Client réactivé',
    successMessage: 'La suspension est levée.',
    errorFallback: 'Impossible de réactiver ce client.',
    requiresReason: false,
    needsAdvisor: false,
    needsAgency: false,
    reasons: [],
    secondConfirmation: false,
  },
  archive: {
    title: 'Archiver le client',
    icon: 'feather:archive',
    cta: 'Archiver',
    successTitle: 'Client archivé',
    successMessage: 'La fiche passe en lecture seule et la date d\'archivage est horodatée.',
    errorFallback: "Impossible d'archiver ce client.",
    requiresReason: true,
    needsAdvisor: false,
    needsAgency: false,
    reasons: ARCHIVE_REASONS,
    secondConfirmation: true,
  },
  assignAdvisor: {
    title: 'Réaffecter le client',
    icon: 'feather:user-check',
    cta: 'Réaffecter',
    successTitle: 'Client réaffecté',
    successMessage: 'Le nouveau conseiller suit désormais la relation.',
    errorFallback: 'Impossible de réaffecter ce client.',
    requiresReason: false,
    needsAdvisor: true,
    needsAgency: false,
    reasons: [],
    secondConfirmation: false,
  },
  transfer: {
    title: 'Transférer le client',
    icon: 'feather:git-branch',
    cta: 'Transférer',
    successTitle: 'Client transféré',
    successMessage: 'Le portefeuille du client est rattaché à sa nouvelle agence.',
    errorFallback: 'Impossible de transférer ce client.',
    requiresReason: true,
    needsAdvisor: false,
    needsAgency: true,
    reasons: TRANSFER_REASONS,
    secondConfirmation: false,
  },
};

/**
 * `UserDto.status` est déclaré `type: string` sans énumération, et le module Leads montre
 * que le serveur renvoie parfois l'index numérique sous forme de chaîne. Le filtre accepte
 * donc les deux formes plutôt que d'écarter en silence tous les conseillers.
 */
function isActiveUser(user: UserDto): boolean {
  const raw = String(user.status ?? '').toLowerCase();
  return raw === 'active' || raw === '0';
}

export class LifecycleActionFormModel {
  public reasonCode!: string;
  public comment!: string;
  public advisorUserId!: string;
  public targetAgencyId!: string;

  public static instantiate(): LifecycleActionFormModel {
    const model = new LifecycleActionFormModel();
    model.reasonCode = '';
    model.comment = '';
    model.advisorUserId = '';
    model.targetAgencyId = '';
    return model;
  }
}

@Component({
  selector: 'lifecycle-action-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasSpinner,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon [iconName]="spec.icon" style="font-size:18px"></tas-icon>
          <tas-title class="text-lg">{{ spec.title }}</tas-title>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="mb-5 p-3 rounded-lg border border-slate-200 bg-slate-50">
          <p class="text-sm font-medium text-slate-800">
            {{ data.client.displayName || '—' }}
          </p>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ data.client.clientNumber || '—' }} — statut actuel :
            {{ currentStatusLabel() }}
          </p>
        </div>

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          @if (spec.needsAdvisor) {
            @if (isLoadingOptions()) {
              <div class="flex items-center gap-2 py-2">
                <tas-spinner size="4" class="text-primary"></tas-spinner>
                <span class="text-xs text-slate-500">Chargement des conseillers…</span>
              </div>
            } @else {
              <!--
                Le select reste l'unique nœud racine du champ : placé dans un bloc @else
                accompagné d'un frère, il ne serait plus projeté dans le slot de contrôle de
                tas-form-field (NG8011) et le champ s'afficherait vide.
              -->
              <tas-form-field>
                <tas-label>
                  Nouveau conseiller <span class="text-functional-error">*</span>
                </tas-label>
                <tas-select
                  [options]="advisorOptions()"
                  [searchable]="true"
                  placeholder="Choisissez un conseiller"
                  [formField]="formSchema.advisorUserId"
                ></tas-select>
                @if (formSchema.advisorUserId().touched() && formSchema.advisorUserId().invalid()) {
                  <tas-error>{{ formSchema.advisorUserId().errors()[0].message }}</tas-error>
                } @else {
                  <tas-hint>
                    Seuls les agents actifs de l'agence du client sont proposés.
                  </tas-hint>
                }
              </tas-form-field>
            }

            @if (!isLoadingOptions() && advisorOptions().length === 0) {
              <div class="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50">
                <tas-icon
                  iconName="feather:alert-triangle"
                  class="text-amber-600 mt-0.5"
                  style="font-size:14px"
                ></tas-icon>
                <p class="text-xs text-amber-900">
                  Aucun autre agent actif dans l'agence de ce client. Transférez d'abord le
                  client vers l'agence du conseiller visé.
                </p>
              </div>
            }
          }

          @if (spec.needsAgency) {
            @if (isLoadingOptions()) {
              <div class="flex items-center gap-2 py-2">
                <tas-spinner size="4" class="text-primary"></tas-spinner>
                <span class="text-xs text-slate-500">Chargement des agences…</span>
              </div>
            } @else {
              <tas-form-field>
                <tas-label>
                  Agence de destination <span class="text-functional-error">*</span>
                </tas-label>
                <tas-select
                  [options]="agencyOptions()"
                  [searchable]="true"
                  placeholder="Choisissez une agence"
                  [formField]="formSchema.targetAgencyId"
                ></tas-select>
                @if (formSchema.targetAgencyId().touched() && formSchema.targetAgencyId().invalid()) {
                  <tas-error>{{ formSchema.targetAgencyId().errors()[0].message }}</tas-error>
                } @else {
                  <tas-hint>
                    Le conseiller actuel n'est conservé que s'il appartient aussi à l'agence
                    de destination.
                  </tas-hint>
                }
              </tas-form-field>
            }
          }

          @if (spec.requiresReason) {
            <tas-form-field>
              <tas-label>Motif <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="spec.reasons"
                placeholder="Choisissez un motif"
                [formField]="formSchema.reasonCode"
              ></tas-select>
              @if (formSchema.reasonCode().touched() && formSchema.reasonCode().invalid()) {
                <tas-error>{{ formSchema.reasonCode().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>
                Commentaire
                @if (commentRequired()) {
                  <span class="text-functional-error">*</span>
                }
              </tas-label>
              <input
                tasInput
                type="text"
                [placeholder]="commentPlaceholder()"
                [formField]="formSchema.comment"
              />
              @if (formSchema.comment().touched() && formSchema.comment().invalid()) {
                <tas-error>{{ formSchema.comment().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>
                  Le motif est conservé dans l'historique des statuts du client.
                </tas-hint>
              }
            </tas-form-field>
          }

          @if (spec.requiresReason) {
            <div class="p-3 rounded-lg border border-slate-200 bg-white">
              <p class="text-xs text-slate-400 mb-1">Motif enregistré</p>
              <p class="text-sm text-slate-700">{{ reasonPreview() }}</p>
            </div>
          }

          @if (!spec.requiresReason) {
            <div class="flex items-start gap-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
              <tas-icon
                iconName="feather:info"
                class="text-slate-500 mt-0.5"
                style="font-size:14px"
              ></tas-icon>
              <p class="text-xs text-slate-600">{{ noReasonNotice }}</p>
            </div>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="handleSubmit()"
            [disabled]="formSchema().invalid() || formSchema().submitting() || isLoadingOptions()"
            [isLoading]="formSchema().submitting()"
          >
            {{ spec.cta }}
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class LifecycleActionDrawer {
  public readonly data: LifecycleActionDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<ClientLifecycleStateDto>);
  private readonly _lifecycleApi = inject(ClientLifecycleApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _permissions = inject(PermissionsService);

  public readonly spec = ACTION_SPECS[this.data.action];

  public readonly isLoadingOptions = signal(
    this.spec.needsAdvisor || this.spec.needsAgency,
  );

  public readonly advisorOptions = signal<ReasonOption[]>([]);
  public readonly agencyOptions = signal<ReasonOption[]>([]);

  public readonly currentStatusLabel = computed(() =>
    clientStatusLabel(this.data.client.status),
  );

  public readonly noReasonNotice =
    this.data.action === 'reactivate'
      ? "Le statut obtenu dépend du dossier KYC : actif s'il est validé, KYC en attente sinon."
      : "Le contrat de réaffectation ne transporte pas de motif : seul le changement de conseiller est journalisé.";

  public model = signal(LifecycleActionFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.reasonCode, {
      message: 'Le motif est obligatoire',
      when: () => this.spec.requiresReason,
    });
    required(schema.comment, {
      message: 'Précisez le motif dans le commentaire',
      when: (ctx) =>
        this.spec.requiresReason && ctx.valueOf(schema.reasonCode) === OTHER_REASON,
    });
    required(schema.advisorUserId, {
      message: 'Choisissez le conseiller à affecter',
      when: () => this.spec.needsAdvisor,
    });
    required(schema.targetAgencyId, {
      message: "Choisissez l'agence de destination",
      when: () => this.spec.needsAgency,
    });
  });

  public readonly commentRequired = computed(
    () => this.formSchema.reasonCode().value() === OTHER_REASON,
  );

  public readonly commentPlaceholder = computed(() =>
    this.commentRequired() ? 'Décrivez le motif' : 'Précision facultative',
  );

  public readonly reasonPreview = computed(() => {
    const reason = this._composeReason(
      this.formSchema.reasonCode().value(),
      this.formSchema.comment().value(),
    );
    return reason || 'Aucun motif saisi pour le moment.';
  });

  constructor() {
    if (this.spec.needsAdvisor) this._loadAdvisors();
    if (this.spec.needsAgency) this._loadAgencies();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      // Dernier verrou avant l'appel : le menu filtre déjà sur cette permission, mais le
      // drawer est la porte par laquelle passent toutes les écritures de cycle de vie.
      // `has` et non `can` : on est dans un gestionnaire, hors contexte réactif.
      if (!this._permissions.has(LIFECYCLE_ACTION_PERMISSIONS[this.data.action])) {
        this._snackbar.error(
          'Action refusée',
          "Vous n'avez pas le droit d'effectuer cette action sur un client.",
        );
        return;
      }

      if (this.spec.secondConfirmation && !(await this._askSecondConfirmation())) {
        return;
      }

      const state = await firstValueFrom(
        this._call(value).pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error));
            return EMPTY;
          }),
        ),
      );

      if (!state) return;

      this._snackbar.success(this.spec.successTitle, this._successMessage(state));
      this._dialogRef.close(state);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _call(value: LifecycleActionFormModel): Observable<ClientLifecycleStateDto> {
    const clientId = this.data.client.id as string;
    const reason = this._composeReason(value.reasonCode, value.comment);

    switch (this.data.action) {
      case 'suspend':
        return this._lifecycleApi.suspendClient(clientId, { reason });
      case 'reactivate':
        return this._lifecycleApi.reactivateClient(clientId);
      case 'archive':
        return this._lifecycleApi.archiveClient(clientId, { reason });
      case 'assignAdvisor':
        return this._lifecycleApi.assignClientAdvisor(clientId, {
          advisorUserId: value.advisorUserId,
        });
      case 'transfer':
        return this._lifecycleApi.transferClientToAgency(clientId, {
          targetAgencyId: value.targetAgencyId,
          reason,
        });
      default:
        return EMPTY;
    }
  }

  /**
   * Le statut obtenu après une réactivation dépend du dossier KYC : le contrat demande de
   * le relire dans la réponse plutôt que de supposer « Actif ».
   */
  private _successMessage(state: ClientLifecycleStateDto): string {
    if (this.data.action === 'reactivate') {
      return `La suspension est levée. Nouveau statut : ${clientStatusLabel(state.status)}.`;
    }
    if (this.data.action === 'transfer' && state.advisorUserId === null) {
      return "Le portefeuille est rattaché à sa nouvelle agence. Le conseiller n'appartenant pas à cette agence, l'affectation a été remise à zéro.";
    }
    return this.spec.successMessage;
  }

  private _composeReason(reasonCode: string, comment: string): string {
    const code = (reasonCode ?? '').trim();
    const detail = (comment ?? '').trim();
    if (!code) return detail;
    return detail ? `${code} — ${detail}` : code;
  }

  private _askSecondConfirmation(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._confirmDialog.confirm({
        title: 'Archiver définitivement ce client ?',
        message:
          "L'archivage est définitif : la fiche passe en lecture seule et ce module n'expose aucune suppression. " +
          `Confirmez-vous l'archivage de ${this.data.client.displayName ?? 'ce client'} ?`,
        closable: true,
        showCancelButton: true,
        acceptButtonProps: { label: 'Archiver', theme: 'warn' },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  private _loadAdvisors(): void {
    const agencyId = this.data.client.agencyId;
    if (!agencyId) {
      this.isLoadingOptions.set(false);
      return;
    }

    // Critère 4 : le serveur filtre déjà sur l'agence et le statut actif, mais le filtre est
    // redoublé côté front — un `ADVISOR_NOT_ELIGIBLE` renvoyé après coup est une erreur que
    // l'utilisateur ne peut pas corriger depuis cet écran.
    // 'Active' — et non le `0` qui était écrit ici. Le contrat exposait ce filtre en entier,
    // où 0 est PendingActivation, pas « pas de filtre » : cet écran proposait donc comme
    // conseillers les comptes qui n'ont jamais été activés, et aucun compte actif. Le nom rend
    // la méprise impossible.
    this._usersApi
      .listUsers('Active', agencyId, undefined, 1, 200)
      .pipe(catchError(() => of({ items: [] as UserDto[] })))
      .subscribe((result) => {
        const currentAdvisorId = this.data.client.advisorUserId;
        const options = (result.items ?? [])
          .filter((u) => !!u.id && u.agencyId === agencyId && isActiveUser(u))
          .filter((u) => u.id !== currentAdvisorId)
          .map((u) => ({
            label: u.fullName || u.email || (u.id as string),
            value: u.id as string,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

        this.advisorOptions.set(options);
        this.isLoadingOptions.set(false);
      });
  }

  private _loadAgencies(): void {
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(catchError(() => of({ items: [] as AgencyDto[] })))
      .subscribe((result) => {
        const options = (result.items ?? [])
          .filter((a) => !!a.id && a.isActive !== false)
          .filter((a) => a.id !== this.data.client.agencyId)
          .map((a) => ({
            label: a.code ? `${a.name ?? a.code} (${a.code})` : (a.name ?? (a.id as string)),
            value: a.id as string,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

        this.agencyOptions.set(options);
        this.isLoadingOptions.set(false);
      });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    // Les codes métier du contrat méritent une phrase que l'utilisateur peut agir dessus.
    const code = error.error?.code ?? error.error?.title;
    switch (code) {
      case 'CLIENT_HAS_ACTIVE_COMMITMENTS':
        return "Ce client porte encore un engagement financier ouvert : soldez-le avant d'archiver la fiche.";
      case 'INVALID_STATUS_TRANSITION':
        return `Cette action n'est pas permise depuis le statut « ${clientStatusLabel(
          this.data.client.status,
        )} ». Rechargez la fiche : son statut a peut-être changé.`;
      case 'CLIENT_READ_ONLY':
        return 'La fiche est archivée ou fusionnée : elle ne se modifie plus.';
      case 'ADVISOR_NOT_ELIGIBLE':
        return "Ce conseiller n'est pas un agent actif de l'agence du client.";
      case 'AGENCY_OUT_OF_SCOPE':
        return "Cette agence est hors de votre périmètre : vous ne pouvez pas y transférer ce client.";
      case 'REASON_REQUIRED':
        return 'Le serveur exige un motif pour cette action.';
      default:
        return firstError ?? error.error?.title ?? this.spec.errorFallback;
    }
  }
}
