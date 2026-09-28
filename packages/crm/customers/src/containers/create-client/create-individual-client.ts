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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import {
  email,
  form,
  FormField,
  FormRoot,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasInputPhone } from '@talisoft/ui/input-phone';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  AgenciesApiService,
  ClientsApiService,
  CreateClientResult,
  CreateClientResultOutcomeEnum,
  CreateIndividualClientRequest,
} from '@sankore/crm-api';
import {
  GENDER_OPTIONS,
  genderLabel,
  IDENTITY_DOCUMENT_OPTIONS,
  identityDocumentLabel,
  MARITAL_STATUS_OPTIONS,
  maritalStatusLabel,
} from '../../models/client-labels';
import {
  DuplicateCandidateView,
  DuplicateCheckBanner,
} from './duplicate-check-banner';
import {
  buildAddress,
  buildPhoneNumbers,
  CreateClientPrefill,
  candidatesFromHits,
  candidatesFromSearch,
  COUNTRY_OPTIONS,
  CURRENCY_OPTIONS,
  LANGUAGE_OPTIONS,
  serverMessage,
  toAmountOrNull,
  toGender,
  toIdentityDocumentType,
  toMaritalStatus,
  trimOrNull,
} from './create-client.utils';

type IndividualStepKey =
  | 'identity'
  | 'document'
  | 'contact'
  | 'situation'
  | 'summary';

// ——— Modèle de formulaire ———

export class IndividualIdentitySection {
  public agencyId!: string;
  public firstName!: string;
  public lastName!: string;
  public maidenName!: string;
  public gender!: string;
  public dateOfBirth!: string;
  public birthPlace!: string;
  public nationality!: string;
}

export class IndividualDocumentSection {
  public identityDocumentType!: string;
  public identityDocumentNumber!: string;
  public issuedOn!: string;
  public expiresOn!: string;
}

export class IndividualContactSection {
  public phoneNumber!: string;
  public secondaryPhoneNumber!: string;
  public email!: string;
  public street!: string;
  public city!: string;
  public state!: string;
  public country!: string;
  public zipCode!: string;
}

export class IndividualSituationSection {
  public profession!: string;
  public employer!: string;
  public declaredIncome!: string;
  public declaredIncomeCurrency!: string;
  public maritalStatus!: string;
  public fatherName!: string;
  public motherName!: string;
  public preferredLanguage!: string;
}

export class CreateIndividualClientFormModel {
  public identity!: IndividualIdentitySection;
  public document!: IndividualDocumentSection;
  public contact!: IndividualContactSection;
  public situation!: IndividualSituationSection;

  public static instantiate(): CreateIndividualClientFormModel {
    const model = new CreateIndividualClientFormModel();

    const identity = new IndividualIdentitySection();
    identity.agencyId = '';
    identity.firstName = '';
    identity.lastName = '';
    identity.maidenName = '';
    identity.gender = '';
    identity.dateOfBirth = '';
    identity.birthPlace = '';
    identity.nationality = 'CI';
    model.identity = identity;

    const document = new IndividualDocumentSection();
    document.identityDocumentType = '';
    document.identityDocumentNumber = '';
    document.issuedOn = '';
    document.expiresOn = '';
    model.document = document;

    const contact = new IndividualContactSection();
    contact.phoneNumber = '';
    contact.secondaryPhoneNumber = '';
    contact.email = '';
    contact.street = '';
    contact.city = '';
    contact.state = '';
    contact.country = 'CI';
    contact.zipCode = '';
    model.contact = contact;

    const situation = new IndividualSituationSection();
    situation.profession = '';
    situation.employer = '';
    situation.declaredIncome = '';
    situation.declaredIncomeCurrency = 'XOF';
    situation.maritalStatus = '';
    situation.fatherName = '';
    situation.motherName = '';
    situation.preferredLanguage = 'fr';
    model.situation = situation;

    return model;
  }
}

