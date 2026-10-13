import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  ComplianceSettingsApiService,
  ComplianceSettingsResponse,
  ProductDto,
  ProductsApiService,
  SetKycRemotePolicyRequest,
} from '@sankore/crm-api';

/**
 * Modes de validation. Le contrat les déclare en `string | null` (M12 ne peut pas
 * référencer l'enum de M02), mais la liste est fermée côté serveur et un code
 * inconnu est refusé — on la fixe donc ici plutôt que de laisser une saisie libre.
 */
const VALIDATION_MODES = [
  { value: 'Manual', label: 'Manuelle — un agent décide' },
  { value: 'Automatic', label: 'Automatique — le système valide un dossier propre' },
];

/**
 * Niveaux KYC. Même raison : chaînes au contrat, liste fermée au serveur. Le
 * plafond du tenant (`kycAutoApprovalMaxTier`) se compare à ces mêmes valeurs,
 * dans cet ordre — Simplifié permet moins que Complet.
 */
const TIERS = [
  { value: '', label: 'Aucun niveau imposé' },
  { value: 'Simplified', label: 'Simplifié' },
  { value: 'Full', label: 'Complet' },
];

const TIER_ORDER = ['Simplified', 'Full'];

/** `KycDocumentType` de M02, par nom. */
const DOCUMENT_TYPES = [
  { value: 'Cni', label: "Carte nationale d'identité" },
  { value: 'Passport', label: 'Passeport' },
  { value: 'Cedeao', label: 'Carte CEDEAO' },
  { value: 'Consulaire', label: 'Carte consulaire' },
];

/**
 * `KycDocumentKind` de M02, limité à ce qu'un produit peut EXIGER en plus.
 *
 * Le recto de la pièce et le selfie n'y figurent pas volontairement : ils sont ce
 * qu'est un dépôt à distance, et une ligne qui les omettrait ne collecterait rien.
 * Le verso dépend du type de pièce, pas du produit (un passeport n'en a pas).
 */
const REQUIRED_DOCUMENTS = [
  {
    value: 'ProofOfAddress',
    label: 'Justificatif de domicile',
    hint: 'Exigé par CIMA art. 13.6 pour une vente à distance en assurance.',
  },
];

class KycRemotePolicyFormModel {
  public enabled!: boolean;
  public validationMode!: string;
  public requiredTier!: string;
  /** Chaînes : les `input` rendent du texte, la conversion se fait à la soumission. */
  public minAutoScore!: string;
  public linkValidityHours!: string;
  public allowedDocumentTypes!: string[];
  public requiredDocuments!: string[];

  public static fromProduct(
    product: ProductDto | null | undefined,
  ): KycRemotePolicyFormModel {
    const policy = product?.kycRemotePolicy;
    const model = new KycRemotePolicyFormModel();
    model.enabled = policy?.enabled ?? false;
    model.validationMode = policy?.validationMode ?? 'Manual';
    model.requiredTier = policy?.requiredTier ?? '';
    model.minAutoScore = String(policy?.minAutoScore ?? 85);
    model.linkValidityHours = String(policy?.linkValidityHours ?? 72);
    model.allowedDocumentTypes = (policy?.allowedDocumentTypes ?? []).filter(
      (c): c is string => !!c,
    );
    model.requiredDocuments = (policy?.requiredDocuments ?? []).filter(
      (c): c is string => !!c,
    );
    return model;
  }
}

function integerBetween(min: number, max: number, message: string) {
  return (ctx: { value: () => string }) => {
    const raw = (ctx.value() ?? '').trim();
    const parsed = Number(raw);
    return raw && Number.isInteger(parsed) && parsed >= min && parsed <= max
      ? undefined
      : { kind: 'range', message };
  };
}

