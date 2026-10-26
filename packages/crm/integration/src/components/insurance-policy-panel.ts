import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField, FormRoot, form, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { PermissionsService, TENANT_MODULES, TenantModulesService } from '@sankore/crm/common';
import {
  ClientsApiService,
  InsurancePolicyDto,
  IntegrationApiService,
  MarkDocumentSentRequestChannelEnum,
  MoveOperationRequestStatusEnum,
  PolicyDocumentDto,
  PolicyOperationDto,
  RequestOperationRequestKindEnum,
} from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { formatAmount, formatContractDate, policyStatusMeta } from '../data-access/integration-referential';
import { IntegrationFacadeService, integrationErrorMessage } from '../data-access/integration-facade.service';
import { DeclareClaimDrawer, DeclareClaimDrawerData } from './declare-claim-drawer';
import {
  afterSaleErrorMessage,
  DOCUMENT_CHANNEL_LABELS,
  DOCUMENT_CHANNEL_OPTIONS,
  formatInstantDate,
  OPERATION_KIND_LABELS,
  OPERATION_KIND_OPTIONS,
  OPERATION_NEXT_STEPS,
  OperationStep,
  operationStatusMeta,
  parseAmount,
  POLICY_DOCUMENT_KIND_LABELS,
  POLICY_DOCUMENT_KIND_OPTIONS,
  POLICY_DOCUMENT_MAX_SIZE_MB,
  REFUND_BLOCKED_KYC_MESSAGE,
} from './insurance-after-sale-labels';
import { PolicyOperationStatusDrawer, PolicyOperationStatusDrawerData } from './policy-operation-status-drawer';


interface OperationRow {
  id: string;
  op: PolicyOperationDto;
  kindLabel: string;
  statusLabel: string;
  statusSeverity: Severity;
  nextSteps: OperationStep[];
}

interface DocumentRow {
  id: string;
  doc: PolicyDocumentDto;
  kindLabel: string;
  sentLabel: string | null;
}

const KINDS = RequestOperationRequestKindEnum;

class RequestOperationFormModel {
  public kind!: string;
  public amount!: string;
  public payoutInstrumentId!: string;
  public reason!: string;

  public static instantiate(): RequestOperationFormModel {
    const m = new RequestOperationFormModel();
    m.kind = '';
    m.amount = '';
    m.payoutInstrumentId = '';
    m.reason = '';
    return m;
  }
}

class UploadDocumentFormModel {
  public kind!: string;
  public title!: string;
  public file!: File | null;

  public static instantiate(): UploadDocumentFormModel {
    const m = new UploadDocumentFormModel();
    m.kind = '';
    m.title = '';
    m.file = null;
    return m;
  }
}

/**
 * La police d'un contrat d'assurance, sur la page du contrat : attestation, déclaration de
 * sinistre, demandes du client sur la police (renonciation, rachat, avance) et documents de
 * l'assureur (conditions, attestation, avenants, information annuelle). C'était un tiroir ouvert
 * depuis la liste des polices, devenu un bloc de la page du contrat (2026-10-26).
 *
 * L'information annuelle (art. 75) est produite par l'assureur ; l'institution la relaie et
 * consigne sa remise au client, comme pour les autres documents.
 */
