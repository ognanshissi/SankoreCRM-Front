import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  applyEach,
  email,
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
  AgenciesApiService,
  BeneficialOwnerInput,
  ClientRelationshipsApiService,
  ClientSearchItemDto,
  ClientsApiService,
  CreateLegalClientRequest,
  CreateLegalClientResult,
  CreateLegalClientResultOutcomeEnum,
  LegalEntitiesApiService,
  LegalFormsApiService,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
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

type LegalStepKey =
  | 'identification'
  | 'headOffice'
  | 'representative'
  | 'owners'
  | 'summary';

/**
 * Seuil de détention au-delà duquel un bénéficiaire suffit à identifier le
 * contrôle effectif. En dessous, la réglementation UEMOA impose de désigner un
 * dirigeant principal : c'est la règle appliquée à l'étape « Bénéficiaires ».
 */
export const BENEFICIAL_OWNER_THRESHOLD = 25;

// ——— Modèle de formulaire ———

export class LegalIdentificationSection {
  public agencyId!: string;
  public legalName!: string;
  public legalFormCode!: string;
  public registrationNumber!: string;
  public taxIdNumber!: string;
  public incorporationDate!: string;
}

export class LegalHeadOfficeSection {
  public street!: string;
  public city!: string;
  public state!: string;
  public country!: string;
  public zipCode!: string;
  public phoneNumber!: string;
  public secondaryPhoneNumber!: string;
  public email!: string;
  public preferredLanguage!: string;
}

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

export class CreateLegalClientFormModel {
  public identification!: LegalIdentificationSection;
  public headOffice!: LegalHeadOfficeSection;
  public representative!: LegalRepresentativeSection;
  public owners!: BeneficialOwnerRow[];

  public static instantiate(): CreateLegalClientFormModel {
    const model = new CreateLegalClientFormModel();

    const identification = new LegalIdentificationSection();
    identification.agencyId = '';
    identification.legalName = '';
    identification.legalFormCode = '';
    identification.registrationNumber = '';
    identification.taxIdNumber = '';
    identification.incorporationDate = '';
    model.identification = identification;

    const headOffice = new LegalHeadOfficeSection();
    headOffice.street = '';
    headOffice.city = '';
    headOffice.state = '';
    headOffice.country = 'CI';
    headOffice.zipCode = '';
    headOffice.phoneNumber = '';
    headOffice.secondaryPhoneNumber = '';
    headOffice.email = '';
    headOffice.preferredLanguage = 'fr';
    model.headOffice = headOffice;

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
    DuplicateCheckBanner,
  ],
})
export class CreateLegalClient implements OnInit {
  /** Saisie reprise de la liste des clients (`q` + `critere`). */
  public prefill = input<CreateClientPrefill | null>(null);

  private readonly _legalEntitiesApiService = inject(LegalEntitiesApiService);
  private readonly _legalFormsApiService = inject(LegalFormsApiService);
  private readonly _clientsApiService = inject(ClientsApiService);
  private readonly _relationshipsApiService = inject(
    ClientRelationshipsApiService,
  );
  private readonly _agenciesApiService = inject(AgenciesApiService);
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

  public readonly steps: { key: LegalStepKey; label: string }[] = [
    { key: 'identification', label: 'Identification' },
    { key: 'headOffice', label: 'Siège et contacts' },
    { key: 'representative', label: 'Représentant légal' },
    { key: 'owners', label: 'Bénéficiaires effectifs' },
    { key: 'summary', label: 'Récapitulatif' },
  ];

  public stepIndex = signal(0);
  public readonly currentStep = computed<LegalStepKey>(
    () => this.steps[this.stepIndex()].key,
  );
  public readonly isLastStep = computed(
    () => this.stepIndex() === this.steps.length - 1,
  );
  public stepBlocked = signal(false);

  public agencyOptions = signal<{ label: string; value: string }[]>([]);
  public legalFormOptions = signal<{ label: string; value: string }[]>([]);

  public blockingDuplicates = signal<DuplicateCandidateView[]>([]);

  // Recherche de client à l'étape Bénéficiaires : barre de recherche, donc signaux + ngModel.
  public searchTerm = signal('');
  public searchResults = signal<ClientSearchItemDto[]>([]);
  public isSearching = signal(false);
  private readonly _search$ = new Subject<string>();

  public model = signal(CreateLegalClientFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.identification.agencyId, {
      message: "L'agence de rattachement est obligatoire",
    });
    required(schema.identification.legalName, {
      message: 'La raison sociale est obligatoire',
    });
    required(schema.identification.legalFormCode, {
      message: 'La forme juridique est obligatoire',
    });
    required(schema.identification.registrationNumber, {
      message: "Le numéro d'immatriculation est obligatoire",
    });
    validate(schema.identification.incorporationDate, (ctx) => {
      if (!ctx.value()) {
        return {
          kind: 'required',
          message: 'La date de constitution est obligatoire',
        };
      }
      return ctx.value() > new Date().toISOString().slice(0, 10)
        ? {
            kind: 'max',
            message: 'La date de constitution ne peut pas être dans le futur',
          }
        : undefined;
    });

