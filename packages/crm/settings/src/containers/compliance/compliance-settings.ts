import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  OnInit,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  FormRoot,
  pattern,
  submit,
  validate,
} from '@angular/forms/signals';
import { PageEvent } from '@angular/material/paginator';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, firstValueFrom, map, of } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasSwitch } from '@talisoft/ui/switch';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import {
  AuditApiService,
  AuditEntryDto,
  ComplianceSettingsApiService,
  ComplianceSettingsResponse,
  UpdateComplianceSettingsCommand,
  UsersApiService,
} from '@sankore/crm-api';
import {
  BreadcrumbService,
  ComplianceConfigService,
  FATCA_REGIME_OPTIONS,
  FATCA_REQUIREMENT_MOMENT_OPTIONS,
  fatcaRegimeLabel,
  GIIN_PATTERN,
  PermissionsService,
  UNKNOWN_CODE_LABEL,
} from '@sankore/crm/common';

interface CodeOption {
  label: string;
  value: string;
}

/**
 * Ressource sous laquelle le journal d'audit indexe ces paramètres.
 *
 * `UpdateComplianceSettingsCommand` déclare `resourceType` / `resourceId` en **lecture seule** :
 * c'est le serveur qui les remplit, et le contrat ne dit pas quelle valeur il y met. On interroge
 * donc le journal sur ce nom, et l'écran distingue explicitement « aucun changement enregistré »
 * de « le journal n'indexe peut-être pas cette ressource sous ce nom », avec un lien vers le
 * journal complet. Inventer un historique local serait pire que de ne pas en afficher.
 */
const COMPLIANCE_RESOURCE_TYPE = 'ComplianceSettings';

/**
 * Les deux volets de l'écran. Un seul `PUT /compliance-settings` porte les deux : les onglets
 * découpent la lecture, pas l'enregistrement (cf. `handleSubmit`).
 */
export type ComplianceTab = 'fatca' | 'pep';

/** Valeur du query param `?onglet=` pour chaque volet, pour que les deux soient adressables. */
const TAB_PARAM: Record<ComplianceTab, string> = { fatca: 'fatca', pep: 'ppe' };

/** Borne de saisie de la fenêtre PPE. Le contrat ne déclare qu'un `int32` : 100 ans suffisent. */
const MAX_PEP_MONTHS = 1200;

class ComplianceSettingsFormModel {
  public fatcaEnabled!: boolean;
  public fatcaRegime!: string;
  public fatcaGiin!: string;
  public fatcaRequiredAt!: string;
  public fatcaForCoHolders!: boolean;
  public pepEnabled!: boolean;
  /** Saisi en texte : la conversion en entier se fait à la soumission, pas dans le modèle. */
  public pepPostMandateMonths!: string;

  public static fromResponse(
    response: ComplianceSettingsResponse | null,
  ): ComplianceSettingsFormModel {
    const model = new ComplianceSettingsFormModel();
    model.fatcaEnabled = response?.fatcaEnabled ?? false;
    model.fatcaRegime = response?.fatcaRegime ?? '';
    model.fatcaGiin = response?.fatcaGiin ?? '';
    model.fatcaRequiredAt = response?.fatcaRequiredAt ?? '';
    model.fatcaForCoHolders = response?.fatcaForCoHolders ?? false;
    // L'absence du champ vaut « activé », comme dans `ComplianceConfigService` : un back qui
    // n'expose pas encore `pepEnabled` ne doit pas faire lire « vigilance PPE désactivée ».
    model.pepEnabled = response?.pepEnabled !== false;
    model.pepPostMandateMonths = String(response?.pepPostMandateMonths ?? 0);
    return model;
  }
}

/**
 * BNF-F-15 — Paramètres FATCA et conformité du tenant.
 *
 * `GET /compliance-settings` renvoie l'état en vigueur **et** les valeurs que le serveur accepte
 * (`allowedRegimes`, `allowedRequiredAt`). Les listes déroulantes sont donc construites sur la
 * réponse, et les référentiels du socle ne servent que de secours quand le serveur ne les renvoie
 * pas : le contrat déclare `fatcaRegime` comme une chaîne libre, aucune énumération n'y figure.
 * Figer ici les trois codes du socle ferait disparaître de l'écran le régime que le backend
 * ajouterait demain — exactement le piège de l'écran voisin des paramètres KYC.
 *
 * Lecture ouverte à `kyc:read` (le garde de la route) ; l'écriture exige `kyc:settings:manage`,
 * vérifié ici et par le serveur.
 */
