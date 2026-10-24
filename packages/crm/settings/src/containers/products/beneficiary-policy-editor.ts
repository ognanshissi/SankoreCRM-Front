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
import {
  form,
  FormField,
  FormRoot,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  DesignationRoleInput,
  ProductDto,
  ProductsApiService,
  SetBeneficiaryPolicyRequest,
} from '@sankore/crm-api';
import { designationRoleLabel, productCategoryLabel } from '@sankore/crm/common';

/**
 * Rôles de désignation proposés. `DesignationRoleInput.code` est une chaîne
 * libre au contrat (aucun enum, aucun endpoint de référentiel) : la liste
 * fermée vient donc du référentiel du socle, dont `designationRoleLabel`
 * porte déjà les libellés français. Un code renvoyé par l'API et absent de
 * cette liste est ajouté aux options au chargement, pour ne jamais le perdre
 * en enregistrant.
 */
const DESIGNATION_ROLE_CODES = [
  'Subscriber',
  'Insured',
  'CoInsured',
  'CoHolder',
  'PrimaryBeneficiary',
  'ContingentBeneficiary',
  'Beneficiary',
  'Guarantor',
  'LegalRepresentative',
];

/**
 * Codes de `requiredFieldsBeforeConversion` : exactement le catalogue fermé du serveur
 * (`PersonFieldCode`, Kernel), qui REFUSE tout code inconnu à l'enregistrement de la politique.
 *
 * L'écran proposait auparavant des codes de son invention (`LastName`, `AddressLine`,
 * `HealthConsent`, `KycTier`…) : aucun n'existait côté serveur, si bien que cocher une case faisait
 * échouer l'enregistrement (`BENEFICIARY_POLICY_UNKNOWN_REQUIRED_FIELD`). Le niveau KYC a son propre
 * champ plus bas, FATCA dépend du réglage de conformité de l'établissement, et le consentement santé
 * est exigé par les questionnaires qui en ont besoin : aucun des trois n'est un champ requis.
 * L'administrateur ne voit jamais le code, seulement le libellé.
 */
const REQUIRED_FIELD_GROUPS: {
  title: string;
  fields: { code: string; label: string }[];
}[] = [
  {
    title: 'Identité',
    fields: [
      { code: 'LAST_NAME', label: 'Nom' },
      { code: 'FIRST_NAME', label: 'Prénom' },
      { code: 'USAGE_NAME', label: "Nom d'usage" },
      { code: 'BIRTH_DATE', label: 'Date de naissance' },
      { code: 'GENDER', label: 'Sexe' },
      { code: 'ADDRESS', label: 'Adresse' },
      { code: 'POSTAL_CODE', label: 'Boîte postale' },
      { code: 'CITY', label: 'Ville' },
      { code: 'COUNTRY', label: 'Pays' },
    ],
  },
  {
    title: 'Contact et demande',
    fields: [
      { code: 'PHONE', label: 'Téléphone' },
      { code: 'EMAIL', label: 'E-mail' },
      { code: 'NATIONAL_ID', label: "Pièce d'identité" },
      { code: 'DESIRED_AMOUNT', label: 'Montant demandé' },
    ],
  },
  {
    title: 'Conformité',
    fields: [{ code: 'PEP_STATUS', label: 'Statut PPE déclaré' }],
  },
  {
    // Un consentement requis bloque la conversion tant que le prospect ne l'a pas donné ; l'onglet
    // Consentements du lead le marque « Obligatoire ».
    title: 'Consentements',
    fields: [
      { code: 'CONSENT_DATA_PROCESSING', label: 'Traitement des données personnelles' },
      { code: 'CONSENT_CREDIT_BUREAU', label: "Consultation du Bureau d'Information sur le Crédit" },
      { code: 'CONSENT_THIRD_PARTY_SHARING', label: 'Partage avec un partenaire (assureur)' },
    ],
  },
];

const KNOWN_REQUIRED_FIELD_CODES = REQUIRED_FIELD_GROUPS.flatMap((g) =>
  g.fields.map((f) => f.code),
);