@Component({
  selector: 'kyc-remote-policy-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasCard,
    Button,
    TasIcon,
    TasTag,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    TasMultiSelect,
    TasSelect,
    TasSpinner,
  ],
  templateUrl: './kyc-remote-policy-editor.html',
})
export class KycRemotePolicyEditor {
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _complianceApi = inject(ComplianceSettingsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly product = input<ProductDto | null>(null);
  public readonly canUpdate = input(false);
  /** Le parent recharge le produit : un 204 ne dit pas ce que le serveur a retenu. */
  public readonly saved = output<void>();

  public readonly validationModes = VALIDATION_MODES;
  public readonly tiers = TIERS;
  public readonly documentTypes = DOCUMENT_TYPES;
  public readonly requiredDocumentOptions = REQUIRED_DOCUMENTS;

  public readonly model = signal(KycRemotePolicyFormModel.fromProduct(null));

  public readonly formSchema = form(this.model, (schema) => {
    validate(
      schema.minAutoScore,
      integerBetween(50, 100, 'Indiquez un score entre 50 et 100'),
    );
    validate(
      schema.linkValidityHours,
      integerBetween(1, 336, 'Indiquez une durée entre 1 et 336 heures (14 jours)'),
    );
  });

  /** Paramètres de conformité du tenant : ils décident si « Automatique » est ouvert. */
  public readonly compliance = signal<ComplianceSettingsResponse | null>(null);
  public readonly complianceLoading = signal(false);
  public readonly complianceFailed = signal(false);

  public readonly enabled = computed(() => this.formSchema.enabled().value());
  public readonly selectedMode = computed(() => this.formSchema.validationMode().value());
  public readonly selectedTier = computed(() => this.formSchema.requiredTier().value());
  public readonly selectedDocumentTypes = computed(() =>
    this.formSchema.allowedDocumentTypes().value(),
  );

  public readonly autoApprovalAllowedByTenant = computed(
    () => this.compliance()?.kycAutoApprovalEnabled === true,
  );

  public readonly tenantMaxTier = computed(
    () => this.compliance()?.kycAutoApprovalMaxTier ?? 'Simplified',
  );

  /**
   * Le niveau exigé dépasse-t-il le plafond du tenant ? Même ordre que le serveur
   * (`KycRemotePolicyValues.TierWithinCeiling`) : une ligne sans niveau propre n'est
   * jamais mesurée contre le plafond, c'est l'affaire du plafond lui-même.
   */
  public readonly tierAboveCeiling = computed(() => {
    const tier = this.selectedTier();
    if (!tier) return false;
    const ceiling = this.tenantMaxTier();
    const tierIndex = TIER_ORDER.indexOf(tier);
    const ceilingIndex = TIER_ORDER.indexOf(ceiling);
    // Un plafond illisible ferme la porte, comme côté serveur : un contrôle de
    // conformité répond non quand il ne sait pas.
    if (tierIndex < 0 || ceilingIndex < 0) return true;
    return tierIndex > ceilingIndex;
  });

  public readonly automaticBlockedReason = computed(() => {
    if (this.complianceFailed()) {
      return "Les paramètres de conformité n'ont pas pu être lus : la validation automatique reste fermée.";
    }
    if (!this.autoApprovalAllowedByTenant()) {
      return "Votre institution n'autorise pas la validation automatique. Le responsable conformité peut l'activer dans Paramètres › Conformité.";
    }
    if (this.tierAboveCeiling()) {
      return `Le niveau exigé dépasse le plafond accordé sans intervention humaine (${this.tierLabel(this.tenantMaxTier())}).`;
    }
    return null;
  });

  public readonly automaticAvailable = computed(
    () => this.automaticBlockedReason() === null,
  );

  public readonly isAutomatic = computed(() => this.selectedMode() === 'Automatic');

  /**
   * Une ligne activée doit accepter au moins une pièce, sinon le client arrive sur
   * la page publique sans rien à choisir. Le serveur le refuse aussi — on le dit
   * avant l'aller-retour.
   */
  public readonly missingDocumentTypes = computed(
    () => this.enabled() && this.selectedDocumentTypes().length === 0,
  );

  public readonly canSave = computed(
    () =>
      this.canUpdate() &&
      !this.formSchema().invalid() &&
      !this.formSchema().submitting() &&
      !this.missingDocumentTypes(),
  );

  private readonly _typesSelect = viewChild(TasMultiSelect);
  private _typesSeeded = false;

  constructor() {
    effect(() => {
      const product = this.product();
      if (!product) return;
      this.model.set(KycRemotePolicyFormModel.fromProduct(product));
      this._typesSeeded = false;
    });

    // Le multi-select du design system ne synchronise pas son `selectionModel`
    // depuis `writeValue` : sans cette amorce, une sélection chargée depuis l'API
    // n'apparaîtrait pas cochée, et le premier clic écraserait les types déjà
    // enregistrés. Même correctif que dans l'éditeur de politique bénéficiaires.
    effect(() => {
      const select = this._typesSelect();
      if (!select || this._typesSeeded) return;
      this._typesSeeded = true;
      const selected = this.selectedDocumentTypes();
      const toSelect = DOCUMENT_TYPES.filter((o) => selected.includes(o.value));
      select.selectionModel.clear(true);
      if (toSelect.length > 0) select.selectionModel.select(...toSelect);
    });

    // Repli si le tenant retire l'autorisation pendant que l'écran est ouvert, ou
    // si l'administrateur monte le niveau exigé au-dessus du plafond : le mode
    // revient à Manuel plutôt que de laisser un formulaire que le serveur refusera.
    effect(() => {
      if (this.isAutomatic() && !this.automaticAvailable()) {
        this.formSchema.validationMode().value.set('Manual');
      }
    });

    this._loadCompliance();
  }

  public tierLabel(code: string | null | undefined): string {
    return TIERS.find((t) => t.value === (code ?? ''))?.label ?? (code ?? '—');
  }

  public documentTypeLabel(code: string): string {
    return DOCUMENT_TYPES.find((t) => t.value === code)?.label ?? code;
  }

  public setAllowedDocumentTypes(codes: string[] | null | undefined): void {
    this.formSchema.allowedDocumentTypes().value.set(codes ?? []);
  }

  public isRequiredDocument(code: string): boolean {
    return this.formSchema.requiredDocuments().value().includes(code);
  }

  public toggleRequiredDocument(code: string): void {
    const field = this.formSchema.requiredDocuments();
    const current = field.value();
    field.value.set(
      current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code],
    );
  }

