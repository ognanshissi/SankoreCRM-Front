import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
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
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasTitle } from '@talisoft/ui/title';
import {
  completenessGapSection,
  CompletenessGapView,
  CompletenessGauge,
  ComplianceConfigService,
  FatcaStatusBadge,
  fatcaStatusLabel,
  householdMemberFromLead,
  HouseholdMembersList,
  HouseholdMemberView,
  PepExposureBadge,
  pepFromDto,
  pepLinkLabel,
  PERMISSIONS,
  PermissionsService,
} from '@sankore/crm/common';
import {
  ConvertLeadRequest,
  ConvertLeadResult,
  DuplicateMatchResult,
  LeadCompletenessDto,
  LeadDto,
  LeadsApiService,
  UpdateLeadRequest,
  UpdateLeadRequestGenderEnum,
} from '@sankore/crm-api';
import { GENDER_OPTIONS, genderFromLead, genderLabel } from './edit-lead-info-drawer';
import { LeadComplianceStore } from './lead-compliance-store';

export interface ConvertLeadWizardData {
  lead: LeadDto;
  /**
   * Le projet pour lequel le dossier s'ouvre : c'est SON produit qui décide du KYC et des champs
   * exigés. Absent depuis la fiche du lead : le serveur prend son unique projet ouvert, sinon le
   * produit demandé.
   */
  projectId?: string | null;
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

/** Résultat de conversion accompagné du canal par lequel il est arrivé (200 ou 409). */
interface ConvertOutcome {
  accepted: boolean;
  result: ConvertLeadResult;
}

/** Statut FATCA d'une personne du dossier, tel que le récapitulatif l'affiche. */
interface FatcaRow {
  subjectLabel: string;
  status: string | null;
  statusLabel: string;
  reason: string | null;
}

/** Une personne exposée PPE, avec son lien et — si le droit le permet — sa fonction. */
interface PepRow {
  subjectLabel: string;
  linkLabel: string;
  function: string | null;
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

/**
 * Motifs de refus connus de la conversion. Le contrat déclare `blockingCode` en chaîne libre,
 * sans énumération : un code inconnu ne doit donc jamais bloquer l'écran — il est rendu tel quel
 * à côté d'un libellé générique, ce qui laisse au support une information exploitable.
 */
const BLOCKING_CODE: Record<string, string> = {
  INCOMPLETE: "Le dossier n'est pas complet.",
  FILE_INCOMPLETE: "Le dossier n'est pas complet.",
  COMPLETENESS_NOT_MET: "Le dossier n'est pas complet.",
  MISSING_QUESTIONNAIRE: "Un questionnaire obligatoire n'est pas complété.",
  MISSING_QUESTIONNAIRES: "Un questionnaire obligatoire n'est pas complété.",
  QUESTIONNAIRE_MISSING: "Un questionnaire obligatoire n'est pas complété.",
  FATCA_REQUIRED: 'La déclaration FATCA est obligatoire avant conversion.',
  FATCA_DECLARATION_MISSING: 'La déclaration FATCA est obligatoire avant conversion.',
  PEP_REVIEW_REQUIRED: "L'exposition PPE doit être validée par la conformité.",
  CONSENT_MISSING: 'Un consentement obligatoire manque au dossier.',
  DUPLICATE_DETECTED: 'Des prospects similaires ont été détectés.',
  CUSTOMER_EXISTS: 'Un client existe déjà pour cette personne.',
  ALREADY_CONVERTED: 'Ce lead est déjà converti.',
  KYC_INVALID: "Le dossier KYC n'est pas valide.",
};

function blockingCodeLabel(code: string | null | undefined): string {
  if (!code) return 'La conversion a été refusée par le serveur.';
  return BLOCKING_CODE[code] ?? 'La conversion a été refusée par le serveur.';
}

function todayISODate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * « Unknown » est le « Non précisé » du contrat : un lead qui le porte n'a pas de genre renseigné,
 * et cette étape de complétion a bien quelque chose à demander. `genderFromLead` accepte aussi les
 * anciens indices ('0'..'3') encore présents sur les fiches écrites avant la bascule.
 */
function hasGender(lead: LeadDto): boolean {
  const gender = genderFromLead(lead.gender);
  return gender !== '' && gender !== UpdateLeadRequestGenderEnum.Unknown;
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

/** Libellé de la personne concernée par une déclaration FATCA ou un questionnaire. */
function subjectFallback(subjectType: string | null | undefined): string {
  switch (subjectType) {
    case 'Principal':
      return 'Titulaire principal';
    case 'Spouse':
      return 'Conjoint';
    case 'Child':
      return 'Enfant';
    case 'Dependent':
      return 'Personne à charge';
    default:
      return 'Dossier';
  }
}

export class CompleteLeadFormModel {
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  /** Nom du contrat (`UpdateLeadRequestGenderEnum`), ou chaîne vide si non renseigné. */
  public gender!: string;
  public dateOfBirth!: string;

  public static fromLead(lead: LeadDto): CompleteLeadFormModel {
    const m = new CompleteLeadFormModel();
    m.firstName = lead.firstName ?? '';
    m.lastName = lead.lastName ?? '';
    m.email = lead.email ?? '';
    m.gender = genderFromLead(lead.gender);
    m.dateOfBirth = lead.dateOfBirth ?? '';
    return m;
  }
}

@Component({
  selector: 'convert-lead-wizard',
  templateUrl: './convert-lead-wizard.html',
  /**
   * Le store est fourni ici, et non repris de la route `leads/:id` : un drawer ouvert par
   * `SideDrawerService` est créé depuis l'injecteur racine du CDK (ni `injector` ni
   * `viewContainerRef` ne sont passés à `Dialog.open`), donc les fournisseurs de route sont hors
   * de portée. Une instance locale a l'avantage de relire le dossier au moment du contrôle :
   * c'est exactement la fraîcheur qu'on veut avant de convertir.
   */
  providers: [LeadComplianceStore],
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasTag,
    Button,
    TasCard,
    TasSpinner,
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
    CompletenessGauge,
    HouseholdMembersList,
    PepExposureBadge,
    FatcaStatusBadge,
  ],
})
export class ConvertLeadWizard implements OnInit {
  public readonly data: ConvertLeadWizardData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<ConvertLeadWizardResult | false>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _complianceConfig = inject(ComplianceConfigService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  public readonly compliance = inject(LeadComplianceStore);

  public readonly hasConvertPermission = this._permissions.can(PERMISSIONS.LEAD_CONVERT);
  public readonly canReadCustomers = this._permissions.can(PERMISSIONS.CUSTOMERS_READ);
  /** Sans ce droit, l'exposition PPE reste visible mais la fonction exercée est masquée. */
  public readonly canReadPep = this._permissions.can(PERMISSIONS.CUSTOMERS_PEP_READ);
  /**
   * Vigilance PPE du tenant (`pepEnabled` des réglages de conformité). Désactivée, aucun bloc
   * PPE n'est proposé : ni badge, ni détail, ni saisie.
   */
  public readonly pepEnabled = this._complianceConfig.pepEnabled;


  public readonly genderOptions = GENDER_OPTIONS;

  /** Rechargé après un complément de saisie : le récapitulatif doit refléter le lead à jour. */
  public lead = signal<LeadDto>(this.data.lead);
  public currentStep = signal<Step>('recap');

  /** Garde de réentrance : testée en première ligne de chaque action d'écriture. */
  public isSubmitting = signal(false);
  public duplicates = signal<DuplicateMatchResult[]>([]);

  /**
   * Complétude renvoyée par la conversion elle-même (corps du 409 comme du 200). Elle est plus
   * fraîche que celle du store : c'est celle que le serveur vient d'évaluer pour refuser.
   */
  public serverCompleteness = signal<LeadCompletenessDto | null>(null);
  /** Dernier refus serveur, affiché tel quel au-dessus du contrôle. */
  public refusal = signal<ConvertLeadResult | null>(null);

  public model = signal(CompleteLeadFormModel.fromLead(this.data.lead));

  public formSchema = form(this.model, (schema) => {
    required(schema.firstName, { message: 'Le prénom est obligatoire' });
    required(schema.lastName, { message: 'Le nom est obligatoire' });
    emailValidator(schema.email, { message: 'Adresse e-mail invalide' });

    // « Unknown » est le « Non précisé » du lead : l'accepter ici viderait le sens de cette étape.
    validate(schema.gender, (ctx) => {
      const value = ctx.value();
      return value === '' || value === UpdateLeadRequestGenderEnum.Unknown
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

  // ——— Contrôle avant conversion (BNF-F-08) : tout vient de l'API ———

  public readonly completeness = computed<LeadCompletenessDto | null>(
    () => this.serverCompleteness() ?? this.compliance.completeness(),
  );

  /** `canConvert` est une décision de l'API : jamais recalculée ici. */
  public readonly canConvert = computed(() => this.completeness()?.canConvert === true);

  /** La complétude n'a pas pu être lue : l'écran le dit, et laisse le serveur trancher. */
  public readonly completenessUnavailable = computed(
    () => !this.compliance.isLoading() && this.completeness() === null,
  );

  /**
   * Le bouton se désactive sur le `canConvert` de l'API, et seulement quand l'API a répondu :
   * si la complétude est indisponible, l'écran ne doit pas interdire une tentative que le serveur
   * refusera lui-même avec un motif (409).
   */
  public readonly convertBlocked = computed(() => {
    if (this.compliance.isLoading()) return true;
    if (this.completeness() === null) return false;
    return !this.canConvert();
  });

  public readonly members = computed<HouseholdMemberView[]>(() =>
    this.compliance.members().map(householdMemberFromLead),
  );

  public readonly principalIdentity = computed(() => this.compliance.principal());

  public readonly principalName = computed(
    () => this.compliance.principalLabel() || this.leadDisplayName(),
  );

  public readonly pepRows = computed<PepRow[]>(() => {
    const rows: PepRow[] = [];
    const household = this.compliance.household();
    if (!household) return rows;

    const principalPep = pepFromDto(household.principalPep);
    if (household.principalIsPepExposed === true || principalPep.isPep) {
      rows.push({
        subjectLabel: this.principalName(),
        linkLabel: pepLinkLabel(principalPep.link),
        function: principalPep.function,
      });
    }

    for (const member of this.members()) {
      if (!member.isPepExposed && !member.pep.isPep) continue;
      rows.push({
        subjectLabel: member.displayName,
        linkLabel: pepLinkLabel(member.pep.link),
        function: member.pep.function,
      });
    }
    return rows;
  });

  public readonly fatcaRows = computed<FatcaRow[]>(() => {
    const dto = this.compliance.fatca();
    if (!dto) return [];

    const rows: FatcaRow[] = (dto.declarations ?? [])
      .filter((declaration) => declaration.isActive !== false)
      .map((declaration) => ({
        subjectLabel:
          declaration.subjectLabel?.trim() || subjectFallback(declaration.subjectType),
        status: declaration.status ?? null,
        statusLabel: fatcaStatusLabel(declaration.status),
        reason: null,
      }));

    for (const missing of dto.missing ?? []) {
      rows.push({
        subjectLabel: missing.subjectLabel?.trim() || subjectFallback(missing.subjectType),
        status: null,
        statusLabel: 'Déclaration manquante',
        reason: missing.reason ?? null,
      });
    }
    return rows;
  });

  public readonly refusalLabel = computed(() => blockingCodeLabel(this.refusal()?.blockingCode));

  /**
   * Le lead a été capté pour un client déjà au portefeuille : la conversion ne crée aucune fiche,
   * elle ouvre une souscription (BNF-F-19). Le contrat n'expose pas de drapeau dédié —
   * `customerReference` (référence du client saisie à la capture) est le seul indice disponible.
   */
  public readonly isExistingCustomerLead = computed(() => {
    const lead = this.lead();
    return !!lead.customerId || !!lead.customerReference?.trim() || !!lead.convertedToCustomerId;
  });

  /** Le lead devient client à l'approbation d'un projet ; ici, on n'ouvre que son dossier. */
  public readonly primaryActionLabel = computed(() =>
    this.isExistingCustomerLead() ? 'Rattacher au dossier client' : 'Ouvrir le dossier client',
  );

  public ngOnInit(): void {
    const leadId = this.lead().id;
    if (leadId) this.compliance.load(leadId);
    this._loadProjectCompleteness();
  }

  /**
   * Ouvert depuis un projet, la jauge applique la politique du produit DE CE PROJET — celle que
   * l'ouverture du dossier vérifiera. La complétude du store, elle, suit le produit demandé par le
   * lead : affichée ici, elle disait « Dossier complet » avant un refus, ou l'inverse.
   */
  private _loadProjectCompleteness(): void {
    const leadId = this.lead().id;
    const projectId = this.data.projectId;
    if (!leadId || !projectId) return;
    this._leadsApi
      .getLeadCompleteness(leadId, projectId)
      .pipe(catchError(() => of(null)))
      .subscribe((report) => {
        if (report) this.serverCompleteness.set(report);
      });
  }

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

  /**
   * Chaque élément manquant renvoie à l'onglet où le corriger. La navigation est absolue plutôt
   * que relative (`../identite`) : un drawer n'a pas de `ActivatedRoute` — il est créé hors de
   * l'arbre de routes — et `['/leads', id, section]` est le même chemin.
   */
  public onGapSelected(gap: CompletenessGapView): void {
    const section = completenessGapSection(gap.code);
    if (section === 'client') {
      this._snackbar.info(
        'À corriger sur la fiche client',
        'Ce point se traite dans le module Clients, une fois la fiche créée.',
      );
      return;
    }

    const leadId = this.lead().id;
    if (!leadId) return;
    this._dialogRef.close(false);
    this._router.navigate(['/leads', leadId, section]);
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
    if (!this.hasConvertPermission()) return;
    if (this.convertBlocked()) return;
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

  /**
   * Rattachement au client que le serveur a lui-même désigné dans son refus
   * (`existingCustomerId`) : aucune fiche n'est créée, la demande devient une souscription.
   */
  public attachToExistingCustomer(): void {
    if (this.isSubmitting()) return;
    const customerId = this.refusal()?.existingCustomerId;
    if (!customerId) return;
    this.isSubmitting.set(true);
    this._convert({ customerId }).finally(() => this.isSubmitting.set(false));
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
          // Même correction que dans `edit-lead-info-drawer` : l'énumération est en chaînes, et
          // `Number('Male')` rendait `NaN`, donc `null` — le genre n'était jamais enregistré.
          gender: (value.gender || null) as UpdateLeadRequestGenderEnum | null,
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
        // Un 200 sur le lead périme la complétude : la jauge du récapitulatif doit la relire,
        // sinon l'écran continue d'afficher un manque qui vient d'être corrigé.
        this.serverCompleteness.set(null);
        this.refusal.set(null);
        this.compliance.reloadCompleteness().subscribe();
        this._loadProjectCompleteness();
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

    const outcome = await firstValueFrom(
      this._leadsApi.convertLead(leadId, { ...request, projectId: request.projectId ?? this.data.projectId ?? null }).pipe(
        map((result): ConvertOutcome => ({ accepted: true, result: result ?? {} })),
        catchError((error: HttpErrorResponse) => {
          // 409 et 422 : le serveur renvoie un `ConvertLeadResult` dans le corps d'erreur —
          // doublons, motif de blocage, complétude évaluée. Ce n'est pas une panne, c'est la
          // réponse métier à afficher, et elle vaut mieux qu'un message générique.
          const body =
            error.status === 409 || error.status === 422
              ? (error.error as ConvertLeadResult | null)
              : null;
          const isBusinessBody =
            !!body &&
            typeof body === 'object' &&
            (body.duplicateDetected === true ||
              !!body.blockingCode ||
              !!body.completeness ||
              !!body.existingCustomerId);
          if (isBusinessBody) {
            return of<ConvertOutcome>({ accepted: false, result: body as ConvertLeadResult });
          }
          this._snackbar.error('Erreur', this._errorMessage(error));
          // `of(null)` et non `EMPTY` : `firstValueFrom` rejette sur un flux vide, et la promesse
          // cassée remonterait hors de l'action sans message utile.
          return of(null);
        }),
      ),
    );

    if (!outcome) return;
    const result = outcome.result;

    // La complétude du corps de réponse est celle que le serveur vient d'évaluer : elle alimente
    // la jauge et la liste bloquante, même quand le store a une photo plus ancienne.
    if (result.completeness) this.serverCompleteness.set(result.completeness);

    if (!outcome.accepted) {
      this._handleRefusal(result);
      return;
    }

    // Rattachement à un client existant — demandé explicitement, ou décidé par le serveur :
    // aucune fiche n'est créée, on ouvre l'onglet des produits détenus où vit le brouillon.
    const attachedCustomerId = request.customerId ?? result.existingCustomerId ?? null;
    if (attachedCustomerId) {
      this._snackbar.success(
        'Rattaché au client existant',
        "Aucune fiche créée. Le lead deviendra client quand l'un de ses projets sera approuvé.",
      );
      this._dialogRef.close({ clientId: attachedCustomerId, converted: false });
      return;
    }

    if (!result.customerId) {
      this._snackbar.error(
        'Erreur',
        "L'ouverture du dossier n'a pas renvoyé d'identifiant client. Vérifiez la fiche dans le module Clients.",
      );
      return;
    }

    if (result.alreadyConverted === true) {
      this._snackbar.info('Dossier déjà ouvert', 'La fiche client de ce lead existe déjà.');
      this._dialogRef.close({ clientId: result.customerId, converted: result.leadConverted === true });
      return;
    }

    this._snackbar.success(
      'Dossier client ouvert',
      "Données reprises du lead. Il deviendra client quand l'un de ses projets sera approuvé.",
    );
    this._dialogRef.close({ clientId: result.customerId, converted: false });
  }

  /** Refus serveur : on reste sur l'écran et on montre pourquoi, au lieu d'un message générique. */
  private _handleRefusal(result: ConvertLeadResult): void {
    if (result.duplicateDetected === true && (result.potentialDuplicates?.length ?? 0) > 0) {
      this.duplicates.set(result.potentialDuplicates ?? []);
      this.currentStep.set('duplicate');
      // `SnackbarService` n'expose pas `warning` : un avertissement passe par `info`.
      this._snackbar.info(
        'Doublons détectés',
        'Le serveur a identifié des prospects similaires.',
      );
      return;
    }

    if (result.alreadyConverted === true && (result.customerId || result.existingCustomerId)) {
      const customerId = (result.customerId || result.existingCustomerId) as string;
      this._snackbar.info('Dossier déjà ouvert', 'La fiche client de ce lead existe déjà.');
      this._dialogRef.close({ clientId: customerId, converted: result.leadConverted === true });
      return;
    }

    this.refusal.set(result);
    this.currentStep.set('recap');
    this._snackbar.error('Ouverture refusée', this.refusalLabel());
    // Le refus signifie que la complétude du store est périmée : on la relit pour que la liste
    // bloquante affiche les mêmes manques que le serveur vient d'évaluer.
    this.compliance.reloadCompleteness().subscribe();
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