/**
 * Systèmes cibles. `integrationSystem` est une chaîne libre sur
 * `SetBeneficiaryPolicyRequest`, mais le contrat énumère les connecteurs
 * disponibles (`ConnectionListDto.kind`) : on s'appuie sur ces valeurs plutôt
 * que sur une saisie libre, qui produirait des codes jamais reconnus.
 */
const INTEGRATION_SYSTEM_OPTIONS = [
  { value: 'Temenos', label: 'Temenos' },
  { value: 'Amplitude', label: 'Amplitude' },
  { value: 'Sab', label: 'SAB' },
  { value: 'PerfectVision', label: 'PerfectVision' },
  { value: 'Orass', label: 'Orass' },
];

class BeneficiaryPolicyFormModel {
  public allowMultipleHoldings!: boolean;
  /** Chaînes : les `input` rendent du texte, la conversion se fait à la soumission. */
  public maxChildren!: string;
  public childMaxAge!: string;
  public requiredKycTier!: string;
  public integrationSystem!: string;
  public allowedRoles!: string[];
  public requiredFields!: string[];

  public static fromProduct(
    product: ProductDto | null | undefined,
  ): BeneficiaryPolicyFormModel {
    const policy = product?.beneficiaryPolicy;
    const model = new BeneficiaryPolicyFormModel();
    // `allowMultipleHoldings` est porté par le produit en lecture et par la
    // requête de politique en écriture : on lit donc le produit.
    model.allowMultipleHoldings = product?.allowMultipleHoldings ?? false;
    model.maxChildren =
      policy?.maxChildren === null || policy?.maxChildren === undefined
        ? ''
        : String(policy.maxChildren);
    model.childMaxAge =
      policy?.childMaxAge === null || policy?.childMaxAge === undefined
        ? ''
        : String(policy.childMaxAge);
    model.requiredKycTier = policy?.requiredKycTier ?? '';
    model.integrationSystem = policy?.integrationSystem ?? '';
    model.allowedRoles = (policy?.allowedRoles ?? [])
      .map((r) => r.code)
      .filter((c): c is string => !!c);
    model.requiredFields = (policy?.requiredFieldsBeforeConversion ?? []).filter(
      (c): c is string => !!c,
    );
    return model;
  }
}

function positiveIntegerValidator(max: number, message: string) {
  return (ctx: { value: () => string }) => {
    const raw = (ctx.value() ?? '').trim();
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= max
      ? undefined
      : { kind: 'range', message };
  };
}

