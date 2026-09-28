import { Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import {
  email as emailValidator,
  form,
  FormField,
  FormRoot,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { PermissionsService } from '@sankore/crm/common';
import {
  ConvertLeadRequest,
  ConvertLeadResult,
  DuplicateMatchResult,
  LeadDto,
  LeadsApiService,
  UpdateLeadRequest,
  UpdateLeadRequestGenderEnum,
} from '@sankore/crm-api';
import { GENDER_OPTIONS, genderLabel } from './edit-lead-info-drawer';

export interface ConvertLeadWizardData {
  lead: LeadDto;
}

/**
 * `clientId` est l'identifiant de la fiche client à ouvrir : celle que la conversion vient de
 * créer, ou celle à laquelle le lead a été rattaché sur décision de l'utilisateur.
 */
export interface ConvertLeadWizardResult {
  clientId: string;
  converted: boolean;
}

type Step = 'recap' | 'complete' | 'duplicate';

interface EligibilityCheck {
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * Champs que le module Clients attend mais que le lead ne porte jamais : le contrat de conversion
 * (`ConvertLeadRequest`) n'accepte aucune donnée complémentaire, ils se saisissent donc sur la
 * fiche client, après création.
 */
const CLIENT_ONLY_FIELDS = [
  'Adresse postale',
  'Situation matrimoniale',
  'Nationalité et lieu de naissance',
  'Profession et employeur',
  'Revenus déclarés',
];

function todayISODate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** `LeadDto.gender` arrive en chaîne numérique ; '0' vaut « Non précisé », donc pas renseigné. */
function hasGender(lead: LeadDto): boolean {
  const gender = lead.gender == null ? '' : String(lead.gender);
  return gender !== '' && gender !== '0';
}

/**
 * Les seuls champs manquants que l'agent peut encore corriger avant la conversion : ceux que
 * `UpdateLeadRequest` couvre. Tout le reste ne partirait nulle part depuis cet écran.
 */
function missingOnLead(lead: LeadDto): string[] {
  const missing: string[] = [];
  if (!lead.firstName) missing.push('Prénom');
  if (!lead.lastName) missing.push('Nom');
  if (!hasGender(lead)) missing.push('Genre');
  if (!lead.dateOfBirth) missing.push('Date de naissance');
  if (!lead.email) missing.push('E-mail');
  return missing;
}

/** Ce qui restera à compléter sur la fiche client une fois le lead converti. */
function missingOnClient(lead: LeadDto): string[] {
  const missing = [...CLIENT_ONLY_FIELDS];
  missing.unshift(
    lead.nationalId
      ? "Type de pièce d'identité (le lead n'en porte que le numéro)"
      : "Pièce d'identité (type et numéro)",
  );
  return missing;
}

export class CompleteLeadFormModel {
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  /** Chaîne numérique '0'..'3' : `UpdateLeadRequest.gender` est un entier, converti à la soumission. */
  public gender!: string;
  public dateOfBirth!: string;

  public static fromLead(lead: LeadDto): CompleteLeadFormModel {
    const m = new CompleteLeadFormModel();
    m.firstName = lead.firstName ?? '';
    m.lastName = lead.lastName ?? '';
    m.email = lead.email ?? '';
    m.gender = lead.gender != null ? String(lead.gender) : '';
    m.dateOfBirth = lead.dateOfBirth ?? '';
    return m;
  }
}

@Component({
  selector: 'convert-lead-wizard',
  templateUrl: './convert-lead-wizard.html',
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasTag,
    Button,
    TasCard,
    TasTitle,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasDatePicker,
    FormRoot,
    FormField,
  ],
})
export class ConvertLeadWizard {
  public readonly data: ConvertLeadWizardData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<ConvertLeadWizardResult | false>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly canConvert = this._permissions.can('lead:convert');
  public readonly canReadCustomers = this._permissions.can('customers:read');

  public readonly genderOptions = GENDER_OPTIONS;

  /** Rechargé après un complément de saisie : le récapitulatif doit refléter le lead à jour. */
  public lead = signal<LeadDto>(this.data.lead);
  public currentStep = signal<Step>('recap');

  /** Garde de réentrance : testée en première ligne de chaque action d'écriture. */
  public isSubmitting = signal(false);
  public duplicates = signal<DuplicateMatchResult[]>([]);

  public model = signal(CompleteLeadFormModel.fromLead(this.data.lead));

  public formSchema = form(this.model, (schema) => {
    required(schema.firstName, { message: 'Le prénom est obligatoire' });
    required(schema.lastName, { message: 'Le nom est obligatoire' });
    emailValidator(schema.email, { message: 'Adresse e-mail invalide' });

    // '0' est le « Non précisé » du lead : l'accepter ici viderait le sens de cette étape.
    validate(schema.gender, (ctx) => {
      const value = ctx.value();
      return value === '' || value === '0'
        ? { kind: 'required', message: 'Précisez le genre' }
        : null;
    });

    required(schema.dateOfBirth, { message: 'La date de naissance est obligatoire' });
    validate(schema.dateOfBirth, (ctx) => {
      const value = ctx.value();
      if (!value) return null;
      return value > todayISODate()
        ? { kind: 'max', message: 'La date de naissance ne peut pas être dans le futur' }
        : null;
    });
  });

  public readonly missingOnLead = computed(() => missingOnLead(this.lead()));
  public readonly missingOnClient = computed(() => missingOnClient(this.lead()));

  public readonly genderText = computed(() => genderLabel(this.lead().gender));

  public readonly eligibilityChecks = computed<EligibilityCheck[]>(() => {
    const lead = this.lead();
    const checks: EligibilityCheck[] = [];

    const status = lead.status ?? '';
    const isQualified = ['Qualified', 'Qualifying', 'Contacted'].includes(status);
    checks.push({
      label: 'Statut du lead',
      passed: isQualified,
      detail: isQualified
        ? `Statut actuel : ${status}`
        : `Le lead doit être au moins « Contacté » (actuellement : ${status || '—'})`,
    });

    const completeness = lead.qualificationCompleteness?? 0;
    const qualOk = (completeness * 100) >= 50;
    checks.push({
      label: 'Qualification',
      passed: qualOk,
      detail: qualOk
        ? `Qualification à ${completeness * 100}%`
        : `Qualification insuffisante (${completeness * 100}% — minimum 50% requis)`,
    });

    const hasContact = !!(lead.phoneNumber || lead.email);
    checks.push({
      label: 'Coordonnées',
      passed: hasContact,
      detail: hasContact
        ? 'Téléphone ou e-mail renseigné'
        : 'Un téléphone ou un e-mail est requis',
    });

    checks.push({
      label: 'Droits',
      passed: this.canConvert(),
      detail: this.canConvert()
        ? 'Vous pouvez convertir ce lead'
        : 'Le droit « Convertir un lead » est requis',
    });

    return checks;
  });

  public readonly isEligible = computed(() =>
    this.eligibilityChecks().every((c) => c.passed),
  );

  public leadDisplayName(): string {
    const l = this.lead();
    if (l.fullName) return l.fullName;
    const parts = [l.firstName, l.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : l.phoneNumber ?? l.email ?? 'Lead';
  }

  /** Un lead déjà converti porte la fiche client à rattacher ; les autres n'en ont aucune. */
  public canAttach(duplicate: DuplicateMatchResult): boolean {
    return duplicate.status === 'Converted' && !!duplicate.leadId;
  }

  public goToComplete(): void {
    this.currentStep.set('complete');
  }

  public onBack(): void {
    switch (this.currentStep()) {
      case 'recap':
        this.close();
        break;
      default:
        this.currentStep.set('recap');
        break;
    }
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  /**
   * Conversion nominale : aucun `customerId` dans la requête, ce qui demande au serveur de créer
   * la fiche client à partir du lead. L'appel est idempotent sur le lead source côté serveur —
   * la garde `isSubmitting` évite seulement l'aller-retour inutile d'un double clic.
   */
  public handleConvert(): void {
    if (this.isSubmitting()) return;
    if (!this.isEligible()) return;
    this.isSubmitting.set(true);
    this._convert({}).finally(() => this.isSubmitting.set(false));
  }

  /** « Ce n'est pas la même personne » : passe outre la détection de doublons du serveur. */
  public forceConvert(): void {
    if (this.isSubmitting()) return;
    this.isSubmitting.set(true);
    this._convert({ force: true }).finally(() => this.isSubmitting.set(false));
  }

  /** Rattache le lead à la fiche client du prospect similaire plutôt que d'en créer une seconde. */
  public attachToDuplicate(duplicate: DuplicateMatchResult): void {
    if (this.isSubmitting()) return;
    const duplicateLeadId = duplicate.leadId;
    if (!duplicateLeadId) return;

    this.isSubmitting.set(true);
    this._resolveCustomerId(duplicateLeadId)
      .then(async (customerId) => {
        if (!customerId) {
          this._snackbar.error(
            'Rattachement impossible',
            "Ce prospect n'est relié à aucune fiche client. Convertissez-le d'abord, ou créez un nouveau client.",
          );
          return;
        }
        await this._convert({ customerId });
      })
      .finally(() => this.isSubmitting.set(false));
  }

  /** Complète sur le lead les champs que `UpdateLeadRequest` couvre, puis revient au récapitulatif. */
  public handleCompleteLead(): void {
    if (this.isSubmitting()) return;

    submit(this.formSchema, async (field) => {
      if (this.isSubmitting()) return;
      this.isSubmitting.set(true);

      try {
        const value = field()?.value();
        if (!value) return;

        const lead = this.lead();
        const leadId = lead.id ?? '';
        const nameChanged =
          value.firstName !== (lead.firstName ?? '') ||
          value.lastName !== (lead.lastName ?? '');
        const derivedFullName = [value.firstName, value.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();

        // `PUT /leads/{id}` remplace tout le contrat : les champs que ce formulaire n'expose pas
        // sont renvoyés tels quels, sinon la conversion partirait d'un lead amputé de son intérêt
        // commercial, de ses coordonnées GPS ou de son commentaire.
        const request: UpdateLeadRequest = {
          fullName: nameChanged && derivedFullName ? derivedFullName : lead.fullName ?? null,
          firstName: value.firstName.trim() || null,
          lastName: value.lastName.trim() || null,
          email: value.email.trim() || null,
          gender:
            value.gender !== ''
              ? (Number(value.gender) as UpdateLeadRequestGenderEnum)
              : null,
          dateOfBirth: value.dateOfBirth || null,
          interestedProduct: lead.interestedProduct ?? null,
          desiredAmount: lead.desiredAmount?.amount ?? null,
          desiredCurrency: lead.desiredAmount?.currency ?? null,
          preferredLanguage: lead.preferredLanguage ?? null,
          campaign: lead.campaign ?? null,
          comment: lead.comment ?? null,
          latitude: lead.latitude ?? null,
          longitude: lead.longitude ?? null,
          preferredAgencyId: lead.preferredAgencyId ?? null,
          expectedUpdatedAt: lead.updatedAt ?? null,
        };

        const saved = await firstValueFrom(
          this._leadsApi.updateLead(leadId, request).pipe(
            // 204 No Content : sans ce `map`, `firstValueFrom` résout sur `null` et le succès
            // serait indiscernable d'une erreur avalée.
            map(() => true),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Erreur', this._errorMessage(error));
              return of(false);
            }),
          ),
        );
        if (!saved) return;

        await this._reloadLead(leadId);
        this._snackbar.success(
          'Lead complété',
          'Les informations sont enregistrées sur le lead.',
        );
        this.currentStep.set('recap');
      } finally {
        this.isSubmitting.set(false);
      }
    });
  }

  private async _convert(request: ConvertLeadRequest): Promise<void> {
    const leadId = this.lead().id ?? '';

    const result = await firstValueFrom(
      this._leadsApi.convertLead(leadId, request).pipe(
        catchError((error: HttpErrorResponse) => {
          // 409 : le serveur renvoie un `ConvertLeadResult` porteur des doublons dans le corps
          // d'erreur — ce n'est pas une panne, c'est la réponse métier à traiter.
          const body = error.status === 409 ? (error.error as ConvertLeadResult) : null;
          if (body?.duplicateDetected) return of(body);
          this._snackbar.error('Erreur', this._errorMessage(error));
          // `of(null)` et non `EMPTY` : `firstValueFrom` rejette sur un flux vide, et la promesse
          // cassée remonterait hors de l'action sans message utile.
          return of(null);
        }),
      ),
    );

    if (!result) return;

    if (result.duplicateDetected && (result.potentialDuplicates?.length ?? 0) > 0) {
      this.duplicates.set(result.potentialDuplicates ?? []);
      this.currentStep.set('duplicate');
      // `SnackbarService` n'expose pas `warning` : un avertissement passe par `info`.
      this._snackbar.info(
        'Doublons détectés',
        'Le serveur a identifié des prospects similaires.',
      );
      return;
    }

    if (!result.customerId) {
      this._snackbar.error(
        'Erreur',
        "La conversion n'a pas renvoyé d'identifiant client. Vérifiez la fiche dans le module Clients.",
      );
      return;
    }

    this._snackbar.success(
      'Lead converti en client',
      'La fiche client est créée, en attente de validation KYC.',
    );
    this._dialogRef.close({ clientId: result.customerId, converted: true });
  }

  /**
   * `DuplicateMatchResult` ne porte que l'identifiant du **lead** similaire, jamais celui de son
   * client, alors que `ConvertLeadRequest.customerId` attend un uuid de client. Envoyer le
   * `leadId` rattacherait le lead à un dossier qui n'existe pas : on relit donc le lead similaire
   * pour récupérer son `convertedToCustomerId`.
   */
  private async _resolveCustomerId(duplicateLeadId: string): Promise<string | null> {
    const duplicate = await firstValueFrom(
      this._leadsApi.getLead(duplicateLeadId).pipe(catchError(() => of(null))),
    );
    return duplicate?.convertedToCustomerId ?? null;
  }

  private async _reloadLead(leadId: string): Promise<void> {
    const refreshed = await firstValueFrom(
      this._leadsApi.getLead(leadId).pipe(catchError(() => of(null))),
    );
    if (!refreshed) return;
    this.lead.set(refreshed);
    this.model.set(CompleteLeadFormModel.fromLead(refreshed));
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    return (
      firstError ??
      error.error?.detail ??
      error.error?.title ??
      error.error?.code ??
      'La conversion a échoué. Veuillez réessayer.'
    );
  }
}
