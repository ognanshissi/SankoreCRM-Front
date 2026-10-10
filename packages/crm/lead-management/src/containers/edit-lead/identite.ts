import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  apply,
  form,
  FormField,
  FormRoot,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, EMPTY, finalize, firstValueFrom, forkJoin, map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  ActivityDto,
  EnrichLeadRequest,
  LeadsApiService,
  LeadsPersonIdentityDto,
} from '@sankore/crm-api';
import {
  CompletenessGapView,
  CompletenessGauge,
  PERMISSIONS,
  PermissionsService,
  PersonIdentityFields,
  PersonIdentityModel,
  completenessGapSection,
  genderLabel,
  identityToDto,
  personIdentitySchema,
} from '@sankore/crm/common';
import { ConvertedLeadNotice } from './converted-lead-notice';
import { LeadComplianceStore } from './lead-compliance-store';
import { LeadEditContext } from './lead-edit-context';

/** Une ligne du rendu en lecture seule. */
interface IdentityRow {
  label: string;
  value: string;
}

/** `yyyy-MM-dd` → `dd/MM/yyyy`, sans passer par `Date`. */
function frenchDate(value: string | null | undefined): string {
  const parts = (value ?? '').slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : '';
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  Call: 'Appel',
  Meeting: 'Réunion',
  Email: 'E-mail',
  Visit: 'Visite',
  Note: 'Note',
  Sms: 'SMS',
  WhatsApp: 'WhatsApp',
  Task: 'Tâche',
};

/**
 * Identité du principal et activité d'origine de l'enrichissement.
 *
 * `sourceActivityId` vit dans le même modèle que l'identité parce que le contrat
 * les porte dans **une seule** requête (`POST /leads/{id}/enrich`) : deux
 * formulaires séparés laisseraient enregistrer l'identité sans son rattachement.
 */
class LeadIdentityFormModel {
  public identity!: PersonIdentityModel;
  public sourceActivityId!: string;

  public static fromPrincipal(
    principal: LeadsPersonIdentityDto | null | undefined,
  ): LeadIdentityFormModel {
    const model = new LeadIdentityFormModel();
    model.identity = PersonIdentityModel.fromDto(principal);
    model.sourceActivityId = '';
    return model;
  }
}

/** Onglet « Identité du principal » de la fiche lead (BNF-F-02). */
@Component({
  selector: 'lead-identite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './identite.html',
  imports: [
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
    TasSelect,
    TasSpinner,
    CompletenessGauge,
    PersonIdentityFields,
    ConvertedLeadNotice,
  ],
})
export class LeadIdentite {
  protected readonly compliance = inject(LeadComplianceStore);
  private readonly _context = inject(LeadEditContext);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  private readonly _section = viewChild<ElementRef<HTMLElement>>('identiteSection');

  /**
   * Le contrat ne porte **pas** de `canEdit` côté lead : ni `LeadDto`, ni
   * `LeadHouseholdDto`, ni `LeadCompletenessDto` ne l'exposent (seuls
   * `ClientHouseholdDto` et `HoldingDto` l'ont). Plutôt que de fabriquer un faux
   * drapeau, on retombe sur ce qui existe déjà dans le repo : un lead converti
   * n'est plus modifiable (`LeadEditContext.isReadOnly()`) et la modification
   * exige `lead:update`. L'assignation et la délégation restent arbitrées par le
   * serveur, qui répondra 403 — c'est lui qui tranche, pas l'écran.
   */
  public readonly hasUpdatePermission = this._permissions.can(PERMISSIONS.LEAD_UPDATE);
  public readonly canEdit = computed(
    () => this.hasUpdatePermission() && !this._context.isReadOnly(),
  );

  public readonly activities = signal<ActivityDto[]>([]);
  public readonly submitError = signal<string | null>(null);

  /** Vrai quand l'API n'a renvoyé aucune des deux ressources de l'onglet. */
  private readonly _recovered = signal(false);
  public readonly hasFailed = computed(
    () => this.compliance.loadFailed() && !this._recovered(),
  );
  public readonly isRetrying = signal(false);

  /** Principal connu mais entièrement vide : l'écran doit le dire (BNF-F-02). */
  public readonly isPrincipalEmpty = computed(() => {
    const principal = this.compliance.principal();
    if (!principal) return true;
    return !Object.values(principal).some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
  });

  public readonly activityOptions = computed(() => [
    { label: 'Aucune activité rattachée', value: '' },
    ...this.activities().map((activity) => ({
      label: this._activityLabel(activity),
      value: activity.id ?? '',
    })),
  ]);

  public readonly readOnlyRows = computed<IdentityRow[]>(() => {
    const principal = this.compliance.principal();
    const rows: IdentityRow[] = [
      { label: 'Prénom', value: principal?.firstName ?? '' },
      { label: 'Nom', value: principal?.lastName ?? '' },
      { label: "Nom d'usage", value: principal?.usageName ?? '' },
      { label: 'Date de naissance', value: frenchDate(principal?.birthDate) },
      { label: 'Genre', value: principal?.gender ? genderLabel(principal.gender) : '' },
      { label: 'Adresse', value: principal?.addressLine ?? '' },
      { label: 'Code postal', value: principal?.postalCode ?? '' },
      { label: 'Ville', value: principal?.city ?? '' },
      { label: 'Pays', value: principal?.countryCode ?? '' },
    ];
    return rows.map((row) => ({ label: row.label, value: row.value.trim() || '—' }));
  });