  public reloadCompliance(): void {
    this._loadCompliance();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const productId = this.product()?.id;
      if (!productId) return;

      const payload: SetKycRemotePolicyRequest = {
        enabled: value.enabled,
        validationMode: value.validationMode,
        requiredTier: value.requiredTier || null,
        minAutoScore: Number(value.minAutoScore),
        requiredDocuments: value.requiredDocuments,
        allowedDocumentTypes: value.allowedDocumentTypes,
        linkValidityHours: Number(value.linkValidityHours),
      };

      const result = await firstValueFrom(
        this._productsApi
          .setProductKycRemotePolicy(productId, payload, 'response')
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Erreur', remotePolicyErrorMessage(error));
              return EMPTY;
            }),
          ),
      );

      if (result) {
        this._snackbar.success(
          'Enregistré',
          'Politique KYC à distance mise à jour.',
        );
        // L'écriture est composée (activation, mode, pièces) : le 204 ne dit pas ce
        // que le serveur a retenu, on recharge le produit.
        this.saved.emit();
      }
    });
  }

  private _loadCompliance(): void {
    this.complianceLoading.set(true);
    this.complianceFailed.set(false);
    this._complianceApi
      .getComplianceSettings()
      .pipe(
        catchError(() => {
          this.complianceFailed.set(true);
          this.complianceLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((settings) => {
        this.compliance.set(settings);
        this.complianceLoading.set(false);
      });
  }
}

/**
 * Les codes du serveur traduits. Ils arrivent dans `error` plutôt que dans
 * `errors` : le value object répond par un code nu, le validateur FluentValidation
 * par des erreurs par champ — on gère les deux formes.
 */
const POLICY_ERROR_MESSAGES: Record<string, string> = {
  KYC_REMOTE_AUTO_APPROVAL_DISABLED:
    "Votre institution n'autorise pas la validation automatique.",
  KYC_REMOTE_TIER_ABOVE_AUTO_LIMIT:
    'Le niveau exigé dépasse le plafond accordé sans intervention humaine.',
  KYC_REMOTE_DOCUMENT_TYPES_REQUIRED:
    "Choisissez au moins une pièce d'identité acceptée.",
  KYC_REMOTE_MIN_SCORE_INVALID: 'Le score minimal doit être entre 50 et 100.',
  KYC_REMOTE_LINK_VALIDITY_INVALID:
    'La durée de validité du lien doit être entre 1 et 336 heures.',
  KYC_REMOTE_VALIDATION_MODE_INVALID: 'Mode de validation inconnu.',
  KYC_REMOTE_TIER_INVALID: 'Niveau KYC inconnu.',
  PRODUCT_NOT_FOUND: "Ce produit n'existe plus.",
};

function remotePolicyErrorMessage(error: HttpErrorResponse): string {
  const body = error.error ?? {};

  const code = typeof body.error === 'string' ? body.error : null;
  if (code) {
    // Les codes « valeur invalide » portent la valeur fautive après deux-points.
    const [head, offending] = code.split(':');
    const known = POLICY_ERROR_MESSAGES[head];
    if (known) return known;
    if (head === 'KYC_REMOTE_DOCUMENT_KIND_INVALID') {
      return `Document exigé inconnu : ${offending}.`;
    }
    if (head === 'KYC_REMOTE_DOCUMENT_TYPE_INVALID') {
      return `Pièce acceptée inconnue : ${offending}.`;
    }
    return code;
  }

  const errors = body.errors as Record<string, string[]> | undefined;
  if (errors) {
    const first = Object.values(errors)[0]?.[0];
    if (first) return first;
  }
  if (typeof body.title === 'string' && body.title) return body.title;
  if (error.status === 403) {
    return "Vous n'avez pas le droit de modifier ce produit.";
  }
  return "Impossible d'enregistrer la politique KYC à distance.";
}
