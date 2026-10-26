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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField } from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasInputPhone } from '@talisoft/ui/input-phone';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  ClientsApiService,
  CreateClientResult,
  CreateClientResultOutcomeEnum,
  CreateIndividualClientRequest,
  EntityFormDto,
  FormsApiService,
} from '@sankore/crm-api';
import {
  EntityFormFieldTemplate,
  EntityFormRenderer,
  explainFormError,
  formErrorDetail,
  formSteps,
  FormStep,
  WireValues,
} from '@sankore/crm/common';
import { DuplicateCandidateView, DuplicateCheckBanner } from './duplicate-check-banner';
import {
  buildAddress,
  buildPhoneNumbers,
  CreateClientPrefill,
  candidatesFromHits,
  candidatesFromSearch,
  serverMessage,
  toGender,
  toIdentityDocumentType,
  toMaritalStatus,
} from './create-client.utils';

/** Le type est choisi avant l'assistant : il n'est pas une saisie, mais le contexte des conditions. */
const CONTEXT: WireValues = { clientType: 'Individual' };
const NOT_ASKED = ['clientType'];
const SUMMARY_KEY = '__summary';

function text(values: WireValues, key: string): string {
  const v = values[key];
  return typeof v === 'string' ? v.trim() : '';
}

function textOrNull(values: WireValues, key: string): string | null {
  return text(values, key) || null;
}

/**
 * Création d'une personne physique, pilotée par la mise en page « Client » du tenant (formulaires
 * dynamiques, lot 5) : une étape par section de la création rapide, puis un récapitulatif.
 *
 * <p><b>Un seul moteur pour tout l'assistant.</b> À chaque étape, il ne rend que les champs de
 * l'étape — c'est ce qui fait que « Suivant » ne valide qu'elle ; au récapitulatif, il rend tout en
 * lecture seule, ce qui revérifie l'ensemble avant l'envoi. Les valeurs saisies traversent les
 * étapes parce que c'est le même modèle.</p>
 *
 * <p>Ce qui n'est pas de la mise en page reste ici : la recherche de doublon au fil de la saisie
 * (téléphone, pièce d'identité), les deux refus du serveur et le « ce n'est pas la même personne ».</p>
 */
@Component({
  selector: 'create-individual-client',
  templateUrl: './create-individual-client.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasCard,
    TasIcon,
    Button,
    TasSpinner,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasInputPhone,
    FormField,
    EntityFormRenderer,
    EntityFormFieldTemplate,
    DuplicateCheckBanner,
  ],
})
export class CreateIndividualClient {
  /** Saisie reprise de la liste des clients (`q` + `critere`). */
  public prefill = input<CreateClientPrefill | null>(null);