@Component({
  selector: 'compliance-settings',
  templateUrl: './compliance-settings.html',
  imports: [
    DatePipe,
    RouterLink,
    FormRoot,
    FormField,
    Anchor,
    Button,
    TasCard,
    TasCheckbox,
    TasError,
    TasFormField,
    TasHint,
    TasIcon,
    TasInput,
    TasLabel,
    TasSelect,
    TasSpinner,
    TasSwitch,
    TasTable,
    TasTag,
  ],
})
export class ComplianceSettingsPage implements OnInit {
  private readonly _api = inject(ComplianceSettingsApiService);
  private readonly _auditApi = inject(AuditApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _complianceConfig = inject(ComplianceConfigService);

  /** Deux droits distincts : consulter le régime en vigueur n'est pas le modifier. */
  // Le droit que `PUT /compliance-settings` exige : `kyc:settings:manage` laissait l'écran éditable
  // à qui le serveur refusait ensuite l'enregistrement.
  public readonly canManage = this._permissions.can('admin:compliance:manage');
  public readonly canReadAudit = this._permissions.can('audit:read');

  /**
   * Volet courant, adressable par `?onglet=fatca|ppe`. `withComponentInputBinding()` est actif
   * dans `app.config.ts`, les query params se lient donc aux entrées. Un `linkedSignal` plutôt
   * qu'un `signal` : il suit l'URL quand elle change (lien profond, retour arrière) tout en
   * restant inscriptible au clic sur un onglet.
   */
  public readonly onglet = input<string | undefined>(undefined);

  public readonly activeTab = linkedSignal<ComplianceTab>(() =>
    this.onglet() === TAB_PARAM.pep ? 'pep' : 'fatca',
  );

  public isLoading = signal(true);
  /**
   * Séparé de l'état vide : « le chargement a échoué » et « FATCA est désactivé » n'appellent pas
   * la même réaction, et les confondre ferait conclure que l'institution n'est pas soumise.
   */
  public loadError = signal<string | null>(null);
  public settings = signal<ComplianceSettingsResponse | null>(null);

  public model = signal(ComplianceSettingsFormModel.fromResponse(null));

  public formSchema = form(this.model, (schema) => {
    // Le régime, le moment d'exigence et le GIIN ne sont exigés que si FATCA est activé :
    // un `required` inconditionnel bloquerait l'enregistrement d'une institution non soumise.
    validate(schema.fatcaRegime, (ctx) => {
      if (!ctx.valueOf(schema.fatcaEnabled)) return null;
      return ctx.value()
        ? null
        : {
            kind: 'required',
            message: "Le régime est obligatoire lorsque FATCA est activé",
          };
    });

    validate(schema.fatcaRequiredAt, (ctx) => {
      if (!ctx.valueOf(schema.fatcaEnabled)) return null;
      return ctx.value()
        ? null
        : {
            kind: 'required',
            message: "Le moment d'exigence est obligatoire lorsque FATCA est activé",
          };
    });

    // `pattern` ignore une valeur vide : le format n'est contrôlé que sur un GIIN saisi, et
    // l'obligation est portée séparément par le `validate` ci-dessous.
    pattern(schema.fatcaGiin, GIIN_PATTERN, {
      message:
        'Format attendu : XXXXXX.XXXXX.XX.XXX — 19 caractères, lettres majuscules et chiffres',
    });

    validate(schema.fatcaGiin, (ctx) => {
      if (!ctx.valueOf(schema.fatcaEnabled)) return null;
      return (ctx.value() ?? '').trim()
        ? null
        : {
            kind: 'required',
            message: 'Le GIIN est obligatoire lorsque FATCA est activé',
          };
    });

    validate(schema.pepPostMandateMonths, (ctx) => {
      // Comme pour FATCA : la fenêtre n'est exigée que si la vigilance PPE est active. Un
      // `required` inconditionnel bloquerait l'enregistrement d'un tenant qui la désactive.
      if (!ctx.valueOf(schema.pepEnabled)) return null;
      // `String(...)` et pas `.trim()` direct : l'input `type=number` peut remonter un nombre,
      // et un `trim` sur un nombre ferait planter la validation au premier caractère saisi.
      const raw = String(ctx.value() ?? '').trim();
      if (!raw) {
        return {
          kind: 'required',
          message: 'La durée de maintien du statut PPE est obligatoire',
        };
      }
      if (!/^\d+$/.test(raw)) {
        return { kind: 'pattern', message: 'Indiquez un nombre entier de mois' };
      }
      if (Number(raw) > MAX_PEP_MONTHS) {
        return { kind: 'max', message: `Indiquez au plus ${MAX_PEP_MONTHS} mois` };
      }
      return null;
    });
  });

  public readonly fatcaEnabled = computed(() => this.formSchema.fatcaEnabled().value());
  public readonly pepEnabled = computed(() => this.formSchema.pepEnabled().value());

  /** Les basculements ne sont engagés qu'à l'enregistrement : l'écran le dit avant de le faire. */
  public readonly pendingToggle = computed(() => {
    const loaded = this.settings()?.fatcaEnabled ?? false;
    return this.fatcaEnabled() !== loaded;
  });

  public readonly pendingPepToggle = computed(() => {
    const loaded = this.settings()?.pepEnabled !== false;
    return this.pepEnabled() !== loaded;
  });

  /**
   * Comparaison explicite à l'état chargé plutôt que `dirty()` : l'état « touché » dépend de ce
   * que chaque contrôle du kit notifie, et un contrôle qui ne le notifie pas laisserait le
   * bouton « Annuler » grisé sur un formulaire pourtant modifié.
   */
  public readonly fatcaTabChanged = computed(() => {
    const loaded = ComplianceSettingsFormModel.fromResponse(this.settings());
    const current = this.model();
    return (
      current.fatcaEnabled !== loaded.fatcaEnabled ||
      (current.fatcaRegime ?? '') !== loaded.fatcaRegime ||
      String(current.fatcaGiin ?? '') !== loaded.fatcaGiin ||
      (current.fatcaRequiredAt ?? '') !== loaded.fatcaRequiredAt ||
      current.fatcaForCoHolders !== loaded.fatcaForCoHolders
    );
  });

  public readonly pepTabChanged = computed(() => {
    const loaded = ComplianceSettingsFormModel.fromResponse(this.settings());
    const current = this.model();
    return (
      current.pepEnabled !== loaded.pepEnabled ||
      String(current.pepPostMandateMonths ?? '') !== loaded.pepPostMandateMonths
    );
  });

  public readonly hasChanges = computed(() => this.fatcaTabChanged() || this.pepTabChanged());

  /**
   * Validité par volet. Les deux onglets partagent **un seul** formulaire et **un seul**
   * enregistrement : sans ces deux indicateurs, un GIIN mal saisi désactiverait « Enregistrer »
   * pendant que l'administrateur regarde l'onglet PPE, sans rien à l'écran qui l'explique.
   */
  public readonly fatcaTabInvalid = computed(
    () =>
      this.formSchema.fatcaRegime().invalid() ||
      this.formSchema.fatcaRequiredAt().invalid() ||
      this.formSchema.fatcaGiin().invalid(),
  );

  public readonly pepTabInvalid = computed(() =>
    this.formSchema.pepPostMandateMonths().invalid(),
  );

  /** Volet à corriger, quand il n'est pas celui qu'on regarde. */
  public readonly blockingOtherTab = computed<ComplianceTab | null>(() => {
    if (this.activeTab() !== 'fatca' && this.fatcaTabInvalid()) return 'fatca';
    if (this.activeTab() !== 'pep' && this.pepTabInvalid()) return 'pep';
    return null;
  });

  public readonly regimeOptions = computed(() =>
    this._buildOptions(
      this.settings()?.allowedRegimes,
      FATCA_REGIME_OPTIONS,
      (code) => this.regimeLabel(code),
      this.settings()?.fatcaRegime,
    ),
  );

  public readonly requirementMomentOptions = computed(() =>
    this._buildOptions(
      this.settings()?.allowedRequiredAt,
      FATCA_REQUIREMENT_MOMENT_OPTIONS,
      (code) => this.requirementMomentLabel(code),
      this.settings()?.fatcaRequiredAt,
    ),
  );

  /** Lecture humaine de la fenêtre PPE : 18 mois se lit mal, « 1 an et 6 mois » se lit. */
  public readonly pepWindowLabel = computed(() => {
    if (!this.pepEnabled()) return null;
    const raw = String(this.formSchema.pepPostMandateMonths().value() ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const months = Number(raw);
    if (months === 0) return 'Le statut PPE tombe dès la fin de fonction.';
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const parts: string[] = [];
    if (years > 0) parts.push(`${years} an${years > 1 ? 's' : ''}`);
    if (rest > 0) parts.push(`${rest} mois`);
    return `Soit ${parts.join(' et ')} après la fin de fonction.`;
  });

  // ——— Historique ———

  public history = signal<AuditEntryDto[]>([]);
  public isLoadingHistory = signal(false);
  public historyUnavailable = signal(false);
  public expandedEntryId = signal<string | null>(null);

  public historyConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  private readonly _authorNames = signal<Record<string, string>>({});
  private readonly _resolvingAuthors = new Set<string>();

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'FATCA et conformité' },
    ]);
    this._load();
  }

  public reload(): void {
    this._load();
  }

  public regimeLabel(code: string | null | undefined): string {
    if (!code) return '—';
    const label = fatcaRegimeLabel(code);
    // Dans une liste de réglages, deux régimes inconnus tous deux rendus « Point à vérifier »
    // seraient indiscernables : on retombe sur le code que le serveur a lui-même déclaré.
    return label === UNKNOWN_CODE_LABEL ? code : label;
  }

  public requirementMomentLabel(code: string | null | undefined): string {
    if (!code) return '—';
    return FATCA_REQUIREMENT_MOMENT_OPTIONS.find((option) => option.value === code)?.label ?? code;
  }

  public authorLabel(entry: AuditEntryDto): string {
    if (!entry.userId) return 'Système';
    return this._authorNames()[entry.userId] ?? 'Utilisateur inconnu';
  }

  public toggleEntry(entry: AuditEntryDto): void {
    const id = entry.id ?? null;
    this.expandedEntryId.update((current) => (current === id ? null : id));
  }

  /**
   * Le commutateur n'est pas un `FormField` : `tas-switch` est un bouton `role="switch"`, pas un
   * contrôle de formulaire. On écrit donc directement la valeur du champ, ce qui conserve la
   * validation conditionnelle du régime et du GIIN.
   */
  public onFatcaToggle(value: boolean): void {
    if (!this.canManage()) return;
    this.formSchema.fatcaEnabled().value.set(value);
    this.formSchema.fatcaEnabled().markAsDirty();
  }

  public onPepToggle(value: boolean): void {
    if (!this.canManage()) return;
    this.formSchema.pepEnabled().value.set(value);
    this.formSchema.pepEnabled().markAsDirty();
  }

  /**
   * Le volet est reflété dans l'URL : un lien profond depuis un dossier ou depuis l'aperçu des
   * réglages doit pouvoir ouvrir directement le bon volet. `replaceUrl` pour qu'un va-et-vient
   * entre onglets n'empile pas d'entrées dans l'historique du navigateur.
   */
  public selectTab(tab: ComplianceTab): void {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { onglet: TAB_PARAM[tab] },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public cancelChanges(): void {
    const next = ComplianceSettingsFormModel.fromResponse(this.settings());
    this.model.set(next);
    this.formSchema().reset(next);
  }

  public handleSubmit(): void {
    if (!this.canManage()) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      // Activer ou désactiver FATCA ou la vigilance PPE change ce que voient tous les chargés
      // de clientèle : la confirmation dit la conséquence, et rien ne part avant qu'elle soit
      // acceptée. Les deux bascules sont confirmées séparément — un administrateur qui change
      // les deux d'un coup doit valider les deux conséquences, pas une seule.
      if (this.pendingToggle()) {
        const confirmed = await this._confirmFatcaToggle(value.fatcaEnabled);
        if (!confirmed) return;
      }

      if (this.pendingPepToggle()) {
        const confirmed = await this._confirmPepToggle(value.pepEnabled);
        if (!confirmed) return;
      }

      const command: UpdateComplianceSettingsCommand = {
        fatcaEnabled: value.fatcaEnabled,
        fatcaRegime: value.fatcaRegime || null,
        fatcaGiin: String(value.fatcaGiin ?? '').trim() || null,
        fatcaRequiredAt: value.fatcaRequiredAt || null,
        fatcaForCoHolders: value.fatcaForCoHolders,
        pepEnabled: value.pepEnabled,
        // Désactivée, la fenêtre n'est plus saisie : on renvoie la valeur en vigueur plutôt
        // qu'un `NaN` issu d'un champ vide, pour ne pas écraser le réglage à la réactivation.
        pepPostMandateMonths: value.pepEnabled
          ? Number(value.pepPostMandateMonths)
          : (this.settings()?.pepPostMandateMonths ?? 0),
      };

      const saved = await firstValueFrom(
        this._api.updateComplianceSettings(command).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error(
              'Enregistrement refusé',
              this._errorMessage(err, "Les paramètres de conformité n'ont pas été enregistrés."),
            );
            return of(false);
          }),
        ),
      );

      // `PUT` répond 204 : le corps ne prouve rien. On relit l'état en vigueur plutôt que de
      // supposer que tout est parti — c'est aussi ce qui remet l'historique à jour.
      if (saved) {
        this._snackbar.success(
          'Paramètres enregistrés',
          this._savedSummary(value.fatcaEnabled, value.pepEnabled),
        );
        this._load();
      }
    });
  }

  private _savedSummary(fatcaEnabled: boolean, pepEnabled: boolean): string {
    const fatca = fatcaEnabled
      ? 'FATCA est actif'
      : "FATCA est inactif : aucune déclaration n'est demandée";
    const pep = pepEnabled
      ? 'la vigilance PPE est active'
      : "la vigilance PPE est inactive : aucun bloc PPE n'est proposé";
    return `${fatca} ; ${pep}.`;
  }

  private _confirmPepToggle(enabling: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      this._confirmDialog.confirm({
        title: enabling ? 'Activer la vigilance PPE' : 'Désactiver la vigilance PPE',
        message: enabling
          ? 'Activer la vigilance PPE fait apparaître le bloc PPE sur le principal, le conjoint et chaque enfant de tous les leads et dossiers clients. Confirmez-vous l\'activation ?'
          : "Désactiver la vigilance PPE fait disparaître le bloc PPE de tous les leads et dossiers clients : aucune exposition politique ne sera plus demandée ni signalée. Les expositions déjà déclarées sont conservées mais ne sont plus affichées. Confirmez-vous la désactivation ?",
        closable: true,
        showCancelButton: true,
        acceptButtonProps: {
          label: enabling ? 'Activer la vigilance PPE' : 'Désactiver la vigilance PPE',
          theme: enabling ? 'primary' : 'warn',
        },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  private _confirmFatcaToggle(enabling: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      this._confirmDialog.confirm({
        title: enabling ? 'Activer FATCA' : 'Désactiver FATCA',
        message: enabling
          ? "Activer FATCA fait apparaître la section de déclaration FATCA sur tous les leads et dossiers clients, et l'auto-certification devient exigible au moment choisi ci-dessus. Confirmez-vous l'activation ?"
          : "Désactiver FATCA fait disparaître la section de déclaration FATCA de tous les leads et dossiers clients ; les déclarations déjà recueillies ne sont plus demandées ni vérifiées. Confirmez-vous la désactivation ?",
        closable: true,
        // Sans `showCancelButton`, le dialogue n'affiche que le bouton d'acceptation : le seul
        // moyen de renoncer serait la croix. On l'active pour que « Annuler » existe vraiment.
        showCancelButton: true,
        acceptButtonProps: {
          label: enabling ? 'Activer FATCA' : 'Désactiver FATCA',
          theme: enabling ? 'primary' : 'warn',
        },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  public onHistoryPageChange(event: PageEvent): void {
    this.historyConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      },
    }));
    this._loadHistory();
  }

  private _buildOptions(
    allowed: Array<string> | null | undefined,
    fallback: ReadonlyArray<CodeOption>,
    label: (code: string) => string,
    current: string | null | undefined,
  ): CodeOption[] {
    const codes = (allowed ?? []).filter((code) => !!code);
    const options: CodeOption[] = codes.length
      ? codes.map((code) => ({ label: label(code), value: code }))
      : fallback.map((option) => ({ ...option }));

    // La valeur en vigueur reste proposée même si le serveur ne la liste plus : sans cela, le
    // régime appliqué disparaîtrait de l'écran et le premier enregistrement l'effacerait.
    if (current && !options.some((option) => option.value === current)) {
      options.unshift({ label: label(current), value: current });
    }
    return options;
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._api
      .getComplianceSettings()
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.settings.set(null);
          this.loadError.set(
            this._errorMessage(
              err,
              "Les paramètres de conformité n'ont pas pu être chargés. Réessayez dans un instant.",
            ),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((response) => {
        this.settings.set(response);
        // Le porteur partagé est mis à jour ici, et non après la soumission : `_load()` est
        // aussi appelé après l'enregistrement, donc les fiches ouvertes ensuite voient le
        // nouveau drapeau sans recharger l'application.
        this._complianceConfig.patch(response);
        const next = ComplianceSettingsFormModel.fromResponse(response);
        this.model.set(next);
        this.formSchema().reset(next);
        this.isLoading.set(false);
        if (this.canReadAudit()) this._loadHistory();
      });
  }

  /**
   * Historique des changements : le contrat de `compliance-settings` n'expose que `updatedAt`.
   * Le seul historique disponible est le journal d'audit, filtré sur la ressource (cf.
   * `COMPLIANCE_RESOURCE_TYPE`). Un échec ou une réponse vide est dit tel quel.
   */
  private _loadHistory(): void {
    this.isLoadingHistory.set(true);
    this.historyUnavailable.set(false);
    const pagination = this.historyConfig().pagination;

    this._auditApi
      .getAuditEntries(
        undefined,
        undefined,
        COMPLIANCE_RESOURCE_TYPE,
        undefined,
        undefined,
        undefined,
        undefined,
        // Le journal pagine en 1-based, `PageEvent.pageIndex` est 0-based.
        pagination.pageIndex + 1,
        pagination.pageSize,
        false,
      )
      .pipe(
        catchError(() => {
          this.history.set([]);
          this.historyUnavailable.set(true);
          this.isLoadingHistory.set(false);
          return EMPTY;
        }),
      )
      .subscribe((page) => {
        const entries = page?.items ?? [];
        this.history.set(entries);
        this.historyConfig.update((config) => ({
          ...config,
          pagination: { ...config.pagination, totalElements: page?.totalCount ?? 0 },
        }));
        this.isLoadingHistory.set(false);
        this._resolveAuthors(entries);
      });
  }

  private _resolveAuthors(entries: AuditEntryDto[]): void {
    const known = this._authorNames();
    const pending = new Set(
      entries
        .map((entry) => entry.userId)
        .filter((id): id is string => !!id && !known[id] && !this._resolvingAuthors.has(id)),
    );

    for (const id of pending) {
      this._resolvingAuthors.add(id);
      this._usersApi
        .getUser(id)
        .pipe(catchError(() => of(null)))
        .subscribe((user) => {
          const name = user?.fullName || user?.email;
          if (name) this._authorNames.update((current) => ({ ...current, [id]: name }));
        });
    }
  }

  /** Un message générique cache l'information qui fait gagner une heure : on remonte le détail. */
  private _errorMessage(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    const errors = body?.errors;
    if (errors && typeof errors === 'object') {
      const first = Object.values(errors)[0];
      if (Array.isArray(first) && first.length > 0) return String(first[0]);
    }
    return body?.detail ?? body?.title ?? fallback;
  }
}

export default ComplianceSettingsPage;