@Component({
  selector: 'beneficiary-policy-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormRoot,
    FormField,
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
  ],
  template: `
    <!-- ——— Politique bénéficiaires et foyer (BNF-F-14) ——— -->
    <!--
      Pas de carte ici : le volet d'onglet qui accueille ce composant porte la carte et son
      espacement. Avant les onglets, chaque éditeur portait la sienne — ce qui donnait une carte
      dans une carte dès qu'on les groupait. Le titre reste ici, parce qu'il nomme ce que le
      bouton de cette section enregistre et non le volet.
    -->
    <div>
      <h2 class="text-xl font-bold text-primary">Politique bénéficiaires et foyer</h2>
      <p class="text-sm text-slate-600 mt-1">
        Foyer, rôles de bénéficiaires et champs exigés avant conversion pour cette ligne de
        produit.
      </p>

      <form [formRoot]="formSchema" class="flex flex-col gap-5 mt-5">
        <!-- Identification de la ligne de produit -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p class="text-xs text-slate-400 mb-1" id="policy-category-label">
              Catégorie
            </p>
            <p
              class="text-sm text-slate-800"
              aria-describedby="policy-category-label"
            >
              {{ categoryLabel() }}
            </p>
            <p class="text-[11px] text-slate-400 mt-0.5">
              La catégorie est fixée à la création du produit.
            </p>
          </div>

          <tas-form-field>
            <tas-label>Système cible</tas-label>
            <tas-select
              [options]="integrationSystemOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Aucun"
              [formField]="formSchema.integrationSystem"
            ></tas-select>
            <tas-hint>
              Back-office qui porte les contrats de cette ligne de produit.
            </tas-hint>
          </tas-form-field>
        </div>

        <!-- Foyer -->
        <fieldset class="border-t border-slate-100 pt-4">
          <legend class="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Foyer
          </legend>

          <label class="flex items-start gap-2 mt-3 cursor-pointer text-sm">
            <input
              type="checkbox"
              class="mt-0.5 accent-primary"
              [formField]="formSchema.allowMultipleHoldings"
            />
            <span>
              Autoriser plusieurs détentions par client
              <span class="block text-xs text-slate-400">
                Un même client peut détenir plusieurs contrats de ce produit.
              </span>
            </span>
          </label>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <tas-form-field>
              <tas-label>Nombre maximal d'enfants</tas-label>
              <input
                tasInput
                type="number"
                placeholder="Sans limite"
                [formField]="formSchema.maxChildren"
              />
              @if (
                formSchema.maxChildren().touched() &&
                formSchema.maxChildren().invalid()
              ) {
                <tas-error>
                  {{ formSchema.maxChildren().errors()[0].message }}
                </tas-error>
              } @else {
                <tas-hint>Laissez vide pour ne pas limiter.</tas-hint>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>Âge maximal d'un enfant</tas-label>
              <input
                tasInput
                type="number"
                placeholder="Sans limite"
                [formField]="formSchema.childMaxAge"
              />
              @if (
                formSchema.childMaxAge().touched() &&
                formSchema.childMaxAge().invalid()
              ) {
                <tas-error>
                  {{ formSchema.childMaxAge().errors()[0].message }}
                </tas-error>
              } @else {
                <tas-hint>En années révolues.</tas-hint>
              }
            </tas-form-field>
          </div>
        </fieldset>

        <!-- Rôles autorisés -->
        <fieldset class="border-t border-slate-100 pt-4">
          <legend class="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Rôles de bénéficiaires autorisés
          </legend>

          <tas-form-field class="mt-3">
            <tas-label>Rôles autorisés</tas-label>
            <tas-multi-select
              [options]="roleOptions()"
              placeholder="Sélectionnez les rôles autorisés"
              [ngModel]="selectedRoles()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="setAllowedRoles($event)"
            ></tas-multi-select>
            <tas-hint>
              Seuls ces rôles pourront être désignés sur un contrat de ce
              produit.
            </tas-hint>
          </tas-form-field>

          <!--
            Le multi-select n'affiche ses puces qu'à partir de son modèle de
            sélection interne, que writeValue ne remplit pas : une sélection
            venue du serveur serait invisible. Ce rappel garantit que
            l'administrateur voit toujours ce qui est réellement enregistré.
          -->
          <div class="flex flex-wrap gap-1.5 mt-2" aria-live="polite">
            @if (selectedRoles().length === 0) {
              <p class="text-xs text-slate-400">
                Aucun rôle autorisé : aucune désignation ne sera possible.
              </p>
            } @else {
              @for (code of selectedRoles(); track code) {
                <tas-tag severity="info">{{ roleLabel(code) }}</tas-tag>
              }
            }
          </div>
        </fieldset>

        <!-- Champs exigés avant conversion -->
        <fieldset class="border-t border-slate-100 pt-4">
          <legend class="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Champs exigés avant conversion
          </legend>
          <p class="text-xs text-slate-400 mt-1">
            Un lead ne pourra pas être converti tant que ces informations ne
            sont pas renseignées.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            @for (group of requiredFieldGroups; track group.title) {
              <div>
                <p class="text-xs font-medium text-slate-500 mb-1.5">
                  {{ group.title }}
                </p>
                <div class="flex flex-col gap-1.5">
                  @for (field of group.fields; track field.code) {
                    <label class="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        class="accent-primary"
                        [checked]="isRequiredField(field.code)"
                        (change)="toggleRequiredField(field.code)"
                      />
                      {{ field.label }}
                    </label>
                  }
                </div>
              </div>
            }
          </div>

          @if (unknownRequiredFieldCount() > 0) {
            <p class="text-xs text-slate-500 mt-3">
              {{ unknownRequiredFieldCount() }} champ(s) supplémentaire(s)
              définis côté back-office sont conservés tels quels.
            </p>
          }

          <tas-form-field class="mt-4 block max-w-xs">
            <tas-label>Niveau KYC requis</tas-label>
            <tas-select [options]="kycTierOptions()" [formField]="formSchema.requiredKycTier"></tas-select>
            <tas-hint>
              @if (isStandard()) {
                « Aucun KYC » : le client est créé actif à l'approbation du projet, sans dossier KYC.
              } @else {
                Un produit de cette catégorie exige toujours un dossier KYC.
              }
            </tas-hint>
          </tas-form-field>
        </fieldset>

        @if (canUpdate()) {
          <div class="flex justify-end border-t border-slate-100 pt-4">
            <button
              tas-raised-button
              color="primary"
              type="button"
              [disabled]="formSchema().invalid() || formSchema().submitting()"
              [isLoading]="formSchema().submitting()"
              (click)="handleSubmit()"
            >
              <tas-icon iconName="feather:save" iconSize="sm"></tas-icon>
              Enregistrer la politique
            </button>
          </div>
        }
      </form>
    </div>

  `,
})
export class BeneficiaryPolicyEditor {
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly product = input<ProductDto | null>(null);
  public readonly canUpdate = input(false);
  /** Le parent recharge le produit : un 204 ne prouve pas ce qui a été retenu. */
  public readonly saved = output<void>();