  private readonly _clientsApiService = inject(ClientsApiService);
  private readonly _formsApi = inject(FormsApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _renderer = viewChild(EntityFormRenderer);

  public readonly form = signal<EntityFormDto | null>(null);
  public readonly loadFailed = signal(false);
  public readonly submitting = signal(false);

  // ——— Étapes ———

  public readonly steps = computed<FormStep[]>(() => {
    const form = this.form();
    if (!form) return [];
    return [...formSteps(form, 'quick', CONTEXT, NOT_ASKED), { key: SUMMARY_KEY, label: 'Récapitulatif', fieldKeys: [] }];
  });

  public stepIndex = signal(0);
  public readonly currentStep = computed<FormStep | null>(() => this.steps()[this.stepIndex()] ?? null);
  public readonly isSummary = computed(() => this.currentStep()?.key === SUMMARY_KEY);
  public readonly isLastStep = computed(() => this.stepIndex() === this.steps().length - 1);
  /** Passe à vrai quand « Suivant » a été refusé : le bandeau explique pourquoi on reste sur l'étape. */
  public stepBlocked = signal(false);

  /** À chaque étape, tout ce qui n'en est pas ; au récapitulatif, rien — tout est revérifié. */
  public readonly excluded = computed(() => {
    const step = this.currentStep();
    if (!step || this.isSummary()) return NOT_ASKED;
    const keep = new Set(step.fieldKeys);
    return (this.form()?.fields ?? []).map((f) => f.key ?? '').filter((k) => !keep.has(k));
  });

  /** Le type, et ce que la liste des clients a transmis — une saisie de départ, pas une fiche. */
  public readonly rendererPrefill = computed<WireValues>(() => {
    const prefill = this.prefill();
    return {
      ...CONTEXT,
      // Le nom saisi dans la liste est libre : on le place entier dans le nom de famille plutôt que
      // de deviner une découpe prénom / nom.
      ...(prefill?.name ? { lastName: prefill.name } : {}),
      ...(prefill?.phoneNumber ? { phoneNumbers: prefill.phoneNumber } : {}),
      ...(prefill?.documentNumber ? { identityDocumentNumber: prefill.documentNumber } : {}),
    };
  });

  /** Posé juste avant la navigation vers la fiche créée : la saisie n'est plus à protéger. */
  private readonly _created = signal(false);

  /**
   * Lu par la page hôte avant de quitter l'assistant ou de changer de type de client. Faux une
   * fois le client créé : sinon la garde de sortie demandait « Quitter sans créer ? » sur la
   * navigation vers la fiche qui venait d'être créée.
   */
  public readonly isDirty = computed(
    () => !this._created() && (this._renderer()?.formSchema().dirty() ?? false),
  );

  public readonly fullName = computed(() => {
    const v = this._renderer()?.wireValues() ?? {};
    return `${text(v, 'firstName')} ${text(v, 'lastName')}`.trim();
  });

  // ——— Doublons ———

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

  constructor() {
    this.load();
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
    const renderer = this._renderer();
    const step = this.currentStep();
    if (!renderer || !step) return;

    renderer.markTouched(step.fieldKeys);
    if (!renderer.valid()) {
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

  /** On ne saute pas en avant : une étape non validée resterait invisible. */
  public goTo(index: number): void {
    if (index >= this.stepIndex()) return;
    this.stepBlocked.set(false);
    this.stepIndex.set(index);
  }

  // ——— Contrôle de doublon au fil de la saisie ———

  public checkPhoneDuplicates(raw: string): void {
    const phone = (raw ?? '').replace(/\s+/g, '');
    if (phone.replace(/\D/g, '').length < 8) {
      this.phoneDuplicates.set([]);
      return;
    }
    if (phone === this._lastCheckedPhone) return;
    this._lastCheckedPhone = phone;

    this.isCheckingPhone.set(true);
    this._clientsApiService
      .searchClients(undefined, phone, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 1, 5)
      .pipe(takeUntilDestroyed(this._destroyRef), catchError(() => of(null)))
      .subscribe((result) => {
        this.isCheckingPhone.set(false);
        this.phoneDuplicates.set(candidatesFromSearch(result?.items));
      });
  }

  public checkDocumentDuplicates(raw: string): void {
    const documentNumber = (raw ?? '').trim();
    if (documentNumber.length < 4) {
      this.documentDuplicates.set([]);
      return;
    }
    if (documentNumber === this._lastCheckedDocument) return;
    this._lastCheckedDocument = documentNumber;

    this.isCheckingDocument.set(true);
    this._clientsApiService
      .searchClients(undefined, undefined, documentNumber, undefined, undefined, undefined, undefined, undefined, undefined, 1, 5)
      .pipe(takeUntilDestroyed(this._destroyRef), catchError(() => of(null)))
      .subscribe((result) => {
        this.isCheckingDocument.set(false);
        this.documentDuplicates.set(candidatesFromSearch(result?.items));
      });
  }

  // ——— Soumission ———

  public async handleSubmit(): Promise<void> {
    const renderer = this._renderer();
    if (!renderer || this.submitting()) return;

    // Au récapitulatif tout est rendu, donc tout est vérifié : une erreur ramène à son étape.
    if (!renderer.valid()) {
      this._goToFirstInvalid(renderer.invalidKeys());
      return;
    }

    const v = renderer.wireValues();
    const crossFieldError = this._crossFieldError(v);
    if (crossFieldError) {
      this._snackbarService.error('Vérifiez la saisie', crossFieldError);
      return;
    }

    const income = v['declaredIncome'];
    const money = income && typeof income === 'object' && !Array.isArray(income) ? income : null;

    const request: CreateIndividualClientRequest = {
      agencyId: text(v, 'agencyId'),
      advisorUserId: textOrNull(v, 'advisorUserId'),
      firstName: textOrNull(v, 'firstName'),
      lastName: textOrNull(v, 'lastName'),
      maidenName: textOrNull(v, 'maidenName'),
      gender: toGender(text(v, 'gender')),
      dateOfBirth: text(v, 'dateOfBirth'),
      birthPlace: textOrNull(v, 'birthPlace'),
      nationality: textOrNull(v, 'nationality'),
      maritalStatus: toMaritalStatus(text(v, 'maritalStatus')),
      fatherName: textOrNull(v, 'fatherName'),
      motherName: textOrNull(v, 'motherName'),
      profession: textOrNull(v, 'profession'),
      employer: textOrNull(v, 'employer'),
      declaredIncome: money?.amount ?? null,
      declaredIncomeCurrency: money?.currency ?? null,
      preferredLanguage: textOrNull(v, 'preferredLanguage'),
      identityDocumentType: toIdentityDocumentType(text(v, 'identityDocumentType')),
      identityDocumentNumber: textOrNull(v, 'identityDocumentNumber'),
      identityDocumentIssuedOn: textOrNull(v, 'identityDocumentIssuedOn'),
      identityDocumentExpiresOn: textOrNull(v, 'identityDocumentExpiresOn'),
      phoneNumbers: buildPhoneNumbers(text(v, 'phoneNumbers'), text(v, 'secondaryPhoneNumber')),
      email: textOrNull(v, 'email'),
      address: buildAddress({
        street: text(v, 'address.street'),
        city: text(v, 'address.city'),
        state: text(v, 'address.state'),
        country: text(v, 'address.country'),
        zipCode: text(v, 'address.zipCode'),
      }),
      customFields: renderer.customFieldsPayload(),
      confirmNoDuplicate: this.confirmNoDuplicate(),
    };

    this.submitting.set(true);
    const result = await firstValueFrom(
      this._clientsApiService.createIndividualClient(request).pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbarService.error(
            'Erreur',
            explainFormError(formErrorDetail(err), this.form()) ??
              serverMessage(err, 'Impossible de créer le client, réessayez plus tard.'),
          );
          return of(null);
        }),
      ),
    );
    this.submitting.set(false);

    if (result) this._handleResult(result);
  }

