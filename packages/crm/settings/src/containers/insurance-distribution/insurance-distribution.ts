import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { disabled, form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import {
  DistributorDocumentDto,
  InsuranceDistributionApiService,
  InsuranceDistributorDto,
  UpdateInsuranceDistributorRequestStatusEnum,
} from '@sankore/crm-api';
import {
  BreadcrumbService,
  currencyUnit,
  PermissionsService,
  TENANT_MODULES,
  TenantModulesService,
  TenantProvider,
} from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { AddDistributorDocumentDrawer, AddDistributorDocumentDrawerData } from './add-distributor-document-drawer';
import {
  DEROGATION_SMIG_FACTOR,
  DISTRIBUTOR_KIND_META,
  DISTRIBUTOR_STATUS_OPTIONS,
  distributorErrorMessage,
  distributorKindLabel,
  distributorStatusLabel,
  DistributorKind,
  EXPIRY_WARNING_DAYS,
  expiryMeta,
  requiredKindsFor,
} from './insurance-distribution.models';

class DistributorProfileFormModel {
  public status!: string;
  public registrationNumber!: string;
  public legalMention!: string;
  /** En texte comme les autres montants saisis : la conversion se fait à l'enregistrement. */
  public annualSmig!: string;

  public static fromDto(dto: InsuranceDistributorDto | null): DistributorProfileFormModel {
    const m = new DistributorProfileFormModel();
    m.status = dto?.status ?? '';
    m.registrationNumber = dto?.registrationNumber ?? '';
    m.legalMention = dto?.legalMention ?? '';
    m.annualSmig = dto?.annualSmig != null ? String(dto.annualSmig) : '';
    return m;
  }
}

/** « 1 234 567,5 » ou « 1234567.5 » → 1234567.5 ; vide → null ; illisible → NaN. */
function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s  ]/g, '').replace(',', '.');
  if (!cleaned) return null;
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
}

export type RequiredPieceState = 'present' | 'expiring' | 'expired' | 'missing';

export interface RequiredPiece {
  kind: DistributorKind;
  label: string;
  state: RequiredPieceState;
  document: DistributorDocumentDto | null;
}

/**
 * « Distribution d'assurance » : l'institution en tant que DISTRIBUTEUR — son statut, la mention
 * légale de ses documents, le SMIG d'où se calcule la dérogation de paiement à 60 jours, et les
 * pièces qui l'autorisent à distribuer. Tant qu'une pièce exigée manque ou est échue, le serveur
 * refuse les nouvelles souscriptions ; l'écran le dit en tête plutôt que de le laisser découvrir
 * au guichet.
 *
 * Lecture pour tout utilisateur connecté ; l'écriture exige `admin:compliance:manage`.
 */