  public model = signal(LeadIdentityFormModel.fromPrincipal(null));

  public formSchema = form(this.model, (schema) => {
    apply(schema.identity, personIdentitySchema);
    validate(schema.identity.birthDate, (ctx) => {
      const value = ctx.value();
      if (!value) return null;
      return value > todayISODate()
        ? { kind: 'max', message: 'La date de naissance ne peut pas être dans le futur' }
        : null;
    });
  });

  constructor() {
    // Le principal arrive après coup (foyer chargé en parallèle du lead) et
    // revient après chaque enregistrement : le modèle est reposé à chaque fois,
    // pour que le formulaire montre ce que le serveur a réellement retenu.
    effect(() => {
      const principal = this.compliance.principal();
      this.model.set(LeadIdentityFormModel.fromPrincipal(principal));
    });

    effect(() => {
      const leadId = this.compliance.leadId();
      if (leadId) this._loadActivities(leadId);
    });
  }

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const leadId = this.compliance.leadId();
      if (!leadId) return;

      const value = field().value();
      const identity = identityToDto(value.identity);

      // `productLineId` est volontairement absent et `clearProductLine` à false :
      // le même endpoint résout la ligne de produit, et cet onglet ne la touche
      // pas — l'omettre est la seule façon de ne pas l'effacer.
      const request: EnrichLeadRequest = {
        firstName: identity.firstName,
        lastName: identity.lastName,
        usageName: identity.usageName,
        birthDate: identity.birthDate,
        gender: identity.gender,
        addressLine: identity.addressLine,
        postalCode: identity.postalCode,
        city: identity.city,
        countryCode: identity.countryCode,
        clearProductLine: false,
        sourceActivityId: value.sourceActivityId || null,
        expectedUpdatedAt: this._context.lead()?.updatedAt ?? null,
      };

      const completeness = await firstValueFrom(
        this._leadsApi.enrichLead(leadId, request).pipe(
          catchError((error: HttpErrorResponse) => {
            const message = this._errorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Erreur', message);
            return EMPTY;
          }),
        ),
      );

      if (!completeness) return;

      this._snackbar.success(
        'Identité enregistrée',
        "L'identité du principal a été mise à jour.",
      );

      // Un 200 sur `enrich` ne dit rien du reste du dossier : la jauge et
      // l'identité du principal sont relues à la source plutôt que déduites de
      // la réponse.
      this.compliance.reloadCompleteness().subscribe();
      this.compliance.reloadHousehold().subscribe();
      this._refreshLeadToken(leadId);
    });
  }

  /** Clic sur un manquant de la jauge : on va là où l'agent peut agir. */
  public goToGap(gap: CompletenessGapView): void {
    const section = completenessGapSection(gap.code);

    if (section === 'identite') {
      this._section()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (section === 'client') {
      const customerId = this._context.customerId();
      if (!customerId) {
        this._snackbar.info(
          'Fiche client indisponible',
          "Ce point se corrige sur la fiche client, qui n'existe pas encore.",
        );
        return;
      }
      this._router.navigate(['/customers', customerId]);
      return;
    }

    this._router.navigate([`../${section}`], { relativeTo: this._route });
  }

  public retry(): void {
    this.isRetrying.set(true);
    forkJoin({
      household: this.compliance.reloadHousehold(),
      completeness: this.compliance.reloadCompleteness(),
    })
      .pipe(finalize(() => this.isRetrying.set(false)))
      .subscribe(({ household, completeness }) => {
        // `loadFailed()` n'est remis à plat que par `load()`, que la route ne
        // rejoue pas : on lève l'état d'erreur localement dès qu'une des deux
        // ressources répond.
        if (household || completeness) this._recovered.set(true);
      });
  }

  private _activityLabel(activity: ActivityDto): string {
    const type = ACTIVITY_TYPE_LABELS[activity.type ?? ''] ?? 'Activité';
    const date = frenchDate(activity.performedAt ?? activity.scheduledAt);
    const subject = activity.subject?.trim();
    const parts = [type, date, subject].filter((part) => !!part);
    return parts.join(' — ');
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

  /**
   * `expectedUpdatedAt` est un jeton de concurrence : après un enrichissement
   * réussi, celui que porte le contexte est périmé et un second enregistrement
   * partirait en 409. On relit donc le lead et on repose le contexte — ce qui
   * rafraîchit aussi le nom affiché dans l'en-tête.
   */
  private _refreshLeadToken(leadId: string): void {
    this._leadsApi
      .getLead(leadId)
      .pipe(catchError(() => EMPTY))
      .subscribe((lead) => this._context.set(lead));
  }

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return "Vous n'êtes pas autorisé à enrichir ce lead : il doit vous être assigné ou délégué.";
    }
    if (error.status === 409) {
      return 'La fiche a été modifiée entre-temps. Rechargez la page avant de réessayer.';
    }
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    return (
      firstError ??
      error.error?.title ??
      "Impossible d'enregistrer l'identité du principal."
    );
  }
}

export default LeadIdentite;
