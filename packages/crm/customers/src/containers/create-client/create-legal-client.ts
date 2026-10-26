import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  applyEach,
  form,
  FormField,
  FormRoot,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  firstValueFrom,
  of,
  Subject,
  switchMap,
} from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasInputPhone } from '@talisoft/ui/input-phone';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  AddRelationshipRequestTypeEnum,
  BeneficialOwnerInput,
  ClientRelationshipsApiService,
  ClientSearchItemDto,
  ClientsApiService,
  CreateLegalClientRequest,
  CreateLegalClientResult,
  CreateLegalClientResultOutcomeEnum,
  EntityFormDto,
  FormsApiService,
  LegalEntitiesApiService,
} from '@sankore/crm-api';
import {
  EntityFormFieldTemplate,
  EntityFormRenderer,
  explainFormError,
  formErrorDetail,
  formSteps,
  FormStep,
  PermissionsService,
  WireValues,
} from '@sankore/crm/common';
import {
  CONTROL_TYPE_OPTIONS,
  controlTypeLabel,
} from '../../models/client-labels';
import {
  DuplicateCandidateView,
  DuplicateCheckBanner,
} from './duplicate-check-banner';
import {
  buildAddress,
  buildPhoneNumbers,
  candidatesFromHits,
  CreateClientPrefill,
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  serverMessage,
  toControlType,
  trimOrNull,
} from './create-client.utils';

/** Les étapes propres à l'assistant ; les autres viennent de la mise en page (`layout:<section>`). */
type FixedStepKey = 'representative' | 'owners' | 'summary';

/** Le type est choisi avant l'assistant : il n'est pas une saisie, mais le contexte des conditions. */
const CONTEXT: WireValues = { clientType: 'Legal' };
const NOT_ASKED = ['clientType'];
const LAYOUT_PREFIX = 'layout:';

function text(values: WireValues, key: string): string {
  const v = values[key];
  return typeof v === 'string' ? v.trim() : '';
}

function textOrNull(values: WireValues, key: string): string | null {
  return text(values, key) || null;
}

/**
 * Seuil de détention au-delà duquel un bénéficiaire suffit à identifier le
 * contrôle effectif. En dessous, la réglementation UEMOA impose de désigner un
 * dirigeant principal : c'est la règle appliquée à l'étape « Bénéficiaires ».
 */
export const BENEFICIAL_OWNER_THRESHOLD = 25;

// ——— Modèle de formulaire ———

export class LegalRepresentativeSection {
  public fullName!: string;
  public phoneNumber!: string;
  public documentNumber!: string;
  public dateOfBirth!: string;
}

export class BeneficialOwnerRow {
  public mode!: 'client' | 'external';
  public linkedClientId!: string;
  public linkedClientLabel!: string;
  public externalFullName!: string;
  public externalNationality!: string;
  public externalDateOfBirth!: string;
  public externalDocumentNumber!: string;
  public ownershipPercentage!: string;
  public controlType!: string;

  public static external(): BeneficialOwnerRow {
    const row = new BeneficialOwnerRow();
    row.mode = 'external';
    row.linkedClientId = '';
    row.linkedClientLabel = '';
    row.externalFullName = '';
    row.externalNationality = 'CI';
    row.externalDateOfBirth = '';
    row.externalDocumentNumber = '';
    row.ownershipPercentage = '';
    row.controlType = 'Ownership';
    return row;
  }

  public static fromClient(client: ClientSearchItemDto): BeneficialOwnerRow {
    const row = BeneficialOwnerRow.external();
    row.mode = 'client';
    row.linkedClientId = client.id ?? '';
    row.linkedClientLabel = [client.displayName, client.clientNumber]
      .filter((part) => !!part)
      .join(' · ');
    return row;
  }
}

/**
 * Ce que la mise en page ne décrit pas : le représentant légal et les bénéficiaires effectifs,
 * avec leurs règles d'ensemble. L'identification et le siège sont dans le moteur du formulaire.
 */
export class CreateLegalClientFormModel {
  public representative!: LegalRepresentativeSection;
  public owners!: BeneficialOwnerRow[];

