import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  apply,
  form,
  FormField,
  FormRoot,
  maxLength,
  readonly,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  ActivityDto,
  EnrichLeadRequest,
  FormFieldReferenceTargetEnum,
  LeadDto,
  LeadsApiService,
  LogActivityRequestTypeEnum,
} from '@sankore/crm-api';
import {
  EntityFormReferences,
  PERMISSIONS,
  PermissionsService,
  PersonIdentityModel,
  identityToDto,
  personIdentitySchema,
} from '@sankore/crm/common';
import { ConvertedLeadNotice } from './converted-lead-notice';
import { LeadEditContext } from './lead-edit-context';
import { LogActivityDrawer, LogActivityDrawerData } from './log-activity-drawer';
import {
  AddressPart,
  AddressPartKey,
  ageOf,
  countryFromPhone,
  displayName,
  formatDay,
  isSelfServiceCapture,
  missingAddressParts,
  nameNeedsCheck,
  originLabel,
  originPhrase,
} from './lead-view.models';

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  Call: 'Appel',
  Meeting: 'Rendez-vous',
  Visit: 'Visite',
};

/** Les activités où l'on a pu parler au prospect de son identité. */
const CONFIRMING_TYPES = new Set(Object.keys(ACTIVITY_TYPE_LABELS));

/**
 * L'identité telle que l'onglet l'édite. Le cœur reste le `PersonIdentityModel` partagé avec la
 * fiche client — sa validation vient avec — et le quartier et le point de repère, que seul le lead
 * porte, sont à côté. La boîte postale est `identity.postalCode`.
 */
class LeadIdentityFormModel {
  public identity!: PersonIdentityModel;
  public neighbourhood!: string;
  public landmark!: string;

  public static fromLead(lead: LeadDto | null | undefined): LeadIdentityFormModel {
    const m = new LeadIdentityFormModel();
    const address = lead?.address;
    m.identity = PersonIdentityModel.fromDto({
      firstName: lead?.firstName,
      lastName: lead?.lastName,
      usageName: lead?.usageName,
      birthDate: lead?.dateOfBirth,
      gender: lead?.gender === 'Male' || lead?.gender === 'Female' || lead?.gender === 'Other' ? lead.gender : null,
      addressLine: address?.addressLine,
      postalCode: address?.postalCode,
      city: address?.city,
      countryCode: address?.countryCode,
    });
    m.neighbourhood = address?.neighbourhood ?? '';
    m.landmark = address?.landmark ?? '';
    return m;
  }
}

/** Le rattachement de l'identité à l'appel ou à la visite qui l'a confirmée. */
class AttachSourceFormModel {
  public activityId!: string;

  public static instantiate(): AttachSourceFormModel {
    const m = new AttachSourceFormModel();
    m.activityId = '';
    return m;
  }
}

/** Onglet « Identité » de la fiche lead : état civil, adresse, et d'où viennent ces informations. */
@Component({
  selector: 'lead-identite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './identite.html',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    FormRoot,
    FormField,
    Button,
    TasCard,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasIcon,
    TasInput,
    TasDatePicker,
    TasSelect,
    ConvertedLeadNotice,
  ],
})
export class LeadIdentite {
  private readonly _context = inject(LeadEditContext);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _references = inject(EntityFormReferences);

  public readonly formatDay = formatDay;

  /**
   * Le contrat ne porte pas de `canEdit` côté lead : un lead converti est figé
   * (`LeadEditContext.isReadOnly()`) et la modification exige `lead:update`. L'assignation reste
   * arbitrée par le serveur, qui répond 403.
   */
  public readonly hasUpdatePermission = this._permissions.can(PERMISSIONS.LEAD_UPDATE);
  public readonly canEdit = computed(() => this.hasUpdatePermission() && !this._context.isReadOnly());

  public readonly lead = this._context.lead;
  public readonly name = computed(() => displayName(this.lead()));
  public readonly countries = toSignal(this._references.options(FormFieldReferenceTargetEnum.Country), {
    initialValue: [],
  });
  public readonly activities = signal<ActivityDto[]>([]);
  public readonly submitError = signal<string | null>(null);
  public readonly isVerifyingName = signal(false);
  public readonly showAttach = signal(false);

  public model = signal(LeadIdentityFormModel.fromLead(null));

  public formSchema = form(this.model, (schema) => {
    apply(schema.identity, personIdentitySchema);
    readonly(schema, { when: () => !this.canEdit() });
    validate(schema.identity.birthDate, (ctx) => {
      const value = ctx.value();
      return value && value > todayISODate()
        ? { kind: 'max', message: 'La date de naissance ne peut pas être dans le futur' }
        : null;
    });
    maxLength(schema.identity.city, 100, { message: 'La ville ne peut pas dépasser 100 caractères' });
    maxLength(schema.neighbourhood, 100, { message: 'Le quartier ne peut pas dépasser 100 caractères' });
    maxLength(schema.landmark, 200, { message: 'Le point de repère ne peut pas dépasser 200 caractères' });
    maxLength(schema.identity.addressLine, 300, { message: "L'adresse ne peut pas dépasser 300 caractères" });
    maxLength(schema.identity.postalCode, 20, { message: 'La boîte postale ne peut pas dépasser 20 caractères' });
  });

