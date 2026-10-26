import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { PermissionsService, TENANT_MODULES, TenantModulesService } from '@sankore/crm/common';
import {
  InsuranceSubscriptionDto,
  IntegrationApiService,
  RecordUnderwritingRequestOutcomeEnum,
} from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY, forkJoin, Observable, of } from 'rxjs';
import { formatAmount, formatContractDate } from '../data-access/integration-referential';
import {
  afterSaleErrorMessage,
  CLIENT_ANSWER_LABELS,
  ENDED_SUBSCRIPTION_STATUSES,
  formatInstantDate,
  INSURER_ANSWER_DAYS,
  PAYMENT_MODE_LABELS,
  subscriptionStatusMeta,
  todayIso,
  underwritingMeta,
} from './insurance-after-sale-labels';
import { SubscriptionClientAnswerDrawer, SubscriptionClientAnswerDrawerData } from './subscription-client-answer-drawer';
import { SubscriptionEvidenceDrawer, SubscriptionEvidenceDrawerData } from './subscription-evidence-drawer';
import {
  SubscriptionPremiumPaymentDrawer,
  SubscriptionPremiumPaymentDrawerData,
} from './subscription-premium-payment-drawer';
import { SubscriptionUnderwritingDrawer, SubscriptionUnderwritingDrawerData } from './subscription-underwriting-drawer';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Seuil d'alerte du compteur : il reste moins d'une semaine avant l'acceptation tacite. */
const WAITING_ALERT_DAYS = 10;

interface SubscriptionRow {
  id: string;
  dto: InsuranceSubscriptionDto;
  productLabel: string;
  statusLabel: string;
  statusSeverity: Severity;
  paymentModeLabel: string | null;
  paymentLine: string;
  paymentTone: 'ok' | 'due' | 'neutral';
  underwritingLabel: string | null;
  underwritingSeverity: Severity;
  clientAnswerLabel: string | null;
  /** Jours écoulés depuis l'envoi, tant que l'assureur n'a pas répondu ; `null` sinon. */
  daysWaiting: number | null;
  canRecordUnderwriting: boolean;
}

/**
 * Souscriptions du client, suivies après l'envoi à l'assureur : paiement de la prime, réponse
 * de l'assureur, réponse du client à une surprime ou à des exclusions, délai de 15 jours au-delà
 * duquel le silence de l'assureur vaut acceptation.
 *
 * Posé entre les contrats et les sinistres : une souscription précède le contrat qu'elle fait
 * émettre, et reste lisible après, pour son journal de preuves.
 */