  public static instantiate(): CreateLegalClientFormModel {
    const model = new CreateLegalClientFormModel();

    const representative = new LegalRepresentativeSection();
    representative.fullName = '';
    representative.phoneNumber = '';
    representative.documentNumber = '';
    representative.dateOfBirth = '';
    model.representative = representative;

    model.owners = [];

    return model;
  }
}

@Component({
  selector: 'create-legal-client',
  templateUrl: './create-legal-client.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasCard,
    TasIcon,
    TasSpinner,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasInputPhone,
    TasDatePicker,
    FormRoot,
    FormField,
    FormsModule,
    EntityFormRenderer,
    EntityFormFieldTemplate,
    DuplicateCheckBanner,
  ],
})
export class CreateLegalClient {
  /** Saisie reprise de la liste des clients (`q` + `critere`). */
  public prefill = input<CreateClientPrefill | null>(null);

  private readonly _legalEntitiesApiService = inject(LegalEntitiesApiService);
  private readonly _formsApi = inject(FormsApiService);
  private readonly _clientsApiService = inject(ClientsApiService);
  private readonly _relationshipsApiService = inject(
    ClientRelationshipsApiService,
  );
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _permissions = inject(PermissionsService);

  /**
   * Déclarer les bénéficiaires effectifs relève de `customers:update_sensitive`,
   * pas de `customers:create` : sans ce droit, la création aboutit et l'étape
   * annonce que la déclaration revient à un profil habilité — plutôt qu'un 403
   * en toute fin d'assistant.
   */
  public readonly canDeclareBeneficialOwners = this._permissions.can(
    'customers:update_sensitive',
  );

  public readonly countryOptions = COUNTRY_OPTIONS;
  public readonly languageOptions = LANGUAGE_OPTIONS;
  public readonly controlTypeOptions = CONTROL_TYPE_OPTIONS;
  public readonly controlTypeLabel = controlTypeLabel;
  public readonly threshold = BENEFICIAL_OWNER_THRESHOLD;

  // ——— Le formulaire du tenant (formulaires dynamiques, lot 5) ———

  public readonly form = signal<EntityFormDto | null>(null);
  public readonly loadFailed = signal(false);
  public readonly submitting = signal(false);
  private readonly _renderer = viewChild(EntityFormRenderer);

  /** Les étapes de la mise en page « Client » pour une personne morale, puis celles de l'assistant. */
  private readonly _layoutSteps = computed<FormStep[]>(() => {
    const form = this.form();
    return form ? formSteps(form, 'quick', CONTEXT, NOT_ASKED) : [];
  });

  public readonly steps = computed<{ key: string; label: string }[]>(() => [
    ...this._layoutSteps().map((s) => ({ key: LAYOUT_PREFIX + s.key, label: s.label })),
    { key: 'representative', label: 'Représentant légal' },
    { key: 'owners', label: 'Bénéficiaires effectifs' },
    { key: 'summary', label: 'Récapitulatif' },
  ]);

  public stepIndex = signal(0);
  public readonly currentStep = computed<string>(() => this.steps()[this.stepIndex()]?.key ?? 'summary');
  public readonly isLastStep = computed(() => this.stepIndex() === this.steps().length - 1);
  public stepBlocked = signal(false);

  /** L'étape de la mise en page en cours, ou null sur une étape propre à l'assistant. */
  public readonly currentLayoutStep = computed(() => {
    const key = this.currentStep();
    return key.startsWith(LAYOUT_PREFIX)
      ? this._layoutSteps().find((s) => LAYOUT_PREFIX + s.key === key) ?? null
      : null;
  });

  /**
   * Le moteur reste monté pendant tout l'assistant — c'est lui qui garde la saisie de
   * l'identification pendant qu'on déclare le représentant. Il n'affiche que l'étape en cours,
   * tout au récapitulatif (en lecture seule), et rien sur les étapes propres à l'assistant.
   */
  public readonly showRenderer = computed(() => !!this.currentLayoutStep() || this.currentStep() === 'summary');
  public readonly excluded = computed(() => {
    const all = (this.form()?.fields ?? []).map((f) => f.key ?? '');
    if (this.currentStep() === 'summary') return NOT_ASKED;
    const step = this.currentLayoutStep();
    if (!step) return all;
    const keep = new Set(step.fieldKeys);
    return all.filter((k) => !keep.has(k));
  });