  /** « Ce n'est pas la même personne » : la commande repart avec `confirmNoDuplicate`. */
  public confirmNotSamePerson(): void {
    this.confirmNoDuplicate.set(true);
    this.warningDuplicates.set([]);
    void this.handleSubmit();
  }

  /**
   * Les deux règles qui portent sur deux dates à la fois : le moteur valide champ par champ, et le
   * serveur les refuserait de toute façon — mais en anglais technique et après l'envoi.
   */
  private _crossFieldError(v: WireValues): string | null {
    const today = new Date().toISOString().slice(0, 10);
    const birth = text(v, 'dateOfBirth');
    if (birth && birth > today) return 'La date de naissance ne peut pas être dans le futur.';
    const issued = text(v, 'identityDocumentIssuedOn');
    const expires = text(v, 'identityDocumentExpiresOn');
    if (issued && expires && expires < issued) return "L'expiration de la pièce ne peut pas précéder sa délivrance.";
    return null;
  }

  private _goToFirstInvalid(keys: string[]): void {
    const index = this.steps().findIndex((s) => s.fieldKeys.some((k) => keys.includes(k)));
    if (index >= 0) {
      this.stepIndex.set(index);
      this.stepBlocked.set(true);
      this._renderer()?.markTouched(this.steps()[index].fieldKeys);
    }
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
        this._created.set(true);
        // La fiche n'a pas à connaître ce paramètre : s'il est ignoré, seul le bandeau manque.
        this._router.navigate(['/customers', result.clientId], { queryParams: { kyc: 'initie' } });
        return;
      }

      case CreateClientResultOutcomeEnum.BlockedDuplicateIdentityDocument: {
        this.warningDuplicates.set([]);
        this.blockingDuplicates.set(candidatesFromHits(result.candidates));
        this._snackbarService.error('Création bloquée', 'Cette pièce d’identité appartient déjà à un client existant.');
        return;
      }

      case CreateClientResultOutcomeEnum.WarningPossibleDuplicatePhone: {
        this.blockingDuplicates.set([]);
        this.warningDuplicates.set(candidatesFromHits(result.candidates));
        this._snackbarService.info('Doublon possible', 'Vérifiez les fiches proposées avant de confirmer la création.');
        return;
      }

      default:
        this._snackbarService.error('Erreur', "Réponse inattendue du serveur, le client n'a pas été créé.");
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
      message: 'Les informations saisies seront perdues. Voulez-vous vraiment quitter ?',
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