@Component({
  selector: 'insurance-subscriptions-block',
  templateUrl: './insurance-subscriptions-block.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasAlert, Button, TasCard, TasIcon, TasTable, TasTag],
})
export class InsuranceSubscriptionsBlock implements OnInit {
  private readonly _moduleReadOnly = inject(TenantModulesService).readOnly(TENANT_MODULES.INSURANCE);
  private readonly _permissions = inject(PermissionsService);
  private readonly _api = inject(IntegrationApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly customerId = input.required<string>();
  /** Sur la page d'un contrat : seules les souscriptions de ce contrat. */
  public readonly holdingId = input<string | null>(null);

  public readonly canView = this._permissions.can('Ins.Policy.View');
  private readonly _canSubscribePermission = this._permissions.can('Ins.Policy.Subscribe');
  /** Module désactivé : consultation seule, les écritures se masquent (le serveur les refuserait). */
  public readonly canWrite = computed(() => this._canSubscribePermission() && !this._moduleReadOnly());

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly subscriptions = signal<InsuranceSubscriptionDto[]>([]);
  private readonly _productNames = signal<Map<string, string>>(new Map());
  public readonly busyId = signal<string | null>(null);

  public readonly waitingAlertDays = WAITING_ALERT_DAYS;
  public readonly answerDays = INSURER_ANSWER_DAYS;

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25, 50] },
  });

  public readonly rows = computed<SubscriptionRow[]>(() => {
    const names = this._productNames();
    const now = Date.now();
    const holdingId = this.holdingId();
    return this.subscriptions()
      .filter((dto) => !holdingId || dto.holdingId === holdingId)
      .map((dto) => toRow(dto, names, now));
  });

  public readonly awaitingActionCount = computed(
    () =>
      this.rows().filter(
        (row) =>
          row.dto.silenceMayBeConfirmed ||
          row.dto.awaitsClientAnswer ||
          row.dto.owesRefund ||
          (row.daysWaiting !== null && row.daysWaiting >= WAITING_ALERT_DAYS),
      ).length,
  );

  public ngOnInit(): void {
    if (this.canView()) this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    forkJoin({
      subscriptions: this._api.listInsuranceSubscriptions(this.customerId()),
      // Le nom du produit ne vient qu'avec les polices du client : une lecture qui échoue
      // laisse simplement un libellé générique, sans masquer les souscriptions.
      policies: this._api.listInsurancePolicies(this.customerId()).pipe(catchError(() => of([]))),
    })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadError.set(afterSaleErrorMessage(err, "Les souscriptions n'ont pas pu être lues."));
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ subscriptions, policies }) => {
        const names = new Map<string, string>();
        for (const policy of policies ?? []) {
          if (policy.productId && policy.productName) names.set(policy.productId, policy.productName);
        }
        this._productNames.set(names);
        this.subscriptions.set(subscriptions ?? []);
        this.isLoading.set(false);
      });
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public premiumLabel(row: SubscriptionRow): string {
    return formatAmount(row.dto.premiumAmount, row.dto.currency);
  }

  public surchargeLabel(row: SubscriptionRow): string {
    return formatAmount(row.dto.surchargeAmount, row.dto.currency);
  }

  public openUnderwriting(row: SubscriptionRow): void {
    this._afterWrite(
      this._sideDrawer.open(SubscriptionUnderwritingDrawer, {
        data: { subscription: row.dto, productLabel: row.productLabel } satisfies SubscriptionUnderwritingDrawerData,
      }).closed,
    );
  }

  public openClientAnswer(row: SubscriptionRow): void {
    this._afterWrite(
      this._sideDrawer.open(SubscriptionClientAnswerDrawer, {
        data: { subscription: row.dto, productLabel: row.productLabel } satisfies SubscriptionClientAnswerDrawerData,
      }).closed,
    );
  }

  public openPayment(row: SubscriptionRow): void {
    this._afterWrite(
      this._sideDrawer.open(SubscriptionPremiumPaymentDrawer, {
        data: { subscription: row.dto, productLabel: row.productLabel } satisfies SubscriptionPremiumPaymentDrawerData,
      }).closed,
    );
  }

  public openEvidence(row: SubscriptionRow): void {
    if (!row.dto.holdingId) return;
    this._sideDrawer.open(SubscriptionEvidenceDrawer, {
      data: { holdingId: row.dto.holdingId, productLabel: row.productLabel } satisfies SubscriptionEvidenceDrawerData,
    });
  }

  public confirmSilence(row: SubscriptionRow): void {
    this._confirm.confirm({
      title: "Confirmer l'acceptation tacite ?",
      message:
        `L'assureur n'a pas répondu dans les ${INSURER_ANSWER_DAYS} jours suivant l'envoi : son silence vaut ` +
        "acceptation. L'acceptation est enregistrée à la date du jour, avec la référence « Silence de l'assureur ».",
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Confirmer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._recordSilence(row),
    });
  }

  private _recordSilence(row: SubscriptionRow): void {
    this.busyId.set(row.id);
    this._api
      .recordInsuranceUnderwriting(row.id, {
        outcome: RecordUnderwritingRequestOutcomeEnum.DeemedAcceptedBySilence,
        reference: "Silence de l'assureur",
        receivedOn: todayIso(),
      })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Acceptation non enregistrée',
            afterSaleErrorMessage(err, "L'acceptation tacite n'a pas pu être enregistrée."),
          );
          this.busyId.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.busyId.set(null);
        this._snackbar.success('Acceptation tacite enregistrée', "Le silence de l'assureur est au dossier.");
        this.load();
      });
  }

  private _afterWrite(closed: Observable<unknown>): void {
    closed.subscribe((written) => {
      if (written) this.load();
    });
  }
}

function toRow(dto: InsuranceSubscriptionDto, names: Map<string, string>, now: number): SubscriptionRow {
  const status = subscriptionStatusMeta(dto.status);
  const ended = ENDED_SUBSCRIPTION_STATUSES.includes(dto.status ?? '');
  const underwriting = dto.underwriting ? underwritingMeta(dto.underwriting) : null;

  // Le compteur ne court que tant que l'assureur n'a rien dit : des examens demandés ne sont
  // pas une réponse, le serveur admet encore l'acceptation tacite dans ce cas.
  const insurerSilent =
    !dto.underwriting || dto.underwriting === RecordUnderwritingRequestOutcomeEnum.MedicalExamsRequired;
  const waiting = !!dto.sentToInsurerAt && insurerSilent && !ended && dto.status !== 'Issued';
  const daysWaiting = waiting ? Math.max(0, Math.floor((now - Date.parse(dto.sentToInsurerAt!)) / DAY_MS)) : null;

  let paymentLine: string;
  let paymentTone: SubscriptionRow['paymentTone'];
  if (dto.premiumPaidAt) {
    paymentLine = `Prime encaissée le ${formatInstantDate(dto.premiumPaidAt)}`;
    paymentTone = 'ok';
  } else if (dto.paymentMode === 'DeferredByDerogation' && dto.paymentDueBy) {
    paymentLine = `À payer avant le ${formatContractDate(dto.paymentDueBy)}`;
    paymentTone = 'due';
  } else if (dto.premiumOutstanding) {
    paymentLine = 'En attente de paiement';
    paymentTone = 'due';
  } else {
    paymentLine = ended ? 'Aucune prime encaissée' : 'En attente de paiement';
    paymentTone = 'neutral';
  }

  return {
    id: dto.id ?? '',
    dto,
    productLabel: (dto.productId && names.get(dto.productId)) || 'Assurance',
    statusLabel: status.label,
    statusSeverity: status.severity,
    paymentModeLabel: dto.paymentMode ? (PAYMENT_MODE_LABELS[dto.paymentMode] ?? dto.paymentMode) : null,
    paymentLine,
    paymentTone,
    underwritingLabel: underwriting?.label ?? null,
    underwritingSeverity: underwriting?.severity ?? 'neutral',
    clientAnswerLabel: dto.clientAnswer ? (CLIENT_ANSWER_LABELS[dto.clientAnswer] ?? dto.clientAnswer) : null,
    daysWaiting,
    canRecordUnderwriting: waiting,
  };
}