@Component({
  templateUrl: './insurance-distribution.html',
  imports: [
    FormRoot, FormField, TasCard, TasFormField, TasLabel, TasError, TasHint, TasSuffix, TasInput, TasSelect,
    TasIcon, TasTag, TasTable, TasSpinner, Button,
  ],
})
export class InsuranceDistributionPage implements OnInit {
  private readonly _api = inject(InsuranceDistributionApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _tenantModules = inject(TenantModulesService);
  private readonly _tenant = inject(TenantProvider);

  private readonly _canManage = this._permissions.can('admin:compliance:manage');
  /** Module « Assurance » désactivé : l'écran reste consultable, plus modifiable. */
  public readonly moduleReadOnly = this._tenantModules.readOnly(TENANT_MODULES.INSURANCE);
  public readonly canEdit = computed(() => this._canManage() && !this.moduleReadOnly());

  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly profile = signal<InsuranceDistributorDto | null>(null);
  public readonly downloadingId = signal<string | null>(null);

  public readonly statusOptions = DISTRIBUTOR_STATUS_OPTIONS;
  public readonly kindLabel = distributorKindLabel;
  public readonly expiry = expiryMeta;
  public readonly currency = computed(() => currencyUnit(this._tenant.currency()));

  public readonly tableConfig: TableConfig = {
    property: 'insurance-distributor-documents',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20, 50] },
  };

  public readonly model = signal(DistributorProfileFormModel.fromDto(null));
  public readonly formSchema = form(this.model, (schema) => {
    disabled(schema.status, { when: () => !this.canEdit() });
    disabled(schema.registrationNumber, { when: () => !this.canEdit() });
    disabled(schema.legalMention, { when: () => !this.canEdit() });
    disabled(schema.annualSmig, { when: () => !this.canEdit() });
    required(schema.status, { message: 'Choisissez le statut de l’institution' });
    validate(schema.legalMention, (ctx) =>
      ctx.valueOf(schema.status) === 'Broker' && !ctx.value().trim()
        ? { kind: 'required', message: 'Obligatoire pour un courtier (art. 540)' }
        : null);
    validate(schema.annualSmig, (ctx) => {
      const amount = parseAmount(ctx.value());
      if (amount === null) return null;
      return Number.isNaN(amount) || amount <= 0
        ? { kind: 'min', message: 'Saisissez un montant supérieur à zéro, ou laissez vide' }
        : null;
    });
  });

  public readonly isBroker = computed(() => this.formSchema.status().value() === 'Broker');

  /** Suit la saisie : l'agent voit le seuil changer avant d'enregistrer. */
  public readonly derogationThreshold = computed(() => {
    const amount = parseAmount(this.formSchema.annualSmig().value());
    return amount && !Number.isNaN(amount) ? amount * DEROGATION_SMIG_FACTOR : null;
  });

  /** Pièces en vigueur d'abord, puis les plus récentes ; les remplacées restent visibles en bas. */
  public readonly documents = computed(() =>
    [...(this.profile()?.documents ?? [])].sort((a, b) =>
      Number(!!b.isCurrent) - Number(!!a.isCurrent) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
  );

  public readonly currentKinds = computed(() =>
    this.documents().filter((d) => d.isCurrent).map((d) => d.kind as DistributorKind));

  /** Le statut choisi dans le formulaire, enregistré ou non : la liste suit la saisie. */
  public readonly requiredPieces = computed<RequiredPiece[]>(() => {
    const current = this.documents().filter((d) => d.isCurrent);
    return requiredKindsFor(this.formSchema.status().value()).map((kind) => {
      const document = current.find((d) => d.kind === kind) ?? null;
      let state: RequiredPieceState = 'present';
      if (!document) state = 'missing';
      else if (document.daysLeft != null && document.daysLeft < 0) state = 'expired';
      else if (document.daysLeft != null && document.daysLeft <= EXPIRY_WARNING_DAYS) state = 'expiring';
      return { kind, label: DISTRIBUTOR_KIND_META[kind].label, state, document };
    });
  });

  public readonly statusChangedUnsaved = computed(
    () => (this.profile()?.status ?? '') !== this.formSchema.status().value(),
  );

  /** Ce qui bloque, selon le SERVEUR (statut enregistré) — c'est lui qui refuse les souscriptions. */
  public readonly blockers = computed(() => {
    const p = this.profile();
    const missing = (p?.missingDocuments ?? []).map((k) => {
      const meta = DISTRIBUTOR_KIND_META[k as DistributorKind];
      return meta ? `${meta.label} ${meta.missing}` : `${k} manquant`;
    });
    const expired = (p?.expiredDocuments ?? []).map((k) => {
      const meta = DISTRIBUTOR_KIND_META[k as DistributorKind];
      return meta ? `${meta.label} ${meta.expired}` : `${k} échu`;
    });
    return [...missing, ...expired];
  });

  /** Pièces exigées encore valides mais proches de l'échéance : à renouveler avant le blocage. */
  public readonly expiringSoon = computed(() => {
    const required = new Set(this.profile()?.requiredDocuments ?? []);
    return this.documents().filter((d) =>
      d.isCurrent && required.has(d.kind ?? '') && d.daysLeft != null && d.daysLeft >= 0 && d.daysLeft <= EXPIRY_WARNING_DAYS);
  });

  public readonly savedStatusLabel = computed(() => distributorStatusLabel(this.profile()?.status));

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Distribution d’assurance' },
    ]);
    this._load();
  }

  public reload(): void {
    this._load();
  }

  /**
   * Dates sans heure (`DateOnly` côté serveur) : découpées à la main, parce que `DatePipe` les lit
   * comme minuit UTC et peut afficher la veille selon le fuseau du poste.
   */
  public day(iso: string | null | undefined): string {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return d && m && y ? `${d}/${m}/${y}` : iso;
  }

  public formatAmount(value: number | null | undefined): string {
    return value == null ? '—' : `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${this.currency()}`;
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const saved = await firstValueFrom(
        this._api.updateInsuranceDistributor({
          status: value.status as UpdateInsuranceDistributorRequestStatusEnum,
          registrationNumber: value.registrationNumber.trim() || null,
          legalMention: value.legalMention.trim() || null,
          annualSmig: parseAmount(value.annualSmig),
        }).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Profil non enregistré', distributorErrorMessage(err.error?.error, 'Le profil n’a pas pu être enregistré.'));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!saved) return;
      this._snackbar.success('Profil enregistré', 'Le statut de distributeur a été mis à jour.');
      // Recharger : la situation (pièces exigées, manquantes, seuil) dépend du statut enregistré.
      this._load();
    });
  }

  public addDocument(kind?: DistributorKind): void {
    const ref = this._sideDrawer.open<boolean, AddDistributorDocumentDrawerData, AddDistributorDocumentDrawer>(
      AddDistributorDocumentDrawer,
      {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { kind, currentKinds: this.currentKinds() },
      },
    );
    ref.closed.subscribe((added) => {
      if (added) this._load();
    });
  }

  /** Le client généré type la réponse `object` ; c'est bien un `Blob` qui arrive (`application/octet-stream`). */
  public download(doc: DistributorDocumentDto): void {
    if (!doc.id) return;
    this.downloadingId.set(doc.id);
    this._api.getInsuranceDistributorDocumentContent(doc.id).pipe(
      catchError(() => {
        this.downloadingId.set(null);
        this._snackbar.error('Téléchargement impossible', 'Le fichier n’a pas pu être lu.');
        return EMPTY;
      }),
    ).subscribe((body) => {
      const url = URL.createObjectURL(body as unknown as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.fileName ?? `${distributorKindLabel(doc.kind)}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.downloadingId.set(null);
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api.getInsuranceDistributor().pipe(
      catchError(() => {
        this.isLoading.set(false);
        this.loadFailed.set(true);
        this._snackbar.error('Erreur', 'Impossible de charger le profil de distributeur.');
        return EMPTY;
      }),
    ).subscribe((dto) => {
      this.profile.set(dto);
      this.model.set(DistributorProfileFormModel.fromDto(dto));
      this.loadFailed.set(false);
      this.isLoading.set(false);
    });
  }
}

export default InsuranceDistributionPage;