  public readonly requiredFieldGroups = REQUIRED_FIELD_GROUPS;
  public readonly integrationSystemOptions = INTEGRATION_SYSTEM_OPTIONS;
  public readonly roleLabel = designationRoleLabel;


  public readonly model = signal(BeneficiaryPolicyFormModel.fromProduct(null));

  public readonly formSchema = form(this.model, (schema) => {
    validate(
      schema.maxChildren,
      positiveIntegerValidator(30, 'Indiquez un entier entre 0 et 30'),
    );
    validate(
      schema.childMaxAge,
      positiveIntegerValidator(99, 'Indiquez un âge entre 0 et 99'),
    );
    // Les deux limites sont toujours modifiables : le foyer se saisit sur
    // n'importe quel lead et n'importe quel client, il n'y a plus de case à
    // cocher dont elles dépendraient. Avant, elles étaient grisées tant que
    // `householdEnabled` était faux — c'est-à-dire par défaut — et le serveur
    // les effaçait en plus à l'enregistrement.
  });

  public readonly roleOptions = signal<{ label: string; value: string }[]>([]);

  public readonly code = computed(() => this.product()?.code ?? null);

  public readonly isStandard = computed(() => this.product()?.category === 'Standard');

  /**
   * « Aucun KYC » n'est proposé qu'à un produit Standard : le serveur le refuse ailleurs, la
   * catégorie étant ce qu'un régulateur regarde. Une valeur déjà enregistrée hors de la liste
   * reste affichée telle quelle plutôt que d'être effacée en silence.
   */
  public readonly kycTierOptions = computed(() => {
    const options = [
      { value: '', label: 'Socle du tenant (dossier KYC standard)' },
      { value: 'Simplified', label: 'Simplifié' },
      { value: 'Full', label: 'Complet' },
    ];
    if (this.isStandard()) options.push({ value: 'None', label: 'Aucun KYC' });
    const current = this.product()?.beneficiaryPolicy?.requiredKycTier;
    if (current && !options.some((o) => o.value.toLowerCase() === current.toLowerCase())) {
      options.push({ value: current, label: current });
    }
    return options;
  });

  public readonly categoryLabel = computed(() =>
    productCategoryLabel(this.product()?.category),
  );

  public readonly selectedRoles = computed(() =>
    this.formSchema.allowedRoles().value(),
  );

  public readonly unknownRequiredFieldCount = computed(
    () =>
      this.formSchema
        .requiredFields()
        .value()
        .filter((code) => !KNOWN_REQUIRED_FIELD_CODES.includes(code)).length,
  );

  private readonly _rolesSelect = viewChild(TasMultiSelect);
  private _rolesSeeded = false;