  public attachModel = signal(AttachSourceFormModel.instantiate());
  public attachSchema = form(this.attachModel, (schema) => {
    required(schema.activityId, { message: "Choisissez l'appel ou la visite" });
  });

  // ——— Ce que l'en-tête et les cartes affichent ———

  /** Calculé sur ce que l'agent est en train de saisir, pour que les pastilles disparaissent à la frappe. */
  public readonly missingParts = computed(() => {
    const value = this.model();
    return missingAddressParts({
      countryCode: value.identity.countryCode,
      city: value.identity.city,
      neighbourhood: value.neighbourhood,
      landmark: value.landmark,
    });
  });
  public readonly missingPoints = computed(() => this.missingParts().reduce((sum, p) => sum + p.points, 0));

  /**
   * « … et lui fait atteindre le seuil de qualification » — seulement quand c'est vrai : le score
   * actuel plus les points de l'adresse franchissent le seuil, et il ne l'a pas déjà franchi.
   */
  public readonly reachesThreshold = computed(() => {
    const lead = this.lead();
    const threshold = lead?.qualificationThreshold;
    if (!lead || threshold == null) return false;
    const score = lead.score ?? 0;
    return score < threshold && score + this.missingPoints() >= threshold;
  });

  public readonly pointsFor = (key: AddressPartKey): AddressPart | null =>
    this.missingParts().find((p) => p.key === key) ?? null;

  public readonly age = computed(() => ageOf(this.model().identity.birthDate));
  public readonly nameToCheck = computed(() => nameNeedsCheck(this.lead()));

  /** « Déduit de l'indicatif +225 » — proposé tant qu'aucun pays n'est saisi. */
  public readonly suggestedCountry = computed(() => {
    if (this.model().identity.countryCode) return null;
    const guess = countryFromPhone(this.lead()?.phoneNumber);
    if (!guess) return null;
    const label = this.countries().find((c) => c.value === guess.country)?.label;
    return label ? { ...guess, label } : null;
  });

  public readonly genderChoices = [
    { value: 'Male', label: 'Homme' },
    { value: 'Female', label: 'Femme' },
  ];

  // ——— D'où viennent ces informations ———

  public readonly selfService = computed(() => isSelfServiceCapture(this.lead()));
  public readonly origin = computed(() => originLabel(this.lead()));
  public readonly originSentence = computed(() => {
    const lead = this.lead();
    if (!lead) return '';
    const day = formatDay(lead.capturedAt, true);
    if (this.selfService() && this.origin() !== '—') {
      return `Saisie par le prospect via ${this.origin()} le ${day} (déclaratif).`;
    }
    const phrase = originPhrase(lead);
    return phrase ? `Saisie ${phrase} le ${day}.` : `Saisie le ${day}.`;
  });

  public readonly confirmingActivities = computed(() =>
    this.activities().filter((a) => CONFIRMING_TYPES.has(a.type ?? '')),
  );
  public readonly activityOptions = computed(() =>
    this.confirmingActivities().map((a) => ({ value: a.id ?? '', label: this.activityLabel(a) })),
  );
  public readonly confirmedBy = computed(() => {
    const id = this.lead()?.identitySourceActivityId;
    if (!id) return null;
    return this.activities().find((a) => a.id === id) ?? null;
  });

  constructor() {
    // Le lead revient après chaque enregistrement et à chaque relecture de la coque (actions,
    // polling de 30 s) : on repose le modèle pour montrer ce que le serveur a retenu — sauf quand
    // l'agent est en train de saisir, que le polling effacerait sinon sous ses doigts.
    effect(() => {
      const lead = this.lead();
      untracked(() => {
        if (this.formSchema().dirty()) return;
        this.model.set(LeadIdentityFormModel.fromLead(lead));
      });
    });

    effect(() => {
      const id = this.lead()?.id;
      if (id) untracked(() => this._loadActivities(id));
    });
  }

  public setGender(value: string): void {
    if (!this.canEdit()) return;
    this.formSchema.identity.gender().value.set(value);
    this.formSchema.identity.gender().markAsDirty();
  }

  public acceptSuggestedCountry(): void {
    const suggestion = this.suggestedCountry();
    if (!suggestion || !this.canEdit()) return;
    this.formSchema.identity.countryCode().value.set(suggestion.country);
    this.formSchema.identity.countryCode().markAsDirty();
  }

  /** Une pastille « + Ville · +8 » mène au champ. */
  public focusPart(key: AddressPartKey): void {
    document.getElementById(`identite-${key}`)?.focus();
  }