  /** Le type, et ce que la liste des clients a transmis — une saisie de départ, pas une fiche. */
  public readonly rendererPrefill = computed<WireValues>(() => {
    const prefill = this.prefill();
    return {
      ...CONTEXT,
      ...(prefill?.name ? { legalName: prefill.name } : {}),
      ...(prefill?.phoneNumber ? { phoneNumbers: prefill.phoneNumber } : {}),
      ...(prefill?.documentNumber ? { registrationNumber: prefill.documentNumber } : {}),
    };
  });

  public blockingDuplicates = signal<DuplicateCandidateView[]>([]);

  // Recherche de client à l'étape Bénéficiaires : barre de recherche, donc signaux + ngModel.
  public searchTerm = signal('');
  public searchResults = signal<ClientSearchItemDto[]>([]);
  public isSearching = signal(false);
  private readonly _search$ = new Subject<string>();

  public model = signal(CreateLegalClientFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.representative.fullName, {
      message: 'Le nom du représentant légal est obligatoire',
    });

    applyEach(schema.owners, (owner) => {
      validate(owner, (ctx) => {
        const row = ctx.value();
        if (row.mode === 'client' && !row.linkedClientId) {
          return {
            kind: 'required',
            message: 'Sélectionnez le client lié à ce bénéficiaire',
          };
        }
        if (row.mode === 'external' && !row.externalFullName.trim()) {
          return {
            kind: 'required',
            message: 'Saisissez le nom du bénéficiaire externe',
          };
        }
        return undefined;
      });

      validate(owner.ownershipPercentage, (ctx) => {
        if (!ctx.value().trim()) {
          return {
            kind: 'required',
            message: 'Indiquez le pourcentage de détention',
          };
        }
        const percentage = Number(ctx.value());
        return Number.isFinite(percentage) &&
          percentage >= 0 &&
          percentage <= 100
          ? undefined
          : { kind: 'pattern', message: 'Pourcentage entre 0 et 100' };
      });

      validate(owner.controlType, (ctx) =>
        toControlType(ctx.value())
          ? undefined
          : { kind: 'required', message: 'Choisissez le type de contrôle' },
      );
    });