  constructor() {
    effect(() => {
      const product = this.product();
      if (!product) return;
      this.model.set(BeneficiaryPolicyFormModel.fromProduct(product));
      this._rolesSeeded = false;
      // Un code de rôle venu du serveur et inconnu du référentiel reste
      // proposé — sinon l'enregistrement suivant le supprimerait en silence.
      const codes = new Set([
        ...DESIGNATION_ROLE_CODES,
        ...(product.beneficiaryPolicy?.allowedRoles ?? [])
          .map((r) => r.code)
          .filter((c): c is string => !!c),
      ]);
      this.roleOptions.set(
        [...codes].map((code) => ({
          value: code,
          label: designationRoleLabel(code),
        })),
      );
    });

    // Le multi-select du design system ne synchronise pas son `selectionModel`
    // depuis `writeValue` : sans cette amorce, une sélection chargée depuis
    // l'API n'apparaîtrait pas cochée, et le premier clic dans la liste
    // écraserait les rôles déjà enregistrés.
    effect(() => {
      const select = this._rolesSelect();
      const options = this.roleOptions();
      if (!select || options.length === 0 || this._rolesSeeded) return;
      this._rolesSeeded = true;
      const selected = this.selectedRoles();
      const toSelect = options.filter((o) => selected.includes(o.value));
      // La sélection de l'affichage précédent survit à un rechargement du
      // produit : on repart de l'état du serveur.
      select.selectionModel.clear(true);
      if (toSelect.length > 0) {
        select.selectionModel.select(...toSelect);
      }
    });
  }

  public setAllowedRoles(codes: string[] | null | undefined): void {
    this.formSchema.allowedRoles().value.set(codes ?? []);
  }

  public isRequiredField(code: string): boolean {
    return this.formSchema.requiredFields().value().includes(code);
  }

  public toggleRequiredField(code: string): void {
    const field = this.formSchema.requiredFields();
    const current = field.value();
    field.value.set(
      current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code],
    );
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const productId = this.product()?.id;
      if (!productId) return;

      const previousRoles = this.product()?.beneficiaryPolicy?.allowedRoles ?? [];
      // Les contraintes de comptage d'un rôle déjà configuré (`minCount`,
      // `maxCount`, `sharesMustTotal100`) ne sont pas éditables ici : on les
      // réémet telles quelles pour ne pas les écraser avec des valeurs par
      // défaut.
      const allowedRoles: DesignationRoleInput[] = value.allowedRoles.map(
        (code) => {
          const previous = previousRoles.find((r) => r.code === code);
          return {
            code,
            label: previous?.label ?? designationRoleLabel(code),
            minCount: previous?.minCount ?? 0,
            maxCount: previous?.maxCount ?? null,
            sharesMustTotal100: previous?.sharesMustTotal100 ?? false,
          };
        },
      );

      const payload: SetBeneficiaryPolicyRequest = {
        allowMultipleHoldings: value.allowMultipleHoldings,
        allowedRoles,
        maxChildren: toNullableInteger(value.maxChildren),
        childMaxAge: toNullableInteger(value.childMaxAge),
        requiredFieldsBeforeConversion: value.requiredFields,
        requiredKycTier: value.requiredKycTier.trim() || null,
        integrationSystem: value.integrationSystem.trim() || null,
      };

      const result = await firstValueFrom(
        this._productsApi
          .setProductBeneficiaryPolicy(productId, payload, 'response')
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                policyErrorMessage(error),
              );
              return EMPTY;
            }),
          ),
      );

      if (result) {
        this._snackbar.success(
          'Enregistré',
          'Politique bénéficiaires et foyer mise à jour.',
        );
        // L'écriture est composée (foyer, rôles, champs exigés) : le 204 ne dit
        // pas ce que le serveur a retenu, on recharge le produit.
        this.saved.emit();
      }
    });
  }

}

function toNullableInteger(raw: string): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

function policyErrorMessage(error: HttpErrorResponse): string {
  const body = error.error ?? {};
  const errors = body.errors as Record<string, string[]> | undefined;
  if (errors) {
    const first = Object.values(errors)[0]?.[0];
    if (first) return first;
  }
  if (typeof body.title === 'string' && body.title) return body.title;
  if (error.status === 403) {
    return "Vous n'avez pas le droit de modifier la politique de ce produit.";
  }
  return 'Impossible d’enregistrer la politique bénéficiaires et foyer.';
}