    required(schema.headOffice.city, {
      message: 'La ville du siège est obligatoire',
    });
    required(schema.headOffice.country, {
      message: 'Le pays du siège est obligatoire',
    });
    required(schema.headOffice.phoneNumber, {
      message: 'Le téléphone du siège est obligatoire',
    });
    email(schema.headOffice.email, { message: 'Adresse e-mail invalide' });

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

  /** Lu par la page hôte avant de quitter l'assistant ou de changer de type de client. */
  public readonly isDirty = computed(() => this.formSchema().dirty());

  public readonly stepInvalid = computed<Record<LegalStepKey, boolean>>(() => ({
    identification: this.formSchema.identification().invalid(),
    headOffice: this.formSchema.headOffice().invalid(),
    representative: this.formSchema.representative().invalid(),
    owners: this.formSchema.owners().invalid(),
    summary: this.formSchema().invalid(),
  }));

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

  /**
   * Le pré-remplissage n'est pas une saisie : il passe par le modèle et non par
   * les contrôles, pour que l'assistant ne se croie pas « modifié » d'entrée et
   * ne réclame pas de confirmation à la sortie.
   */
  public ngOnInit(): void {
    const prefill = this.prefill();
    if (!prefill) return;

    this.model.update((model) => {
      if (prefill.name) model.identification.legalName = prefill.name;
      if (prefill.phoneNumber) model.headOffice.phoneNumber = prefill.phoneNumber;
      if (prefill.documentNumber) {
        model.identification.registrationNumber = prefill.documentNumber;
      }
      return model;
    });
  }

  constructor() {
    this._loadAgencies();
    this._loadLegalForms();

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

  // ——— Navigation entre étapes ———

  public next(): void {
    const key = this.currentStep();
    this._markStepTouched(key);

    if (this.stepInvalid()[key]) {
      this.stepBlocked.set(true);
      return;
    }

    this.stepBlocked.set(false);
    this.stepIndex.update((index) => Math.min(index + 1, this.steps.length - 1));
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

  private _markStepTouched(key: LegalStepKey): void {
    switch (key) {
      case 'identification':
        this.formSchema.identification().markAsTouched();
        return;
      case 'headOffice':
        this.formSchema.headOffice().markAsTouched();
        return;
      case 'representative':
        this.formSchema.representative().markAsTouched();
        return;
      case 'owners':
        this.formSchema.owners().markAsTouched();
        return;
      default:
        this.formSchema().markAsTouched();
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
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const request: CreateLegalClientRequest = {
        agencyId: value.identification.agencyId,
        legalName: trimOrNull(value.identification.legalName),
        legalFormCode: trimOrNull(value.identification.legalFormCode),
        registrationNumber: trimOrNull(value.identification.registrationNumber),
        taxIdNumber: trimOrNull(value.identification.taxIdNumber),
        incorporationDate: value.identification.incorporationDate,
        headOfficeAddress: buildAddress(value.headOffice),
        phoneNumbers: buildPhoneNumbers(
          value.headOffice.phoneNumber,
          value.headOffice.secondaryPhoneNumber,
        ),
        email: trimOrNull(value.headOffice.email),
        preferredLanguage: trimOrNull(value.headOffice.preferredLanguage),
      };

      const result = await firstValueFrom(
        this._legalEntitiesApiService.createLegalClient(request).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbarService.error(
              'Erreur',
              serverMessage(
                err,
                "Impossible de créer le client, réessayez plus tard.",
              ),
            );
            return of(null);
          }),
        ),
      );

      if (!result) return undefined;

      const clientId = this._resolveCreation(result);
      if (!clientId) return undefined;

      if (this.canDeclareBeneficialOwners()) {
        await this._declareOwners(clientId, value.owners);
      }
      await this._declareRepresentative(clientId, value.representative);

      this._snackbarService.success(
        'Client créé',
        `${value.identification.legalName} est créé — KYC initié, en attente de validation.`,
      );
      // La fiche n'a pas à connaître ce paramètre : s'il est ignoré, seul le bandeau manque.
      this._router.navigate(['/customers', clientId], {
        queryParams: { kyc: 'initie' },
      });

      return undefined;
    });
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

  private _loadAgencies(): void {
    this._agenciesApiService
      .listAgencies(false, 1, 200)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            'Impossible de charger les agences.',
          );
          return of(null);
        }),
      )
      .subscribe((result) => {
        this.agencyOptions.set(
          (result?.items ?? []).map((agency) => ({
            label: agency.name ?? '',
            value: agency.id ?? '',
          })),
        );
      });
  }

  private _loadLegalForms(): void {
    this._legalFormsApiService
      .listLegalForms(false)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            'Impossible de charger les formes juridiques.',
          );
          return of(null);
        }),
      )
      .subscribe((forms) => {
        this.legalFormOptions.set(
          (forms ?? []).map((legalForm) => ({
            label: legalForm.label ?? legalForm.code ?? '',
            value: legalForm.code ?? '',
          })),
        );
      });
  }
}