    validate(schema.owners, (ctx) => {
      if (!this.canDeclareBeneficialOwners()) return undefined;

      const rows = ctx.value();
      const total = rows.reduce(
        (sum, row) => sum + (Number(row.ownershipPercentage) || 0),
        0,
      );
      if (total > 100) {
        return {
          kind: 'max',
          message: `Le total des détentions atteint ${total} % : il ne peut pas dépasser 100 %.`,
        };
      }
      const hasOwnerAboveThreshold = rows.some(
        (row) =>
          (Number(row.ownershipPercentage) || 0) >= BENEFICIAL_OWNER_THRESHOLD,
      );
      const hasManager = rows.some((row) => row.controlType === 'Manager');
      if (!hasOwnerAboveThreshold && !hasManager) {
        return {
          kind: 'required',
          message: `Aucun bénéficiaire n'atteint ${BENEFICIAL_OWNER_THRESHOLD} % : déclarez un dirigeant principal (type de contrôle « Dirigeant »).`,
        };
      }
      return undefined;
    });
  });

  /** Posé juste avant la navigation vers la fiche créée : la saisie n'est plus à protéger. */
  private readonly _created = signal(false);

  /**
   * Lu par la page hôte avant de quitter l'assistant ou de changer de type de client. Faux une
   * fois le client créé : sinon la garde de sortie demandait « Quitter sans créer ? » sur la
   * navigation vers la fiche qui venait d'être créée.
   */
  public readonly isDirty = computed(
    () =>
      !this._created() &&
      (this.formSchema().dirty() || (this._renderer()?.formSchema().dirty() ?? false)),
  );

  private _isStepInvalid(key: string): boolean {
    const renderer = this._renderer();
    if (key.startsWith(LAYOUT_PREFIX)) return !renderer || !renderer.valid();
    switch (key as FixedStepKey) {
      case 'representative':
        return this.formSchema.representative().invalid();
      case 'owners':
        return this.formSchema.owners().invalid();
      default:
        return this.formSchema().invalid() || !renderer || !renderer.valid();
    }
  }

  public readonly ownerRows = computed(() => this.model().owners);

  public readonly ownershipTotal = computed(() =>
    this.ownerRows().reduce(
      (sum, row) => sum + (Number(row.ownershipPercentage) || 0),
      0,
    ),
  );

  public readonly hasOwnerAboveThreshold = computed(() =>
    this.ownerRows().some(
      (row) =>
        (Number(row.ownershipPercentage) || 0) >= BENEFICIAL_OWNER_THRESHOLD,
    ),
  );

  public readonly hasManager = computed(() =>
    this.ownerRows().some((row) => row.controlType === 'Manager'),
  );

  /** Erreurs de la règle d'ensemble, affichées sans attendre que la liste soit touchée. */
  public readonly ownersRuleErrors = computed(() =>
    this.formSchema.owners().errors(),
  );

  constructor() {
    this.load();

    this._search$
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) =>
          this._clientsApiService
            .searchClients(
              undefined,
              undefined,
              undefined,
              term,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              1,
              10,
            )
            .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((result) => {
        this.isSearching.set(false);
        this.searchResults.set(result?.items ?? []);
      });
  }

  public load(): void {
    this.loadFailed.set(false);
    this._formsApi.getEntityForm('Client').subscribe({
      next: (form) => this.form.set(form),
      error: () => this.loadFailed.set(true),
    });
  }

  // ——— Navigation entre étapes ———

  public next(): void {
    const key = this.currentStep();
    this._markStepTouched(key);

    if (this._isStepInvalid(key)) {
      this.stepBlocked.set(true);
      return;
    }

    this.stepBlocked.set(false);
    this.stepIndex.update((index) => Math.min(index + 1, this.steps().length - 1));
  }

  public previous(): void {
    this.stepBlocked.set(false);
    this.stepIndex.update((index) => Math.max(index - 1, 0));
  }

  public goTo(index: number): void {
    if (index >= this.stepIndex()) return;
    this.stepBlocked.set(false);
    this.stepIndex.set(index);
  }

  private _markStepTouched(key: string): void {
    const layout = this.currentLayoutStep();
    if (layout) {
      this._renderer()?.markTouched(layout.fieldKeys);
      return;
    }
    switch (key as FixedStepKey) {
      case 'representative':
        this.formSchema.representative().markAsTouched();
        return;
      case 'owners':
        this.formSchema.owners().markAsTouched();
        return;
      default:
        this.formSchema().markAsTouched();
        this._renderer()?.markAllAsTouched();
        return;
    }
  }

  // ——— Bénéficiaires effectifs ———

  public onSearchTermChange(term: string): void {
    this.searchTerm.set(term);
    if (term.trim().length < 2) {
      this.searchResults.set([]);
      this.isSearching.set(false);
      return;
    }
    this.isSearching.set(true);
    this._search$.next(term.trim());
  }

  public addOwnerFromClient(client: ClientSearchItemDto): void {
    this.formSchema
      .owners()
      .value.update((rows) => [...rows, BeneficialOwnerRow.fromClient(client)]);
    this.searchTerm.set('');
    this.searchResults.set([]);
  }

  public addExternalOwner(): void {
    this.formSchema
      .owners()
      .value.update((rows) => [...rows, BeneficialOwnerRow.external()]);
  }

  /** Le représentant légal est très souvent le dirigeant principal : on évite la double saisie. */
  public addRepresentativeAsManager(): void {
    const representative = this.model().representative;
    const row = BeneficialOwnerRow.external();
    row.externalFullName = representative.fullName;
    row.externalDateOfBirth = representative.dateOfBirth;
    row.externalDocumentNumber = representative.documentNumber;
    row.ownershipPercentage = '0';
    row.controlType = 'Manager';
    this.formSchema.owners().value.update((rows) => [...rows, row]);
  }

  public removeOwner(index: number): void {
    this.formSchema
      .owners()
      .value.update((rows) => rows.filter((_, i) => i !== index));
  }

  // ——— Soumission ———

  public handleSubmit(): void {
    const renderer = this._renderer();
    if (!renderer || this.submitting()) return;

    // Au récapitulatif tout est rendu, donc tout est vérifié : une erreur ramène à son étape.
    if (!renderer.valid()) {
      const invalid = renderer.invalidKeys();
      const index = this._layoutSteps().findIndex((s) => s.fieldKeys.some((k) => invalid.includes(k)));
      if (index >= 0) {
        this.stepIndex.set(index);
        this.stepBlocked.set(true);
        renderer.markTouched(this._layoutSteps()[index].fieldKeys);
      }
      return;
    }

    const v = renderer.wireValues();
    const crossFieldError = this._crossFieldError(v);
    if (crossFieldError) {
      this._snackbarService.error('Vérifiez la saisie', crossFieldError);
      return;
    }

    submit(this.formSchema, async (field) => {
      const value = field().value();
      const legalName = text(v, 'legalName');
      const request: CreateLegalClientRequest = {
        agencyId: text(v, 'agencyId'),
        advisorUserId: textOrNull(v, 'advisorUserId'),
        legalName: legalName || null,
        legalFormCode: textOrNull(v, 'legalFormCode'),
        registrationNumber: textOrNull(v, 'registrationNumber'),
        taxIdNumber: textOrNull(v, 'taxIdNumber'),
        incorporationDate: text(v, 'incorporationDate'),
        headOfficeAddress: buildAddress({
          street: text(v, 'address.street'),
          city: text(v, 'address.city'),
          state: text(v, 'address.state'),
          country: text(v, 'address.country'),
          zipCode: text(v, 'address.zipCode'),
        }),
        phoneNumbers: buildPhoneNumbers(text(v, 'phoneNumbers'), text(v, 'secondaryPhoneNumber')),
        email: textOrNull(v, 'email'),
        preferredLanguage: textOrNull(v, 'preferredLanguage'),
        customFields: renderer.customFieldsPayload(),
      };

      this.submitting.set(true);
      const result = await firstValueFrom(
        this._legalEntitiesApiService.createLegalClient(request).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbarService.error(
              'Erreur',
              explainFormError(formErrorDetail(err), this.form()) ??
                serverMessage(err, "Impossible de créer le client, réessayez plus tard."),
            );
            return of(null);
          }),
        ),
      );

      if (!result) {
        this.submitting.set(false);
        return undefined;
      }

      const clientId = this._resolveCreation(result);
      if (!clientId) {
        this.submitting.set(false);
        return undefined;
      }

      if (this.canDeclareBeneficialOwners()) {
        await this._declareOwners(clientId, value.owners);
      }
      await this._declareRepresentative(clientId, value.representative);
      this.submitting.set(false);

      this._snackbarService.success(
        'Client créé',
        `${legalName || 'Le client'} est créé — KYC initié, en attente de validation.`,
      );
      this._created.set(true);
      // La fiche n'a pas à connaître ce paramètre : s'il est ignoré, seul le bandeau manque.
      this._router.navigate(['/customers', clientId], {
        queryParams: { kyc: 'initie' },
      });

      return undefined;
    });
  }

  /**
   * Ce que le moteur ne vérifie pas champ par champ : une date de constitution passée, et un siège
   * localisable (le serveur exige une rue ou une ville). Dit avant l'envoi plutôt qu'en anglais après.
   */
  private _crossFieldError(v: WireValues): string | null {
    const today = new Date().toISOString().slice(0, 10);
    const incorporated = text(v, 'incorporationDate');
    if (incorporated && incorporated > today) return 'La date de constitution ne peut pas être dans le futur.';
    if (!text(v, 'address.street') && !text(v, 'address.city')) {
      return 'Indiquez au moins la rue ou la ville du siège.';
    }
    return null;
  }

  private _resolveCreation(result: CreateLegalClientResult): string | null {
    if (
      result.outcome ===
      CreateLegalClientResultOutcomeEnum.BlockedDuplicateRegistrationNumber
    ) {
      this.blockingDuplicates.set(candidatesFromHits(result.candidates));
      this._snackbarService.error(
        'Création bloquée',
        "Ce numéro d'immatriculation appartient déjà à un client existant.",
      );
      return null;
    }

    if (
      result.outcome !== CreateLegalClientResultOutcomeEnum.Created ||
      !result.clientId
    ) {
      this._snackbarService.error(
        'Erreur',
        "Réponse inattendue du serveur, le client n'a pas été créé.",
      );
      return null;
    }

    this.blockingDuplicates.set([]);
    return result.clientId;
  }

  /**
   * Les bénéficiaires et le représentant se déclarent après la création : le client
   * existe déjà si l'un de ces appels échoue, donc on le dit au lieu d'avaler l'erreur.
   */
  private async _declareOwners(
    clientId: string,
    rows: BeneficialOwnerRow[],
  ): Promise<void> {
    if (rows.length === 0) return;

    const owners: BeneficialOwnerInput[] = rows.map((row) => ({
      linkedClientId: row.mode === 'client' ? row.linkedClientId : null,
      externalFullName:
        row.mode === 'external' ? trimOrNull(row.externalFullName) : null,
      externalNationality:
        row.mode === 'external' ? trimOrNull(row.externalNationality) : null,
      externalDateOfBirth:
        row.mode === 'external' ? trimOrNull(row.externalDateOfBirth) : null,
      externalDocumentNumber:
        row.mode === 'external' ? trimOrNull(row.externalDocumentNumber) : null,
      ownershipPercentage: Number(row.ownershipPercentage) || 0,
      controlType: toControlType(row.controlType),
    }));

    await firstValueFrom(
      this._legalEntitiesApiService
        .declareBeneficialOwners(clientId, {
          owners,
          reason: 'Déclaration initiale à la création du client',
        })
        .pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbarService.error(
              'Bénéficiaires non enregistrés',
              serverMessage(
                err,
                'Le client est créé mais les bénéficiaires effectifs restent à déclarer depuis sa fiche.',
              ),
            );
            return of(null);
          }),
        ),
    );
  }

  private async _declareRepresentative(
    clientId: string,
    representative: LegalRepresentativeSection,
  ): Promise<void> {
    await firstValueFrom(
      this._relationshipsApiService
        .addClientRelationship(clientId, {
          // Le contrat n'a pas de type « représentant légal » : `Proxy` (mandataire)
          // est la seule valeur qui porte ce rôle dans `AddRelationshipRequest`.
          type: AddRelationshipRequestTypeEnum.Proxy,
          externalFullName: trimOrNull(representative.fullName),
          externalPhoneNumber: trimOrNull(representative.phoneNumber),
          externalDateOfBirth: trimOrNull(representative.dateOfBirth),
          externalDocumentNumber: trimOrNull(representative.documentNumber),
        })
        .pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbarService.error(
              'Représentant non enregistré',
              serverMessage(
                err,
                'Le client est créé mais le représentant légal reste à rattacher depuis sa fiche.',
              ),
            );
            return of(null);
          }),
        ),
    );
  }

  // ——— Sortie de l'assistant ———

  public requestExit(): void {
    if (!this.isDirty()) {
      this._leave();
      return;
    }

    this._confirmDialogService.confirm({
      title: "Quitter l'assistant ?",
      message:
        'Les informations saisies seront perdues. Voulez-vous vraiment quitter ?',
      closable: true,
      showCancelButton: true,
      icon: 'feather:alert-triangle',
      acceptButtonProps: { label: 'Quitter', theme: 'warn' },
      rejectButtonProps: { label: 'Continuer la saisie', theme: 'primary' },
      accept: () => this._leave(),
    });
  }

  private _leave(): void {
    this._router.navigate(['/customers']);
  }


}
