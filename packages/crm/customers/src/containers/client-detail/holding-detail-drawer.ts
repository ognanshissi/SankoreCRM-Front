import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { EMPTY, Observable, catchError, firstValueFrom } from 'rxjs';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { Router } from '@angular/router';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import {
  DesignationDto,
  HoldingDto,
  ProductDto,
  ProductHoldingsApiService,
  ProductsApiService,
} from '@sankore/crm-api';
import {
  designationRoleLabel,
  designationStatusLabel,
  designationStatusSeverity,
  HOLDING_PERIODICITY_OPTIONS,
  holdingPeriodicityLabel,
  holdingStatusLabel,
  holdingStatusSeverity,
  institutionCurrency,
  isDesignationToReview,
  productCategoryLabel,
} from '@sankore/crm/common';
import { ClientDetailStore } from '../../models/client-detail.store';
import { DesignationsEditor } from './designations-editor';

/** Cadence et borne du suivi « temps réel » d'un produit en synchronisation. */
const SYNC_POLL_INTERVAL_MS = 10_000;
const SYNC_POLL_MAX_TICKS = 18;

/**
 * Provenance d'un produit détenu. `origin` est une chaîne libre au contrat — aucune
 * énumération n'est déclarée — donc les codes connus sont traduits et tout autre code
 * retombe sur une mention neutre plutôt que de bloquer l'écran.
 */
export function holdingOriginLabel(origin: string | null | undefined): string {
  if (!origin) return 'Saisi au CRM';
  // Les deux valeurs de `HoldingOrigin` côté serveur ; les autres sont gardées par prudence.
  // « CrmSubscription » s'affichait tel quel, faute d'être dans la liste.
  switch (origin) {
    case 'CrmSubscription':
    case 'Crm':
    case 'Manual':
    case 'Agent':
      return 'Saisi au CRM';
    case 'Lead':
    case 'LeadConversion':
      return 'Repris du lead';
    case 'ImportedFromBackOffice':
    case 'BackOffice':
    case 'Import':
    case 'CoreBanking':
    case 'External':
      return 'Importé du back-office';
    default:
      return origin;
  }
}

/** Un produit importé du back-office ne se modifie pas depuis le CRM (BNF-F-10). */
export function isHoldingReadOnly(holding: HoldingDto | null | undefined): boolean {
  return holding?.isReadOnly === true;
}

export type HoldingAction =
  | 'requestSignature'
  | 'sign'
  | 'submit'
  | 'returnToDraft'
  | 'close'
  | 'designate'
  | 'specifics';

/**
 * Codes acceptés pour chaque action. Le contrat déclare `availableActions` en tableau
 * de chaînes sans énumération : on reconnaît donc plusieurs orthographes plausibles,
 * à la casse et à la ponctuation près, plutôt que d'en parier une seule.
 */