@Component({
  selector: 'create-individual-client',
  templateUrl: './create-individual-client.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasCard,
    TasIcon,
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
    DuplicateCheckBanner,
  ],
})
export class CreateIndividualClient implements OnInit {
  /** Saisie reprise de la liste des clients (`q` + `critere`). */
  public prefill = input<CreateClientPrefill | null>(null);

  private readonly _clientsApiService = inject(ClientsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly genderOptions = GENDER_OPTIONS;
  public readonly identityDocumentOptions = IDENTITY_DOCUMENT_OPTIONS;
  public readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  public readonly countryOptions = COUNTRY_OPTIONS;
  public readonly currencyOptions = CURRENCY_OPTIONS;
  public readonly languageOptions = LANGUAGE_OPTIONS;

  public readonly genderLabel = genderLabel;
  public readonly identityDocumentLabel = identityDocumentLabel;
  public readonly maritalStatusLabel = maritalStatusLabel;

  public readonly steps: { key: IndividualStepKey; label: string }[] = [
    { key: 'identity', label: 'Identité' },
    { key: 'document', label: 'Pièce déclarée' },
    { key: 'contact', label: 'Coordonnées' },
    { key: 'situation', label: 'Situation pro. et familiale' },
    { key: 'summary', label: 'Récapitulatif' },
  ];

  public stepIndex = signal(0);
  public readonly currentStep = computed<IndividualStepKey>(
    () => this.steps[this.stepIndex()].key,
  );
  public readonly isLastStep = computed(
    () => this.stepIndex() === this.steps.length - 1,
  );
  /** Passe à vrai quand « Suivant » a été refusé : le bandeau explique pourquoi on reste sur l'étape. */
  public stepBlocked = signal(false);

  public agencyOptions = signal<{ label: string; value: string }[]>([]);

  public phoneDuplicates = signal<DuplicateCandidateView[]>([]);
  public documentDuplicates = signal<DuplicateCandidateView[]>([]);
  public isCheckingPhone = signal(false);
  public isCheckingDocument = signal(false);

  public blockingDuplicates = signal<DuplicateCandidateView[]>([]);
  public warningDuplicates = signal<DuplicateCandidateView[]>([]);
  /** Renvoyé au serveur avec la commande après « ce n'est pas la même personne ». */
  public confirmNoDuplicate = signal(false);

  private _lastCheckedPhone = '';
  private _lastCheckedDocument = '';

  public model = signal(CreateIndividualClientFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.identity.agencyId, {
      message: "L'agence de rattachement est obligatoire",
    });
    required(schema.identity.firstName, {
      message: 'Le prénom est obligatoire',
    });
    required(schema.identity.lastName, { message: 'Le nom est obligatoire' });
    validate(schema.identity.gender, (ctx) =>
      toGender(ctx.value())
        ? undefined
        : { kind: 'required', message: 'Choisissez le genre' },
    );
    validate(schema.identity.dateOfBirth, (ctx) => {
      if (!ctx.value()) {
        return {
          kind: 'required',
          message: 'La date de naissance est obligatoire',
        };
      }
      return ctx.value() > new Date().toISOString().slice(0, 10)
        ? {
            kind: 'max',
            message: 'La date de naissance ne peut pas être dans le futur',
          }
        : undefined;
    });

    validate(schema.document.identityDocumentType, (ctx) =>
      toIdentityDocumentType(ctx.value())
        ? undefined
        : { kind: 'required', message: 'Choisissez le type de pièce' },
    );
    required(schema.document.identityDocumentNumber, {
      message: 'Le numéro de la pièce est obligatoire',
    });
    validate(schema.document.expiresOn, (ctx) => {
      const issuedOn = this.model().document.issuedOn;
      if (!ctx.value() || !issuedOn) return undefined;
      return ctx.value() < issuedOn
        ? {
            kind: 'min',
            message: "L'expiration ne peut pas précéder la délivrance",
          }
        : undefined;
    });

    required(schema.contact.phoneNumber, {
      message: 'Le numéro de téléphone est obligatoire',
    });
    email(schema.contact.email, { message: 'Adresse e-mail invalide' });

    validate(schema.situation.declaredIncome, (ctx) => {
      if (!ctx.value().trim()) return undefined;
      const amount = Number(ctx.value());
      return Number.isFinite(amount) && amount >= 0
        ? undefined
        : { kind: 'pattern', message: 'Saisissez un revenu valide' };
    });
  });

  /** Lu par la page hôte avant de quitter l'assistant ou de changer de type de client. */
  public readonly isDirty = computed(() => this.formSchema().dirty());

  public readonly stepInvalid = computed<Record<IndividualStepKey, boolean>>(
    () => ({
      identity: this.formSchema.identity().invalid(),
      document: this.formSchema.document().invalid(),
      contact: this.formSchema.contact().invalid(),
      situation: this.formSchema.situation().invalid(),
      summary: this.formSchema().invalid(),
    }),
  );

  public readonly fullName = computed(() => {
    const identity = this.model().identity;
    return `${identity.firstName} ${identity.lastName}`.trim();
  });

  constructor() {
    this._loadAgencies();
  }

  /**
   * Le pré-remplissage n'est pas une saisie : il passe par le modèle et non par
   * les contrôles, pour que l'assistant ne se croie pas « modifié » d'entrée et
   * ne réclame pas de confirmation à la sortie.
   */
  public ngOnInit(): void {
    const prefill = this.prefill();
    if (!prefill) return;

    this.model.update((model) => {
      // Le nom saisi dans la liste est libre : on le place entier dans le nom de
      // famille plutôt que de deviner une découpe prénom / nom.
      if (prefill.name) model.identity.lastName = prefill.name;
      if (prefill.phoneNumber) model.contact.phoneNumber = prefill.phoneNumber;
      if (prefill.documentNumber) {
        model.document.identityDocumentNumber = prefill.documentNumber;
      }
      return model;
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

  /** On ne saute pas en avant : une étape non validée resterait invisible. */
  public goTo(index: number): void {
    if (index >= this.stepIndex()) return;
    this.stepBlocked.set(false);
    this.stepIndex.set(index);
  }

  private _markStepTouched(key: IndividualStepKey): void {
    switch (key) {
      case 'identity':
        this.formSchema.identity().markAsTouched();
        return;
      case 'document':
        this.formSchema.document().markAsTouched();
        return;
      case 'contact':
        this.formSchema.contact().markAsTouched();
        return;
      case 'situation':
        this.formSchema.situation().markAsTouched();
        return;
      default:
        this.formSchema().markAsTouched();
        return;
    }
  }

  // ——— Contrôle de doublon au fil de la saisie ———

  public checkPhoneDuplicates(): void {
    const phone = this.model().contact.phoneNumber.replace(/\s+/g, '');
    if (phone.replace(/\D/g, '').length < 8) {
      this.phoneDuplicates.set([]);
      return;
    }
    if (phone === this._lastCheckedPhone) return;
    this._lastCheckedPhone = phone;

    this.isCheckingPhone.set(true);
    this._clientsApiService
      .searchClients(
        undefined,
        phone,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        5,
      )
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => of(null)),
      )
      .subscribe((result) => {
        this.isCheckingPhone.set(false);
        this.phoneDuplicates.set(candidatesFromSearch(result?.items));
      });
  }

  public checkDocumentDuplicates(): void {
    const documentNumber = this.model().document.identityDocumentNumber.trim();
    if (documentNumber.length < 4) {
      this.documentDuplicates.set([]);
      return;
    }
    if (documentNumber === this._lastCheckedDocument) return;
    this._lastCheckedDocument = documentNumber;

    this.isCheckingDocument.set(true);
    this._clientsApiService
      .searchClients(
        undefined,
        undefined,
        documentNumber,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        5,
      )
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => of(null)),
      )
      .subscribe((result) => {
        this.isCheckingDocument.set(false);
        this.documentDuplicates.set(candidatesFromSearch(result?.items));
      });
  }

  // ——— Soumission ———

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const request: CreateIndividualClientRequest = {
        agencyId: value.identity.agencyId,
        firstName: trimOrNull(value.identity.firstName),
        lastName: trimOrNull(value.identity.lastName),
        maidenName: trimOrNull(value.identity.maidenName),
        gender: toGender(value.identity.gender),
        dateOfBirth: value.identity.dateOfBirth,
        birthPlace: trimOrNull(value.identity.birthPlace),
        nationality: trimOrNull(value.identity.nationality),
        maritalStatus: toMaritalStatus(value.situation.maritalStatus),
        fatherName: trimOrNull(value.situation.fatherName),
        motherName: trimOrNull(value.situation.motherName),
        profession: trimOrNull(value.situation.profession),
        employer: trimOrNull(value.situation.employer),
        declaredIncome: toAmountOrNull(value.situation.declaredIncome),
        declaredIncomeCurrency: trimOrNull(
          value.situation.declaredIncomeCurrency,
        ),
        preferredLanguage: trimOrNull(value.situation.preferredLanguage),
        identityDocumentType: toIdentityDocumentType(
          value.document.identityDocumentType,
        ),
        identityDocumentNumber: trimOrNull(value.document.identityDocumentNumber),
        identityDocumentIssuedOn: trimOrNull(value.document.issuedOn),
        identityDocumentExpiresOn: trimOrNull(value.document.expiresOn),
        phoneNumbers: buildPhoneNumbers(
          value.contact.phoneNumber,
          value.contact.secondaryPhoneNumber,
        ),
        email: trimOrNull(value.contact.email),
        address: buildAddress(value.contact),
        confirmNoDuplicate: this.confirmNoDuplicate(),
      };

      const result = await firstValueFrom(
        this._clientsApiService.createIndividualClient(request).pipe(
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

      if (result) this._handleResult(result);
      return undefined;
    });
  }

  /** « Ce n'est pas la même personne » : la commande repart avec `confirmNoDuplicate`. */
  public confirmNotSamePerson(): void {
    this.confirmNoDuplicate.set(true);
    this.warningDuplicates.set([]);
    this.handleSubmit();
  }

  private _handleResult(result: CreateClientResult): void {
    switch (result.outcome) {
      case CreateClientResultOutcomeEnum.Created: {
        this.blockingDuplicates.set([]);
        this.warningDuplicates.set([]);
        this._snackbarService.success(
          'Client créé',
          `${this.fullName() || 'Le client'} est créé — KYC initié, en attente de validation.`,
        );
        // La fiche n'a pas à connaître ce paramètre : s'il est ignoré, seul le bandeau manque.
        this._router.navigate(['/customers', result.clientId], {
          queryParams: { kyc: 'initie' },
        });
        return;
      }

      case CreateClientResultOutcomeEnum.BlockedDuplicateIdentityDocument: {
        this.warningDuplicates.set([]);
        this.blockingDuplicates.set(candidatesFromHits(result.candidates));
        this._snackbarService.error(
          'Création bloquée',
          'Cette pièce d’identité appartient déjà à un client existant.',
        );
        return;
      }

      case CreateClientResultOutcomeEnum.WarningPossibleDuplicatePhone: {
        this.blockingDuplicates.set([]);
        this.warningDuplicates.set(candidatesFromHits(result.candidates));
        this._snackbarService.info(
          'Doublon possible',
          'Vérifiez les fiches proposées avant de confirmer la création.',
        );
        return;
      }

      default:
        this._snackbarService.error(
          'Erreur',
          "Réponse inattendue du serveur, le client n'a pas été créé.",
        );
        return;
    }
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
}