  public cancel(): void {
    this.submitError.set(null);
    this.formSchema().reset(LeadIdentityFormModel.fromLead(this.lead()));
  }

  public handleSubmit(): void {
    this._save(false);
  }

  /**
   * « C'est vérifié » : enregistre la confirmation, avec les corrections en cours quand l'agent a
   * retouché le nom avant de cliquer — confirmer un nom et laisser sa correction en plan serait
   * confirmer la mauvaise orthographe.
   */
  public verifyName(): void {
    if (this.formSchema().dirty()) {
      this._save(true);
      return;
    }
    const lead = this.lead();
    if (!lead?.id) return;
    this.isVerifyingName.set(true);
    this._leadsApi.enrichLead(lead.id, { nameVerified: true, expectedUpdatedAt: lead.updatedAt ?? null }).pipe(
      catchError((error: HttpErrorResponse) => {
        this.isVerifyingName.set(false);
        this._snackbar.error('Erreur', this._errorMessage(error));
        return EMPTY;
      }),
    ).subscribe(() => {
      this.isVerifyingName.set(false);
      this._snackbar.success('Nom vérifié', "L'orthographe du nom est confirmée.");
      this._context.reload();
    });
  }

  public attachSource(): void {
    submit(this.attachSchema, async (field) => {
      const lead = this.lead();
      if (!lead?.id) return;
      const done = await firstValueFrom(
        this._leadsApi.enrichLead(lead.id, {
          sourceActivityId: field().value().activityId,
          expectedUpdatedAt: lead.updatedAt ?? null,
        }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!done) return;
      this._snackbar.success('Rattachée', "L'identité est rattachée à cet échange.");
      this.showAttach.set(false);
      this.attachSchema().reset(AttachSourceFormModel.instantiate());
      this._context.reload();
    });
  }

  /** Pas encore d'appel à rattacher : on le note d'abord, puis il apparaît dans la liste. */
  public logCall(): void {
    const lead = this.lead();
    if (!lead?.id) return;
    const data: LogActivityDrawerData = {
      leadId: lead.id,
      leadName: displayName(lead),
      initialType: LogActivityRequestTypeEnum.Call,
    };
    const ref = this._sideDrawer.open(LogActivityDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });
    ref.closed.subscribe((result) => {
      if (!result) return;
      this._loadActivities(lead.id!);
      this._context.reload();
    });
  }

  public activityLabel(activity: ActivityDto): string {
    const type = ACTIVITY_TYPE_LABELS[activity.type ?? ''] ?? 'Échange';
    const day = formatDay(activity.performedAt ?? activity.scheduledAt ?? null, true);
    const subject = activity.subject?.trim();
    return [`${type} du ${day}`, subject].filter(Boolean).join(' — ');
  }

  private _save(nameVerified: boolean): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const lead = this.lead();
      if (!lead?.id) return;
      const value = field().value();
      const identity = identityToDto(value.identity);

      // Les champs vides partent en chaîne vide et non en null : pour `enrich`, null veut dire
      // « ne pas toucher » et vide veut dire « effacer ». Un repère effacé ici doit l'être là-bas.
      const request: EnrichLeadRequest = {
        firstName: identity.firstName,
        lastName: identity.lastName,
        usageName: identity.usageName ?? '',
        birthDate: identity.birthDate,
        gender: identity.gender,
        addressLine: identity.addressLine ?? '',
        postalCode: identity.postalCode ?? '',
        city: identity.city ?? '',
        countryCode: identity.countryCode ?? '',
        neighbourhood: value.neighbourhood.trim(),
        landmark: value.landmark.trim(),
        nameVerified,
        expectedUpdatedAt: lead.updatedAt ?? null,
      };

      const saved = await firstValueFrom(
        this._leadsApi.enrichLead(lead.id, request).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            const message = this._errorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Erreur', message);
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!saved) return;

      this._snackbar.success('Identité enregistrée', "L'identité et l'adresse du prospect sont à jour.");
      // Pristine d'abord, pour que la relecture du lead repose le modèle : le score recalculé par
      // le serveur, le jeton de concurrence et le badge du menu viennent tous de là.
      this.formSchema().reset();
      this._context.reload();
    });
  }

  private _loadActivities(leadId: string): void {
    this._leadsApi
      .listLeadActivities(leadId, 1, 50)
      .pipe(
        map((activities) => activities ?? []),
        catchError(() => EMPTY),
      )
      .subscribe((activities) => this.activities.set(activities));
  }

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return "Vous n'êtes pas autorisé à modifier ce lead : il doit vous être assigné ou délégué.";
    }
    if (error.status === 409) {
      return 'La fiche a été modifiée entre-temps. Rechargez la page avant de réessayer.';
    }
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors ? Object.values(validationErrors).flat()[0] : undefined;
    return firstError ?? error.error?.title ?? "Impossible d'enregistrer l'identité.";
  }

}

export default LeadIdentite;