const ACTION_ALIASES: Record<HoldingAction, string[]> = {
  requestSignature: ['requestsignature', 'signaturerequest', 'requestholdingsignature'],
  sign: ['sign', 'signholding', 'signature'],
  submit: ['submit', 'submission', 'submitholding', 'send', 'sendtobackoffice'],
  returnToDraft: ['returntodraft', 'correct', 'backtodraft', 'reopen'],
  close: ['close', 'closure', 'closeholding'],
  designate: ['designate', 'designations', 'setdesignations', 'amend', 'amendment'],
  specifics: ['updatespecifics', 'specifics', 'terms', 'updateterms'],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * L'action est-elle proposée pour ce produit ?
 *
 * `availableActions` fait foi quand le serveur l'envoie : le front ne rejoue pas la
 * machine à états (BNF-B-13). Le repli par statut n'existe que pour les réponses qui
 * ne portent pas encore ce tableau — sans lui, un produit en brouillon n'offrirait
 * aucune action du tout et l'écran serait inutilisable.
 */
export function isHoldingActionAvailable(
  holding: HoldingDto | null | undefined,
  action: HoldingAction,
): boolean {
  if (!holding || isHoldingReadOnly(holding)) return false;

  const declared = (holding.availableActions ?? []).map(normalize).filter((code) => !!code);
  if (declared.length > 0) {
    return ACTION_ALIASES[action].some((alias) => declared.includes(alias));
  }

  const status = holding.status;
  switch (action) {
    case 'requestSignature':
      return status === 'Draft';
    case 'sign':
      return status === 'PendingSignature';
    case 'submit':
      return !!holding.signedAt && status !== 'Active' && status !== 'Closed' && status !== 'PendingSync';
    case 'returnToDraft':
      return status === 'Rejected';
    case 'close':
      return status === 'Active';
    case 'designate':
      return holding.canEdit === true || status === 'Active';
    case 'specifics':
      return holding.canEdit === true && status !== 'Active' && status !== 'Closed';
  }
}

/**
 * Message français utile à partir d'une réponse d'erreur.
 *
 * Le serveur (`HoldingHttp`) renvoie le code sous `error` (`{ error: 'HOLDING_ALREADY_HELD' }`), ou
 * dans le `detail` d'un ProblemDetails pour les 400 et les 503. La lecture se faisait sur `code`,
 * qu'aucune réponse ne porte : aucun code n'était traduit et l'agent voyait l'identifiant brut.
 * Un code inconnu remonte le `title` ou le `detail` du serveur, qui en dit toujours plus qu'un
 * message générique.
 */
export function holdingErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error.error as
    | { code?: string; error?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
    | undefined;

  const detailCode = body?.detail && /^[A-Z0-9_]+$/.test(body.detail) ? body.detail : undefined;
  const code = body?.code ?? body?.error ?? detailCode;

  switch (code) {
    case 'HOLDING_ALREADY_HELD':
      return "Ce client détient déjà ce produit et la ligne de produit n'autorise pas de doublon.";
    case 'HOLDING_SPECIFICS_INVALID_PERIODICITY':
      return 'Choisissez la périodicité dans la liste.';
    case 'HOLDING_INSURANCE_REQUIRES_PROJECT':
      return "Une assurance se souscrit depuis un projet : ouvrez-le dans l'onglet « Projets » de la fiche.";
    case 'DESIGNATION_REQUIRED_ROLE_MISSING':
      return "La clause ne satisfait pas un rôle exigé par la ligne de produit : complétez les désignations avant de demander la signature.";
    case 'DESIGNATION_SHARES_MUST_TOTAL_100':
      return 'Les quotes-parts d\'un rang ne totalisent pas 100 %.';
    case 'HOLDING_INVALID_TRANSITION':
    case 'HOLDING_NOT_EDITABLE':
    case 'HOLDING_READ_ONLY':
      return "Le statut du produit ne permet plus cette action. Rechargez l'écran pour voir son état réel.";
    case 'HOLDING_SYNC_IN_PROGRESS':
      return "Le produit est en cours d'envoi au système partenaire : attendez sa réponse avant de le modifier.";
    case 'HOLDING_SIGNATURE_REQUIRED':
      return 'Indiquez la date et le mode de signature.';
    case 'HOLDING_INFORMATION_SHEET_NOT_DELIVERED':
      return "Remettez d'abord la fiche d'information de l'assureur au client (écran de souscription assurance), puis enregistrez la signature.";
    case 'PRODUCT_LINE_NOT_FOUND':
      return "Cette ligne de produit n'existe plus dans le catalogue.";
    case 'PRODUCT_LINE_UNAVAILABLE':
      return 'Le catalogue des produits est momentanément illisible. Réessayez dans un instant.';
    case 'CLIENT_READ_ONLY':
      return 'Ce client est en lecture seule (archivé ou anonymisé) : aucun produit ne peut être modifié.';
    case 'CONCURRENCY_CONFLICT':
      return "Le produit a été modifié entre-temps. Rechargez l'écran puis recommencez.";
    case 'CLIENT_NOT_FOUND':
    case 'HOLDING_NOT_FOUND':
      return "Ce produit ou ce client n'est pas accessible.";
    default:
      break;
  }

  const fieldErrors = Object.values(body?.errors ?? {}).flat();
  if (fieldErrors.length > 0) return fieldErrors.join(' ');
  return body?.detail || body?.title || code || fallback;
}

/** Une position de la frise de suivi. */
interface TimelineStep {
  key: string;
  label: string;
  state: 'done' | 'current' | 'waiting' | 'failed';
  at: string | null;
  detail: string | null;
}

/**
 * Frise de suivi d'un produit détenu — saisie, signature, envoi, accusé ou rejet, avec
 * horodatage (BNF-F-12).
 *
 * Quatre positions d'un état d'avancement, pas une collection d'entités : elle reste
 * du HTML ordinaire.
 */
@Component({
  selector: 'holding-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    <ol class="flex flex-col" role="list">
      @for (step of steps(); track step.key) {
        <li class="flex items-start gap-3 py-2.5">
          <tas-icon
            [iconName]="icon(step.state)"
            [class]="color(step.state)"
            class="mt-0.5 shrink-0"
            style="font-size:16px"
          ></tas-icon>
          <div class="min-w-0">
            <p class="text-sm font-medium text-slate-800">{{ step.label }}</p>
            <p class="text-xs" [class]="color(step.state)">
              {{ stateLabel(step.state) }}@if (step.at) { · {{ formatDateTime(step.at) }} }
            </p>
            @if (step.detail) {
              <p class="mt-1 text-sm text-slate-600">{{ step.detail }}</p>
            }
          </div>
        </li>
      }
    </ol>
  `,
})
export class HoldingTimeline {
  public readonly holding = input.required<HoldingDto>();

  public readonly steps = computed<TimelineStep[]>(() => {
    const h = this.holding();
    const status = h.status;
    const isRejected = status === 'Rejected';
    const isActive = status === 'Active';
    const isClosed = status === 'Closed';
    const isPendingSync = status === 'PendingSync';
    // Accepté par l'assureur, prime pas encore payée : l'accusé est là, la vigueur non.
    const isAwaitingPayment = status === 'AwaitingPayment';

    const steps: TimelineStep[] = [
      {
        key: 'draft',
        label: 'Saisie',
        state: 'done',
        at: h.createdAt ?? null,
        detail: null,
      },
      {
        key: 'signature',
        label: 'Signature électronique',
        state: h.signedAt ? 'done' : status === 'PendingSignature' ? 'current' : 'waiting',
        at: h.signedAt ?? null,
        detail: null,
      },
      {
        key: 'submission',
        label: 'Envoi au back-office',
        state: isPendingSync
          ? 'current'
          : isActive || isAwaitingPayment || isRejected || h.syncedAt
            ? 'done'
            : 'waiting',
        at: null,
        detail: h.externalSystem ? `Destinataire : ${h.externalSystem}` : null,
      },
      {
        key: 'acknowledgement',
        label: isRejected ? 'Rejet du back-office' : 'Accusé du back-office',
        state: isRejected ? 'failed' : isActive || isAwaitingPayment ? 'done' : isPendingSync ? 'current' : 'waiting',
        at: h.syncedAt ?? null,
        detail: isRejected
          ? h.rejectionReason || 'Motif non communiqué par le back-office.'
          : h.externalRef
            ? `Référence externe : ${h.externalRef}`
            : null,
      },
    ];

    if (isAwaitingPayment || (isActive && h.productCategory && ['Insurance', 'HealthInsurance', 'ForecastInsurance'].includes(h.productCategory))) {
      steps.push({
        key: 'payment',
        label: 'Paiement de la prime',
        state: isAwaitingPayment ? 'current' : 'done',
        at: null,
        detail: isAwaitingPayment ? "Le contrat entre en vigueur dès que la prime est confirmée." : null,
      });
    }

    if (isClosed) {
      steps.push({
        key: 'closed',
        label: 'Clôture',
        state: 'done',
        at: h.updatedAt ?? null,
        detail: null,
      });
    }

    return steps;
  });

  public icon(state: TimelineStep['state']): string {
    switch (state) {
      case 'done':
        return 'feather:check-circle';
      case 'current':
        return 'feather:loader';
      case 'failed':
        return 'feather:x-circle';
      default:
        return 'feather:circle';
    }
  }

  public color(state: TimelineStep['state']): string {
    switch (state) {
      case 'done':
        return 'text-green-700';
      case 'current':
        return 'text-primary';
      case 'failed':
        return 'text-functional-error';
      default:
        return 'text-slate-400';
    }
  }

  public stateLabel(state: TimelineStep['state']): string {
    switch (state) {
      case 'done':
        return 'Fait';
      case 'current':
        return 'En cours';
      case 'failed':
        return 'En échec';
      default:
        return 'En attente';
    }
  }

  public formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

class SignatureFormModel {
  public signatureReference!: string;
  public signedAt!: string;

  public static instantiate(): SignatureFormModel {
    const model = new SignatureFormModel();
    model.signatureReference = '';
    model.signedAt = new Date().toISOString().slice(0, 10);
    return model;
  }
}

class CloseFormModel {
  public reason!: string;

  public static instantiate(): CloseFormModel {
    const model = new CloseFormModel();
    model.reason = '';
    return model;
  }
}

/**
 * Actions de cycle de vie d'un produit détenu : demande de signature, signature
 * électronique, envoi au back-office, correction après rejet, clôture.
 *
 * Partagé par le drawer de détail (BNF-F-12) et par la dernière étape du parcours de
 * souscription (BNF-F-11) : « signature puis envoi » est exactement la même séquence
 * des deux côtés, et la dupliquer ferait diverger les messages d'erreur.
 */
@Component({
  selector: 'holding-signature-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    Button,
    TasIcon,
    TasInput,
    TasDatePicker,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasTag,
  ],
  template: `
    <div class="rounded-lg border border-slate-200 p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-sm font-semibold text-slate-800">Signature et envoi</p>
          <p class="text-xs text-slate-500">
            Chaque étape est confirmée par le serveur, pas par cet écran.
          </p>
        </div>
        <tas-tag [severity]="statusSeverity()">{{ statusLabel() }}</tas-tag>
      </div>

      @if (errorMessage(); as message) {
        <div class="mt-3 rounded-lg border border-functional-error/40 bg-functional-error/5 p-3">
          <p class="text-sm text-functional-error">{{ message }}</p>
        </div>
      }

      @if (readOnly()) {
        <p class="mt-3 text-sm text-slate-500">
          Ce produit est en lecture seule : aucune action n'est possible depuis le CRM.
        </p>
      } @else {
        <div class="mt-3 flex flex-wrap items-center gap-2">
          @if (isInsurance()) {
            <!--
              Un contrat d'assurance suit un ordre imposé (lot 2) : fiche d'information remise,
              puis signature, puis paiement de la prime et envoi. Le parcours « Souscrire une
              assurance » les enchaîne ; signé ou envoyé d'ici, le serveur le refuserait.
            -->
            @if (can('requestSignature') || can('sign') || can('submit')) {
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="busy() !== null"
                (click)="finaliseInsurance()"
              >
                <tas-icon iconName="feather:shield" style="font-size:13px"></tas-icon>
                Poursuivre la souscription
              </button>
            }
          } @else {
            @if (can('requestSignature')) {
              <button
                tas-outlined-button
                color="primary"
                type="button"
                [isLoading]="busy() === 'requestSignature'"
                [disabled]="busy() !== null"
                (click)="requestSignature()"
              >
                <tas-icon iconName="feather:edit-3" style="font-size:13px"></tas-icon>
                Demander la signature
              </button>
            }

            @if (can('sign') && !signing()) {
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="busy() !== null"
                (click)="signing.set(true)"
              >
                <tas-icon iconName="feather:pen-tool" style="font-size:13px"></tas-icon>
                Signer électroniquement
              </button>
            }

            @if (can('submit')) {
              <button
                tas-raised-button
                color="primary"
                type="button"
                [isLoading]="busy() === 'submit'"
                [disabled]="busy() !== null"
                (click)="submitToBackOffice()"
              >
                <tas-icon iconName="feather:send" style="font-size:13px"></tas-icon>
                Envoyer au back-office
              </button>
            }
          }

          @if (can('returnToDraft')) {
            <button
              tas-raised-button
              color="primary"
              type="button"
              [isLoading]="busy() === 'returnToDraft'"
              [disabled]="busy() !== null"
              (click)="returnToDraft()"
            >
              <tas-icon iconName="feather:rotate-ccw" style="font-size:13px"></tas-icon>
              Corriger et renvoyer
            </button>
          }

          @if (can('close') && !closing()) {
            <button
              tas-text-button
              color="warn"
              type="button"
              [disabled]="busy() !== null"
              (click)="closing.set(true)"
            >
              Clôturer le produit
            </button>
          }
        </div>

        @if (signing()) {
          <form [formRoot]="signatureForm" class="mt-3 flex flex-col gap-3 rounded-lg bg-slate-50 p-3">
            <tas-form-field>
              <tas-label>
                Référence de signature <span class="text-functional-error">*</span>
              </tas-label>
              <input tasInput type="text" [formField]="signatureForm.signatureReference" />
              <tas-hint>Identifiant du bordereau ou de la signature électronique.</tas-hint>
              @if (
                signatureForm.signatureReference().touched() &&
                signatureForm.signatureReference().invalid()
              ) {
                <tas-error>{{ signatureForm.signatureReference().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-date-picker mode="date" [formField]="signatureForm.signedAt">Date de signature</tas-date-picker>

            <div class="flex items-center justify-end gap-2">
              <button tas-outlined-button color="primary" type="button" (click)="signing.set(false)">
                Annuler
              </button>
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="signatureForm().invalid() || signatureForm().submitting()"
                [isLoading]="signatureForm().submitting()"
                (click)="confirmSignature()"
              >
                Enregistrer la signature
              </button>
            </div>
          </form>
        }

        @if (closing()) {
          <form [formRoot]="closeForm" class="mt-3 flex flex-col gap-3 rounded-lg bg-slate-50 p-3">
            <tas-form-field>
              <tas-label>Motif de clôture <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" [formField]="closeForm.reason" />
              @if (closeForm.reason().touched() && closeForm.reason().invalid()) {
                <tas-error>{{ closeForm.reason().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
            <div class="flex items-center justify-end gap-2">
              <button tas-outlined-button color="primary" type="button" (click)="closing.set(false)">
                Annuler
              </button>
              <button
                tas-raised-button
                color="warn"
                type="button"
                [disabled]="closeForm().invalid() || closeForm().submitting()"
                [isLoading]="closeForm().submitting()"
                (click)="confirmClose()"
              >
                Clôturer
              </button>
            </div>
          </form>
        }
      }
    </div>
  `,
})
export class HoldingSignatureActions {
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _router = inject(Router);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly holding = input.required<HoldingDto>();
  /** Vrai quand la fiche est en lecture seule ou le produit importé du back-office. */
  public readonly readOnly = input(false);

  /** Émis après toute écriture réussie : l'appelant recharge le produit et la liste. */
  public readonly changed = output<void>();
  /**
   * Émis avant de quitter la fiche pour la page de souscription : le panneau qui porte ces actions
   * se ferme, sinon il restait ouvert par-dessus la page d'arrivée.
   */
  public readonly leaving = output<void>();

  public readonly busy = signal<HoldingAction | null>(null);
  public readonly signing = signal(false);
  public readonly closing = signal(false);
  public readonly errorMessage = signal<string | null>(null);

  public readonly statusLabel = computed(() => holdingStatusLabel(this.holding().status, this.holding().signedAt));

  /** Un produit d'assurance : son envoi passe par le paiement de la prime et le consentement. */
  public readonly isInsurance = computed(() =>
    ['Insurance', 'HealthInsurance', 'ForecastInsurance'].includes(this.holding().productCategory ?? ''),
  );
  public readonly statusSeverity = computed<Severity>(() =>
    holdingStatusSeverity(this.holding().status, this.holding().signedAt),
  );

  public signatureModel = signal(SignatureFormModel.instantiate());
  public signatureForm = form(this.signatureModel, (schema) => {
    required(schema.signatureReference, {
      message: 'La référence de signature est obligatoire',
    });
  });

  public closeModel = signal(CloseFormModel.instantiate());
  public closeForm = form(this.closeModel, (schema) => {
    required(schema.reason, { message: 'Le motif de clôture est obligatoire' });
  });

  public can(action: HoldingAction): boolean {
    if (this.readOnly()) return false;
    return isHoldingActionAvailable(this.holding(), action);
  }

  public requestSignature(): void {
    this._run('requestSignature', 'Impossible de demander la signature.', () =>
      this._holdingsApi.requestHoldingSignature(this.holding().holdingId ?? ''),
    );
  }

  public finaliseInsurance(): void {
    const holding = this.holding();
    this.leaving.emit();
    this._router.navigate(['/customers', holding.clientId, 'souscrire-assurance'], {
      queryParams: { holding: holding.holdingId },
    });
  }

  public submitToBackOffice(): void {
    this._run('submit', "Impossible d'envoyer ce produit au back-office.", () =>
      this._holdingsApi.submitHolding(this.holding().holdingId ?? ''),
    );
  }

  public returnToDraft(): void {
    this._confirm.confirm({
      title: 'Corriger et renvoyer ?',
      message:
        'Le produit repasse en brouillon : vous pourrez corriger les termes et la clause, puis le renvoyer au back-office.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Corriger', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._run('returnToDraft', 'Impossible de remettre ce produit en brouillon.', () =>
          this._holdingsApi.returnHoldingToDraft(this.holding().holdingId ?? ''),
        );
      },
    });
  }

  public confirmSignature(): void {
    this.errorMessage.set(null);
    submit(this.signatureForm, async (field) => {
      const value = field().value();
      const result = await firstValueFrom(
        this._holdingsApi
          .signHolding(this.holding().holdingId ?? '', {
            signatureReference: value.signatureReference.trim(),
            signedAt: this._toInstant(value.signedAt),
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              const message = holdingErrorMessage(error, "Impossible d'enregistrer la signature.");
              this.errorMessage.set(message);
              this._snackbar.error('Erreur', message);
              return EMPTY;
            }),
          ),
      );

      if (result !== undefined) {
        this.signing.set(false);
        this._snackbar.success('Signature enregistrée', 'Le produit peut être envoyé au back-office.');
        this.changed.emit();
      }
    });
  }

  public confirmClose(): void {
    this.errorMessage.set(null);
    submit(this.closeForm, async (field) => {
      const value = field().value();
      const result = await firstValueFrom(
        this._holdingsApi
          .closeHolding(this.holding().holdingId ?? '', { reason: value.reason.trim() })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              const message = holdingErrorMessage(error, 'Impossible de clôturer ce produit.');
              this.errorMessage.set(message);
              this._snackbar.error('Erreur', message);
              return EMPTY;
            }),
          ),
      );

      if (result !== undefined) {
        this.closing.set(false);
        this._snackbar.success('Produit clôturé', 'Le motif de clôture a été enregistré.');
        this.changed.emit();
      }
    });
  }

  private _run(action: HoldingAction, fallback: string, call: () => Observable<unknown>): void {
    this.errorMessage.set(null);
    this.busy.set(action);
    call()
      .pipe(
        catchError((error: HttpErrorResponse) => {
          const message = holdingErrorMessage(error, fallback);
          this.errorMessage.set(message);
          this._snackbar.error('Erreur', message);
          return EMPTY;
        }),
      )
      .subscribe({
        next: () => {
          this.busy.set(null);
          this._snackbar.success('Enregistré', 'Le statut du produit a été mis à jour.');
          this.changed.emit();
        },
        error: () => this.busy.set(null),
        complete: () => this.busy.set(null),
      });
  }

  /**
   * Midi local plutôt que minuit : une date saisie le 1er et convertie en UTC depuis
   * un fuseau à l'est reculerait d'un jour, et la frise afficherait la veille.
   */
  private _toInstant(day: string): string | null {
    if (!day) return null;
    const date = new Date(`${day}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}

/** Une version de clause, reconstruite à partir des désignations renvoyées. */
export type ClauseVersionRow = {
  id: string;
  version: number;
  count: number;
  validFrom: string | null;
  validTo: string | null;
  isCurrent: boolean;
};

/** Ligne de désignation prête pour `tas-table`. */
export type DesignationRow = {
  id: string;
  roleLabel: string;
  subjectLabel: string;
  relationship: string | null;
  rank: number;
  share: string;
  statusLabel: string;
  statusSeverity: Severity;
  toReview: boolean;
  statusReason: string | null;
};

export interface HoldingDetailDrawerData {
  holdingId: string;
  clientId: string;
}

class SpecificsFormModel {
  public insuredCapital!: string;
  public premium!: string;
  public periodicity!: string;
  public durationMonths!: string;
  public annualRatePercent!: string;
  public initialDeposit!: string;
  public currency!: string;
  public effectiveFrom!: string;
  public notes!: string;

  public static fromHolding(holding: HoldingDto): SpecificsFormModel {
    const model = new SpecificsFormModel();
    const s = holding.specifics ?? {};
    model.insuredCapital = s.insuredCapital != null ? String(s.insuredCapital) : '';
    model.premium = s.premium != null ? String(s.premium) : '';
    model.periodicity = s.periodicity ?? '';
    model.durationMonths = s.durationMonths != null ? String(s.durationMonths) : '';
    model.annualRatePercent = s.annualRatePercent != null ? String(s.annualRatePercent) : '';
    model.initialDeposit = s.initialDeposit != null ? String(s.initialDeposit) : '';
    model.currency = s.currency || institutionCurrency();
    model.effectiveFrom = s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : '';
    model.notes = s.notes ?? '';
    return model;
  }
}

/**
 * Détail d'un produit détenu : frise de suivi, termes, clause en vigueur, versions
 * précédentes et actions (BNF-F-12).
 *
 * Deux règles de ce drawer méritent d'être dites :
 *
 * - **Les versions de clause sont dérivées, pas lues.** Le contrat n'expose aucun
 *   endpoint d'historique de clause : `GetHolding` renvoie les désignations avec leur
 *   `clauseVersion`, `validFrom` et `validTo`. Les versions précédentes ne sont donc
 *   consultables que dans la mesure où le serveur renvoie les désignations fermées.
 * - **Le suivi « temps réel » est borné.** On n'interroge le serveur que lorsque le
 *   produit est en synchronisation, toutes les dix secondes, trois minutes au plus, et
 *   le minuteur meurt avec le drawer. Un polling permanent sur une fiche ouverte toute
 *   la journée, c'est un appel toutes les dix secondes pour rien.
 */
@Component({
  selector: 'holding-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './holding-detail-drawer.html',
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasAlert,
    Button,
    TasIcon,
    TasInput,
    TasDatePicker,
    TasFormField,
    TasLabel,
    TasSpinner,
    TasTable,
    TasTag,
    HoldingTimeline,
    HoldingSignatureActions,
    DesignationsEditor,
    TasSelect,
  ],
})
export class HoldingDetailDrawer implements OnInit, OnDestroy {
  public readonly data: HoldingDetailDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _clientStore = inject(ClientDetailStore);

  private readonly _editor = viewChild(DesignationsEditor);

  public readonly holding = signal<HoldingDto | null>(null);
  public readonly product = signal<ProductDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly mode = signal<'view' | 'designations' | 'specifics'>('view');
  public readonly savingDesignations = signal(false);
  public readonly savingSpecifics = signal(false);
  public readonly selectedVersion = signal<number | null>(null);
  public readonly designationError = signal<string | null>(null);
  /** Vrai dès qu'une écriture a abouti : la liste de l'onglet doit se recharger. */
  private readonly _dirty = signal(false);

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollTicks = 0;

  public readonly tableConfig: TableConfig = {
    property: 'entity',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 30] },
  };

  public readonly periodicityOptions = HOLDING_PERIODICITY_OPTIONS;
  public readonly periodicityLabel = holdingPeriodicityLabel;
  public readonly statusLabel = computed(() => holdingStatusLabel(this.holding()?.status, this.holding()?.signedAt));
  public readonly statusSeverity = computed<Severity>(() =>
    holdingStatusSeverity(this.holding()?.status, this.holding()?.signedAt),
  );
  public readonly categoryLabel = computed(() =>
    productCategoryLabel(this.holding()?.productCategory),
  );
  public readonly originLabel = computed(() => holdingOriginLabel(this.holding()?.origin));
  public readonly isReadOnly = computed(
    () => isHoldingReadOnly(this.holding()) || this._clientStore.isReadOnly(),
  );
  public readonly productLabel = computed(() => {
    const product = this.product();
    const holding = this.holding();
    return product?.name?.trim() || holding?.productCode?.trim() || 'Produit';
  });
  public readonly policyRoles = computed(
    () => this.product()?.beneficiaryPolicy?.allowedRoles ?? [],
  );

  public readonly isAmendment = computed(() => this.holding()?.status === 'Active');

  public readonly canDesignate = computed(
    () => !this.isReadOnly() && isHoldingActionAvailable(this.holding(), 'designate'),
  );
  public readonly canEditSpecifics = computed(
    () => !this.isReadOnly() && isHoldingActionAvailable(this.holding(), 'specifics'),
  );

  private readonly _designations = computed(() => this.holding()?.designations ?? []);

  /** Clause en vigueur : les désignations encore ouvertes. */
  public readonly currentDesignations = computed(() =>
    this._designations().filter((designation) => designation.validTo == null),
  );

  public readonly versions = computed<ClauseVersionRow[]>(() => {
    const current = this.holding()?.clauseVersion ?? 0;
    const grouped = new Map<number, DesignationDto[]>();
    for (const designation of this._designations()) {
      const version = designation.clauseVersion ?? 0;
      grouped.set(version, [...(grouped.get(version) ?? []), designation]);
    }
    return [...grouped.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([version, items]) => {
        const starts = items
          .map((item) => item.validFrom)
          .filter((value): value is string => !!value)
          .sort();
        const ends = items
          .map((item) => item.validTo)
          .filter((value): value is string => !!value)
          .sort();
        return {
          id: `v${version}`,
          version,
          count: items.length,
          validFrom: starts[0] ?? null,
          // Une version n'est close que si toutes ses désignations le sont.
          validTo: ends.length === items.length ? (ends[ends.length - 1] ?? null) : null,
          isCurrent: version === current,
        };
      });
  });

  public readonly visibleVersion = computed(
    () => this.selectedVersion() ?? this.holding()?.clauseVersion ?? 0,
  );

  public readonly visibleDesignations = computed<DesignationRow[]>(() => {
    const version = this.visibleVersion();
    return this._designations()
      .filter((designation) => (designation.clauseVersion ?? 0) === version)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((designation, index) => ({
        id: designation.designationId ?? `${version}-${index}`,
        roleLabel: this._roleLabel(designation.roleCode),
        subjectLabel: designation.subjectLabel?.trim() || 'Personne désignée',
        relationship: designation.externalRelationship ?? null,
        rank: designation.rank ?? 1,
        share: designation.sharePercent != null ? `${designation.sharePercent} %` : '—',
        statusLabel: designationStatusLabel(designation.status),
        statusSeverity: designationStatusSeverity(designation.status),
        toReview: isDesignationToReview(designation.status),
        statusReason: designation.statusReason ?? null,
      }));
  });

  public readonly toReviewCount = computed(
    () => this.currentDesignations().filter((d) => isDesignationToReview(d.status)).length,
  );

  public specificsModel = signal(SpecificsFormModel.fromHolding({}));
  public specificsForm = form(this.specificsModel);

  public ngOnInit(): void {
    this._load(true);
  }

  public ngOnDestroy(): void {
    this._stopPolling();
  }

  public close(): void {
    this._dialogRef.close(this._dirty());
  }

  public selectVersion(version: number): void {
    this.selectedVersion.set(version);
  }

  public startDesignations(): void {
    this.designationError.set(null);
    this.mode.set('designations');
  }

  public startSpecifics(): void {
    const holding = this.holding();
    if (!holding) return;
    this.specificsModel.set(SpecificsFormModel.fromHolding(holding));
    this.mode.set('specifics');
  }

  public cancelEdition(): void {
    this.mode.set('view');
  }

  /** Enregistre la clause : nouvelle version — un avenant — si le produit est actif. */
  public saveDesignations(): void {
    const holding = this.holding();
    const draft = this._editor()?.draft();
    if (!holding || !draft) return;

    if (!draft.isValid) {
      this.designationError.set(
        'Corrigez les points signalés sous la clause avant de l\'enregistrer.',
      );
      return;
    }

    this.designationError.set(null);
    this.savingDesignations.set(true);
    this._holdingsApi
      .setHoldingDesignations(holding.holdingId ?? '', { designations: draft.designations })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          const message = holdingErrorMessage(error, "Impossible d'enregistrer la clause.");
          this.designationError.set(message);
          this._snackbar.error('Erreur', message);
          this.savingDesignations.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.savingDesignations.set(false);
        this._snackbar.success(
          result?.isAmendment ? 'Avenant enregistré' : 'Clause enregistrée',
          result?.isAmendment
            ? `La clause passe en version ${result.clauseVersion}. La version précédente reste consultable.`
            : `${result?.designationCount ?? 0} désignation(s) enregistrée(s).`,
        );
        this.mode.set('view');
        this.selectedVersion.set(null);
        this._dirty.set(true);
        // Un 200 ne prouve pas que la clause imbriquée est enregistrée : on relit.
        this._load(false);
      });
  }

  public saveSpecifics(): void {
    const holding = this.holding();
    if (!holding) return;

    this.savingSpecifics.set(true);
    submit(this.specificsForm, async (field) => {
      const value = field().value();
      const result = await firstValueFrom(
        this._holdingsApi
          .updateHoldingSpecifics(holding.holdingId ?? '', {
            insuredCapital: this._toNumber(value.insuredCapital),
            premium: this._toNumber(value.premium),
            periodicity: value.periodicity.trim() || null,
            durationMonths: this._toInt(value.durationMonths),
            annualRatePercent: this._toNumber(value.annualRatePercent),
            initialDeposit: this._toNumber(value.initialDeposit),
            currency: value.currency || institutionCurrency(),
            effectiveFrom: value.effectiveFrom || null,
            notes: value.notes.trim() || null,
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              const message = holdingErrorMessage(error, 'Impossible d\'enregistrer les termes.');
              this._snackbar.error('Erreur', message);
              this.savingSpecifics.set(false);
              return EMPTY;
            }),
          ),
      );

      this.savingSpecifics.set(false);
      if (result !== undefined) {
        this._snackbar.success('Termes enregistrés', 'Les termes du produit ont été mis à jour.');
        this.mode.set('view');
        this._dirty.set(true);
        this._load(false);
      }
    });
  }

  public onActionChanged(): void {
    this._dirty.set(true);
    this._load(false);
  }

  public formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  public formatAmount(value: number | null | undefined, currency: string | null | undefined): string {
    if (value == null) return '—';
    return `${value.toLocaleString('fr-FR')} ${currency ?? ''}`.trim();
  }

  private _roleLabel(code: string | null | undefined): string {
    const role = this.policyRoles().find((r) => r.code === code);
    return role?.label?.trim() || designationRoleLabel(code);
  }

  private _load(initial: boolean): void {
    if (initial) {
      this.isLoading.set(true);
      this.loadFailed.set(false);
    }
    this._holdingsApi
      .getHolding(this.data.holdingId)
      .pipe(
        catchError(() => {
          if (initial) this.loadFailed.set(true);
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((holding) => {
        this.holding.set(holding);
        this.isLoading.set(false);
        if (initial && holding.productLineId) this._loadProduct(holding.productLineId);
        this._syncPolling(holding);
      });
  }

  private _loadProduct(productLineId: string): void {
    this._productsApi
      .getProduct(productLineId)
      .pipe(catchError(() => EMPTY))
      .subscribe((product) => this.product.set(product));
  }

  private _syncPolling(holding: HoldingDto): void {
    if (holding.status === 'PendingSync') {
      this._startPolling();
    } else {
      this._stopPolling();
    }
  }

  private _startPolling(): void {
    if (this._pollTimer) return;
    this._pollTicks = 0;
    this._pollTimer = setInterval(() => {
      this._pollTicks += 1;
      if (this._pollTicks > SYNC_POLL_MAX_TICKS) {
        this._stopPolling();
        return;
      }
      this._holdingsApi
        .getHolding(this.data.holdingId)
        .pipe(catchError(() => EMPTY))
        .subscribe((holding) => {
          const previous = this.holding();
          if (previous?.status !== holding.status || previous?.updatedAt !== holding.updatedAt) {
            this.holding.set(holding);
            this._dirty.set(true);
          }
          this._syncPolling(holding);
        });
    }, SYNC_POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _toNumber(value: string): number | null {
    if (!value?.trim()) return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private _toInt(value: string): number | null {
    if (!value?.trim()) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