@Component({
  selector: 'insurance-policy-panel',
  templateUrl: './insurance-policy-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasAlert,
    Button,
    TasFileUploader,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasIcon,
    TasInput,
    TasSelect,
    TasTable,
    TasTag,
    Menu,
    MenuItem,
    TasMenuTrigger,
  ],
})
export class InsurancePolicyPanel implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _api = inject(IntegrationApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _moduleReadOnly = inject(TenantModulesService).readOnly(TENANT_MODULES.INSURANCE);
  private readonly _canSubscribePermission = inject(PermissionsService).can('Ins.Policy.Subscribe');

  /** La police telle que la liste du client la donne. */
  public readonly policyInput = input.required<InsurancePolicyDto>({ alias: 'policy' });
  /** Le client du contrat : ses moyens de paiement sont ceux où l'assureur peut verser. */
  public readonly customerId = input.required<string>();
  /** Un sinistre vient d'être déclaré : la page recharge la liste des sinistres du contrat. */
  public readonly claimDeclared = output<void>();

  // Lus une fois les entrées posées (ngOnInit précède le premier rendu) : la page recrée le
  // bloc quand elle change de contrat.
  public policy!: InsurancePolicyDto;
  private _policyId = '';
  public statusMeta!: { label: string; severity: Severity };
  public premiumLabel = '';

  private readonly _canDeclareClaimPermission = inject(PermissionsService).can('Ins.Claim.Declare');
  /** Ni attestation ni sinistre tant que la prime est due : le contrat n'est pas en vigueur. */
  public readonly canDeclareClaim = computed(
    () => this._canDeclareClaimPermission() && !this._moduleReadOnly() && !this.policyInput().premiumOutstanding,
  );
  public readonly isDownloading = signal(false);

  /** Toutes les écritures de l'après-vente relèvent du droit de souscrire. */
  public readonly canWrite = computed(() => this._canSubscribePermission() && !this._moduleReadOnly());

  public readonly KINDS = KINDS;
  public readonly operationKindOptions = OPERATION_KIND_OPTIONS;
  public readonly documentKindOptions = POLICY_DOCUMENT_KIND_OPTIONS;
  public readonly channelOptions = DOCUMENT_CHANNEL_OPTIONS;
  public readonly maxSizeMb = POLICY_DOCUMENT_MAX_SIZE_MB;
  public readonly refundBlockedMessage = REFUND_BLOCKED_KYC_MESSAGE;

  // ——— Demandes ———

  public readonly operationsLoading = signal(true);
  public readonly operationsError = signal<string | null>(null);
  public readonly operations = signal<PolicyOperationDto[]>([]);
  public readonly showRequestForm = signal(false);
  public readonly cancellingId = signal<string | null>(null);

  public readonly operationRows = computed<OperationRow[]>(() =>
    this.operations().map((op) => {
      const meta = operationStatusMeta(op.status);
      return {
        id: op.id ?? '',
        op,
        kindLabel: OPERATION_KIND_LABELS[op.kind ?? ''] ?? op.kind ?? '—',
        statusLabel: meta.label,
        statusSeverity: meta.severity,
        nextSteps: OPERATION_NEXT_STEPS[op.status ?? ''] ?? [],
      };
    }),
  );

  public readonly requestModel = signal(RequestOperationFormModel.instantiate());
  public readonly requestForm = form(this.requestModel, (schema) => {
    required(schema.kind, { message: 'Choisissez le type de demande' });
    validate(schema.amount, (ctx) => {
      const raw = ctx.value();
      const isAdvance = ctx.valueOf(schema.kind) === KINDS.Advance;
      if (!raw) {
        return isAdvance ? { kind: 'required', message: "Le montant de l'avance est obligatoire" } : null;
      }
      const amount = parseAmount(raw);
      return amount !== null && amount > 0 ? null : { kind: 'amount', message: 'Indiquez un montant positif' };
    });
  });
  public readonly requestKind = computed(() => this.requestForm.kind().value());

  /**
   * Les moyens de paiement du client (lot 4) : le serveur vérifie que celui choisi est actif et
   * appartient au titulaire. Le formulaire ne l'envoyait jamais, faute de champ.
   */
  private readonly _instruments = signal<{ id: string; label: string; active: boolean }[]>([]);
  public readonly payoutOptions = computed(() =>
    this._instruments()
      .filter((i) => i.active)
      .map((i) => ({ value: i.id, label: i.label })),
  );

  // ——— Documents ———

  public readonly documentsLoading = signal(true);
  public readonly documentsError = signal<string | null>(null);
  public readonly documents = signal<PolicyDocumentDto[]>([]);
  public readonly showUploadForm = signal(false);
  public readonly openingId = signal<string | null>(null);
  public readonly markingId = signal<string | null>(null);

  public readonly documentRows = computed<DocumentRow[]>(() =>
    this.documents().map((doc) => ({
      id: doc.id ?? '',
      doc,
      kindLabel: POLICY_DOCUMENT_KIND_LABELS[doc.kind ?? ''] ?? doc.kind ?? '—',
      sentLabel: doc.sentToClientAt
        ? `Remis le ${formatInstantDate(doc.sentToClientAt)}${
            doc.sentChannel ? ` — ${(DOCUMENT_CHANNEL_LABELS[doc.sentChannel] ?? doc.sentChannel).toLowerCase()}` : ''
          }`
        : null,
    })),
  );

  public readonly uploadModel = signal(UploadDocumentFormModel.instantiate());
  public readonly uploadForm = form(this.uploadModel, (schema) => {
    required(schema.kind, { message: 'Choisissez le type de document' });
    validate(schema.file, ({ value }) => {
      const file = value();
      if (!file) return { kind: 'required', message: 'Choisissez le fichier PDF' };
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      return isPdf ? null : { kind: 'pdf', message: 'Le document doit être un PDF' };
    });
  });

  public ngOnInit(): void {
    this.policy = this.policyInput();
    this._policyId = this.policy.id ?? '';
    this.statusMeta = policyStatusMeta(this.policy.status);
    this.premiumLabel = formatAmount(this.policy.premiumAmount, this.policy.currency);
    this.loadOperations();
    this.loadDocuments();
    this._loadInstruments();
  }

  /** Le moyen de versement d'une demande, tel qu'il est affiché sur la fiche (masqué). */
  public payoutLabel(op: PolicyOperationDto): string | null {
    if (!op.payoutInstrumentId) return null;
    return this._instruments().find((i) => i.id === op.payoutInstrumentId)?.label ?? 'Moyen de paiement retiré';
  }

  private _loadInstruments(): void {
    this._clientsApi
      .listClientPaymentInstruments(this.customerId())
      .pipe(catchError(() => EMPTY))
      .subscribe((rows) =>
        this._instruments.set(
          (rows ?? []).map((i) => ({
            id: i.id ?? '',
            label: `${i.provider ?? ''} ${i.maskedIdentifier ?? ''}`.trim(),
            active: i.isActive === true,
          })),
        ),
      );
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public formatInstant(value: string | null | undefined): string {
    return formatInstantDate(value);
  }

  public amountLabel(op: PolicyOperationDto): string {
    return formatAmount(op.amount, op.currency ?? this.policy.currency);
  }

  // ——— Demandes ———

  public loadOperations(): void {
    this.operationsLoading.set(true);
    this.operationsError.set(null);
    this._api
      .listInsurancePolicyOperations(this._policyId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.operationsError.set(afterSaleErrorMessage(err, "Les demandes sur ce contrat n'ont pas pu être lues."));
          this.operationsLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((rows) => {
        this.operations.set(rows ?? []);
        this.operationsLoading.set(false);
      });
  }

  public toggleRequestForm(): void {
    this.requestModel.set(RequestOperationFormModel.instantiate());
    this.requestForm().reset();
    this.showRequestForm.update((shown) => !shown);
  }

  public submitRequest(): void {
    submit(this.requestForm, async (field) => {
      const value = field().value();
      try {
        await firstValueFrom(
          this._api.requestInsurancePolicyOperation(this._policyId, {
            kind: value.kind as RequestOperationRequestKindEnum,
            amount: parseAmount(value.amount),
            payoutInstrumentId: value.payoutInstrumentId || null,
            reason: value.reason.trim() || null,
          }),
        );
      } catch (error) {
        this._snackbar.error(
          'Demande non enregistrée',
          afterSaleErrorMessage(error as HttpErrorResponse, "La demande n'a pas pu être enregistrée."),
        );
        return;
      }

      this._snackbar.success('Demande enregistrée', 'Elle est horodatée à réception ; transmettez-la à l’assureur.');
      this.showRequestForm.set(false);
      this.requestModel.set(RequestOperationFormModel.instantiate());
      this.loadOperations();
    });
  }

  public moveOperation(row: OperationRow, step: OperationStep): void {
    if (step.status === MoveOperationRequestStatusEnum.Cancelled) {
      this._confirm.confirm({
        title: 'Annuler cette demande ?',
        message: `La demande de ${row.kindLabel.toLowerCase()} est annulée avant d'être transmise à l'assureur.`,
        closable: true,
        showCancelButton: true,
        acceptButtonProps: { label: 'Annuler la demande', theme: 'warn' },
        rejectButtonProps: { label: 'Retour' },
        accept: () => this._cancelOperation(row),
      });
      return;
    }

    this._sideDrawer
      .open(PolicyOperationStatusDrawer, {
        data: { operation: row.op, target: step.status } satisfies PolicyOperationStatusDrawerData,
      })
      .closed.subscribe((written) => {
        if (written) this.loadOperations();
      });
  }

  private _cancelOperation(row: OperationRow): void {
    this.cancellingId.set(row.id);
    this._api
      .updateInsurancePolicyOperationStatus(row.id, { status: MoveOperationRequestStatusEnum.Cancelled })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Annulation impossible', afterSaleErrorMessage(err, "La demande n'a pas pu être annulée."));
          this.cancellingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.cancellingId.set(null);
        this._snackbar.success('Demande annulée', `${row.kindLabel} annulée.`);
        this.loadOperations();
      });
  }

  // ——— Documents ———

  public loadDocuments(): void {
    this.documentsLoading.set(true);
    this.documentsError.set(null);
    this._api
      .listInsurancePolicyDocuments(this._policyId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.documentsError.set(afterSaleErrorMessage(err, "Les documents de ce contrat n'ont pas pu être lus."));
          this.documentsLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((rows) => {
        this.documents.set(rows ?? []);
        this.documentsLoading.set(false);
      });
  }

  public toggleUploadForm(): void {
    this.uploadModel.set(UploadDocumentFormModel.instantiate());
    this.uploadForm().reset();
    this.showUploadForm.update((shown) => !shown);
  }

  public submitUpload(): void {
    submit(this.uploadForm, async (field) => {
      const value = field().value();
      if (!value.file) return;
      try {
        await firstValueFrom(
          this._api.uploadInsurancePolicyDocument(
            this._policyId,
            value.kind,
            value.file,
            value.title.trim() || undefined,
          ),
        );
      } catch (error) {
        this._snackbar.error(
          'Document non déposé',
          afterSaleErrorMessage(error as HttpErrorResponse, "Le document n'a pas pu être déposé."),
        );
        return;
      }

      this._snackbar.success('Document déposé', 'Pensez à consigner sa remise au client.');
      this.showUploadForm.set(false);
      this.uploadModel.set(UploadDocumentFormModel.instantiate());
      this.loadDocuments();
    });
  }

  public openDocument(row: DocumentRow): void {
    this.openingId.set(row.id);
    this._api
      .getInsurancePolicyDocumentContent(row.id)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Document indisponible', afterSaleErrorMessage(err, "Le document n'a pas pu être ouvert."));
          this.openingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe((content) => {
        // Le client généré type la réponse PDF en `object` alors qu'il la reçoit en blob ; une
        // URL d'objet parce que la route exige le jeton porteur (un lien direct ouvrirait un 401).
        const blob = content as unknown as Blob;
        const url = URL.createObjectURL(blob);
        const opened = window.open(url, '_blank');
        if (!opened) {
          const link = document.createElement('a');
          link.href = url;
          link.download = row.doc.fileName || 'document.pdf';
          link.click();
        }
        // Laissé le temps à l'onglet de lire le fichier avant de libérer l'URL.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        this.openingId.set(null);
      });
  }

  public markSent(row: DocumentRow, channel: MarkDocumentSentRequestChannelEnum): void {
    this.markingId.set(row.id);
    this._api
      .markInsurancePolicyDocumentSent(row.id, { channel })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Remise non enregistrée', afterSaleErrorMessage(err, "La remise n'a pas pu être enregistrée."));
          this.markingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.markingId.set(null);
        this._snackbar.success('Remise enregistrée', `« ${row.doc.title || row.kindLabel} » est noté comme remis au client.`);
        this.loadDocuments();
      });
  }

  public downloadCertificate(): void {
    this.isDownloading.set(true);
    this._facade
      .getPolicyCertificate(this._policyId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Attestation indisponible',
            err.status === 502
              ? "L'assureur n'a pas pu produire l'attestation. Réessayez plus tard ou demandez-la par votre canal habituel."
              : integrationErrorMessage(err, "L'attestation n'a pas pu être téléchargée."),
          );
          this.isDownloading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `attestation-${this.policy.policyNumber || this._policyId}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        this.isDownloading.set(false);
      });
  }

  public declareClaim(): void {
    this._sideDrawer
      .open<boolean, DeclareClaimDrawerData, DeclareClaimDrawer>(DeclareClaimDrawer, {
        data: { policyId: this._policyId, productName: this.policy.productName ?? '' },
      })
      .closed.subscribe((declared) => {
        if (declared) this.claimDeclared.emit();
      });
  }
}
