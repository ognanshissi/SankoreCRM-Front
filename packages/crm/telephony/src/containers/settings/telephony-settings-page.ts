import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import {
  CallOutcomeDto,
  MyTelephonyStatusDto,
  RecordingPolicyDto,
  SetRecordingPolicyRequestModeEnum,
  TelephonyApiService,
  UsersApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY, firstValueFrom, of, tap } from 'rxjs';
import { telLabel, telSeverity, telephonyErrorMessage } from '../../data-access/telephony-referential';
import { CallOutcomeDrawer, CallOutcomeDrawerData } from './call-outcome-drawer';

/**
 * `POST call-outcomes/{code}/{state}` prend l'état dans l'URL, et le client généré le
 * type en `string` nue — une faute de frappe partirait donc en 404 silencieux. L'union
 * rend la faute impossible à la compilation.
 */
export type CallOutcomeActivationState = 'activate' | 'deactivate';

const RECORDING_MODES = ['Disabled', 'AllCalls', 'OnDemand'] as const;

type RecordingMode = (typeof RECORDING_MODES)[number];

const RECORDING_MODE_LABELS: Readonly<Record<RecordingMode, string>> = {
  Disabled: 'Aucun enregistrement',
  AllCalls: 'Tous les appels',
  OnDemand: 'À la demande de l’agent',
};

const RECORDING_MODE_SEVERITIES: Readonly<Record<RecordingMode, Severity>> = {
  Disabled: 'neutral',
  AllCalls: 'warning',
  OnDemand: 'info',
};

const RECORDING_MODE_ENUM: Readonly<Record<RecordingMode, SetRecordingPolicyRequestModeEnum>> = {
  Disabled: SetRecordingPolicyRequestModeEnum.Disabled,
  AllCalls: SetRecordingPolicyRequestModeEnum.AllCalls,
  OnDemand: SetRecordingPolicyRequestModeEnum.OnDemand,
};

class RecordingPolicyFormModel {
  public mode!: string;
  public legalBasis!: string;
  public purpose!: string;
  /** Chaînes : les `input` rendent du texte, la conversion a lieu à la soumission. */
  public retentionDays!: string;
  public maxDurationSeconds!: string;
  public deleteAtProvider!: boolean;
  /**
   * Déclaration d'information des appelants. Elle n'est PAS enregistrée : aucun champ du
   * contrat ne la transporte. C'est une condition de validation avant d'activer
   * l'enregistrement de tous les appels, redemandée à chaque changement — et l'écran le
   * dit, plutôt que de laisser croire à un réglage conservé.
   */
  public callersInformed!: boolean;

  public static fromDto(dto: RecordingPolicyDto | null): RecordingPolicyFormModel {
    const model = new RecordingPolicyFormModel();
    model.mode = dto?.mode ?? 'Disabled';
    model.legalBasis = dto?.legalBasis ?? '';
    model.purpose = dto?.purpose ?? '';
    model.retentionDays = dto?.retentionDays != null ? String(dto.retentionDays) : '';
    model.maxDurationSeconds =
      dto?.maxDurationSeconds != null ? String(dto.maxDurationSeconds) : '';
    model.deleteAtProvider = dto?.deleteAtProvider ?? false;
    model.callersInformed = false;
    return model;
  }
}

/**
 * Paramètres de téléphonie (TEL-F-03).
 *
 * Deux sections, et PAS les cinq que l'histoire demandait : **les règles de SLA
 * téléphonique, les horaires d'appel et l'obligation de qualification n'ont aucun endpoint
 * — d'aucune sorte.** L'écran le dit en toutes lettres au lieu de présenter des champs qui
 * n'écrivent nulle part : un réglage qui a l'air enregistré et ne l'est pas est pire que
 * son absence, parce que personne ne va vérifier.
 *
 * Les deux sections réelles n'ont ni la même permission ni le même métier :
 *
 * - le référentiel des résultats d'appel relève de `Telephony.Settings.Manage`, qui garde
 *   la route ;
 * - la politique d'enregistrement relève de `admin:compliance:manage`, qui est une autre
 *   personne. La route n'est donc pas gardée dessus (cela fermerait tout l'écran à un
 *   administrateur téléphonie), c'est la SECTION qui se masque.
 */
@Component({
  selector: 'lib-telephony-settings-page',
  templateUrl: './telephony-settings-page.html',
  imports: [
    DatePipe,
    FormsModule,
    Button,
    TasCard,
    TasCheckbox,
    TasIcon,
    TasSpinner,
    TasTable,
    TasTag,
    TasSelect,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    FormRoot,
    FormField,
  ],
})
export class TelephonySettingsPage implements OnInit {
  private readonly _api = inject(TelephonyApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);

  /**
   * La chaîne est en minuscules-deux-points là où ses voisines sont en PascalCase pointé,
   * et ce n'est pas une coquille : c'est le droit du catalogue Administration que les deux
   * endpoints de la politique d'enregistrement accordent.
   */
  public readonly canManageCompliance = this._permissions.can('admin:compliance:manage');
  public readonly canManageSettings = this._permissions.can('Telephony.Settings.Manage');

  // ——— Résultats d'appel ———

  public readonly isLoadingOutcomes = signal(true);
  public readonly outcomesError = signal<string | null>(null);
  public readonly outcomes = signal<CallOutcomeDto[]>([]);
  public readonly includeInactive = signal(true);
  public readonly togglingCode = signal<string | null>(null);

  public readonly outcomesTableConfig = signal<TableConfig>({
    property: 'code',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  public readonly sortedOutcomes = computed(() =>
    [...this.outcomes()].sort((a, b) => {
      const order = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
      return order !== 0 ? order : (a.label ?? '').localeCompare(b.label ?? '', 'fr');
    }),
  );

  public readonly activeOutcomeCount = computed(
    () => this.outcomes().filter((outcome) => outcome.isActive).length,
  );

  public readonly nextDisplayOrder = computed(() => {
    const orders = this.outcomes().map((outcome) => outcome.displayOrder ?? 0);
    return orders.length === 0 ? 10 : Math.max(...orders) + 10;
  });

  // ——— Politique d'enregistrement ———

  public readonly isLoadingPolicy = signal(true);
  public readonly policyError = signal<string | null>(null);
  public readonly policy = signal<RecordingPolicyDto | null>(null);
  public readonly policyAuthorName = signal<string | null>(null);

  public readonly myStatus = signal<MyTelephonyStatusDto | null>(null);

  public readonly modeOptions = RECORDING_MODES.map((mode) => ({
    label: RECORDING_MODE_LABELS[mode],
    value: mode,
  }));

  public policyModel = signal(RecordingPolicyFormModel.fromDto(null));

  public policyForm = form(this.policyModel, (schema) => {
    validate(schema.mode, (ctx) =>
      (ctx.value() ?? '').trim() ? null : { kind: 'required', message: 'Choisissez un mode' },
    );

    /**
     * Tout mode autre que « désactivé » EXIGE une base légale et une finalité (422
     * TELEPHONY_RECORDING_LEGAL_BASIS_REQUIRED / _PURPOSE_REQUIRED). Les deux sont du texte
     * libre : les bases diffèrent d'un régulateur à l'autre, et une liste fermée côté
     * plateforme contraindrait ce que l'établissement a le droit d'invoquer.
     */
    validate(schema.legalBasis, (ctx) => {
      if (ctx.valueOf(schema.mode) === 'Disabled') return null;
      return (ctx.value() ?? '').trim()
        ? null
        : {
            kind: 'required',
            message:
              'La base légale est obligatoire : sans elle, les fichiers conservés seraient injustifiables',
          };
    });

    validate(schema.purpose, (ctx) => {
      if (ctx.valueOf(schema.mode) === 'Disabled') return null;
      return (ctx.value() ?? '').trim()
        ? null
        : {
            kind: 'required',
            message:
              'La finalité est obligatoire : « nous pouvons » et « nous avons besoin de » sont deux questions distinctes',
          };
    });

    validate(schema.retentionDays, (ctx) => {
      if (ctx.valueOf(schema.mode) === 'Disabled') return null;
      const raw = (ctx.value() ?? '').trim();
      if (raw === '') {
        return {
          kind: 'required',
          message: 'Indiquez une durée de conservation en jours',
        };
      }
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed >= 1
        ? null
        : { kind: 'range', message: 'Entrez un nombre de jours entier et positif' };
    });

    validate(schema.maxDurationSeconds, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (raw === '') return null;
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed >= 1
        ? null
        : { kind: 'range', message: 'Entrez un nombre de secondes entier et positif' };
    });

    // L'enregistrement de TOUS les appels sans que personne ne soit prévenu n'est pas une
    // option : la case est la condition, pas une formalité.
    validate(schema.callersInformed, (ctx) => {
      if (ctx.valueOf(schema.mode) !== 'AllCalls') return null;
      return ctx.value()
        ? null
        : {
            kind: 'required',
            message:
              'Confirmez que les appelants sont informés avant la tonalité : c’est la condition de ce mode',
          };
    });
  });

  public readonly selectedMode = computed<RecordingMode>(() => {
    const mode = this.policyForm.mode().value();
    return RECORDING_MODES.includes(mode as RecordingMode)
      ? (mode as RecordingMode)
      : 'Disabled';
  });

  public readonly savedMode = computed<RecordingMode>(() => {
    const mode = this.policy()?.mode;
    return RECORDING_MODES.includes(mode as RecordingMode)
      ? (mode as RecordingMode)
      : 'Disabled';
  });

  public readonly modeChanges = computed(() => this.selectedMode() !== this.savedMode());

  /** `updatedBy` nul veut dire que PERSONNE n'a décidé : différent d'un choix « désactivé ». */
  public readonly hasDecision = computed(() => !!this.policy()?.updatedAt);

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Téléphonie', link: ['/settings/telephony/journal'] },
      { label: 'Paramètres' },
    ]);

    this._loadMyStatus();
    this._loadOutcomes();

    if (this.canManageCompliance()) {
      this._loadPolicy();
    } else {
      // `GET recording-policy` exige `admin:compliance:manage` : sans le droit, l'appel
      // répondrait 403 et la section afficherait une panne au lieu d'une règle d'accès.
      this.isLoadingPolicy.set(false);
    }
  }

  // ——— Libellés ———

  public modeLabel(value: string | null | undefined): string {
    return telLabel(RECORDING_MODE_LABELS, value);
  }

  public modeSeverity(value: string | null | undefined): Severity {
    return telSeverity(RECORDING_MODE_SEVERITIES, value);
  }

  // ——— Résultats d'appel ———

  public reloadOutcomes(): void {
    this._loadOutcomes();
  }

  public toggleIncludeInactive(value: boolean): void {
    this.includeInactive.set(value);
    this._loadOutcomes();
  }

  public openCreateOutcome(): void {
    this._openOutcomeDrawer(null);
  }

  public openEditOutcome(outcome: CallOutcomeDto): void {
    this._openOutcomeDrawer(outcome);
  }

  /**
   * Jamais une suppression, pour un résultat de la plateforme comme pour un autre : un
   * appel qualifié l'an dernier pointe sur le code, et le retirer laisserait cet appel
   * expliqué par rien. On désactive, et la liste garde la ligne.
   */
  public confirmToggleActive(outcome: CallOutcomeDto): void {
    const code = outcome.code;
    if (!code || !this.canManageSettings()) return;

    const deactivating = outcome.isActive === true;

    this._confirm.confirm({
      title: deactivating ? 'Désactiver ce résultat ?' : 'Réactiver ce résultat ?',
      message: deactivating
        ? `« ${outcome.label} » ne sera plus proposé aux agents, et une qualification qui l'utiliserait encore sera refusée. Les appels déjà qualifiés ainsi gardent ce résultat : la ligne est conservée, jamais supprimée.`
        : `« ${outcome.label} » sera de nouveau proposé aux agents, avec le comportement qu'il avait déjà — ses deux drapeaux n'ont pas changé pendant sa désactivation.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: {
        label: deactivating ? 'Désactiver' : 'Réactiver',
        theme: deactivating ? 'warn' : 'primary',
      },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._setOutcomeActive(code, deactivating ? 'deactivate' : 'activate'),
    });
  }

  // ——— Politique d'enregistrement ———

  public reloadPolicy(): void {
    this._loadPolicy();
  }

  public handlePolicySubmit(): void {
    submit(this.policyForm, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const mode = this.selectedMode();

      /**
       * Confirmation avant TOUT changement de mode : couper l'enregistrement, l'étendre à
       * tous les appels ou le réduire au bon vouloir de l'agent sont trois décisions de
       * conformité, pas des réglages. La boîte est ouverte avec `closable` et un bouton
       * d'annulation, les deux seules sorties — le dialogue est ouvert en `disableClose`,
       * donc aucune sortie ne laisse la promesse en suspens.
       */
      if (this.modeChanges()) {
        const accepted = await this._askModeChange(mode);
        if (!accepted) return;
      }

      // 204 : rien dans le corps, donc un drapeau plutôt qu'un test sur la valeur reçue.
      let saved = false;
      await firstValueFrom(
        this._api
          .setTelephonyRecordingPolicy({
            mode: RECORDING_MODE_ENUM[mode],
            // Les mots sont conservés même en repassant à « désactivé » : les
            // enregistrements déjà pris le sont toujours sous ces mots-là. On les renvoie
            // donc tels quels au lieu de les vider avec le mode.
            legalBasis: value.legalBasis.trim() || null,
            purpose: value.purpose.trim() || null,
            retentionDays: value.retentionDays.trim()
              ? Number(value.retentionDays.trim())
              : null,
            deleteAtProvider: value.deleteAtProvider,
            maxDurationSeconds: value.maxDurationSeconds.trim()
              ? Number(value.maxDurationSeconds.trim())
              : null,
          })
          .pipe(
            tap(() => {
              saved = true;
            }),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Enregistrement refusé',
                telephonyErrorMessage(
                  error,
                  "La politique d'enregistrement n'a pas pu être enregistrée.",
                ),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success(
        'Politique enregistrée',
        mode === 'Disabled'
          ? 'Aucun nouvel appel ne sera enregistré. Les enregistrements déjà pris restent conservés sous la base légale qui les justifiait.'
          : 'Elle est copiée sur chaque enregistrement au moment où il est récupéré, et figée là.',
      );

      // Relu plutôt que supposé : `updatedBy` et `updatedAt` sont posés par le serveur, et
      // ils sont la trace de la décision.
      this._loadPolicy();
    });
  }

  private _askModeChange(mode: RecordingMode): Promise<boolean> {
    const messages: Record<RecordingMode, string> = {
      Disabled:
        "Plus aucun appel ne sera enregistré à partir de maintenant. Les enregistrements déjà pris sont conservés : ils restent justifiés par la base légale et la finalité sous lesquelles ils ont été faits.",
      AllCalls:
        "Tous les appels seront enregistrés. Assurez-vous que vos appelants en sont informés avant la tonalité : la base légale et la finalité que vous saisissez sont copiées sur chaque enregistrement et figées.",
      OnDemand:
        "Seuls les appels que l'agent demande de conserver seront gardés, case cochée au moment de la qualification. C'est le mode d'un consentement donné conversation par conversation ; sans demande de l'agent, rien n'est conservé.",
    };

    return new Promise<boolean>((resolve) => {
      this._confirm.confirm({
        title: `Passer en « ${RECORDING_MODE_LABELS[mode]} » ?`,
        message: messages[mode],
        closable: true,
        showCancelButton: true,
        acceptButtonProps: { label: 'Changer le mode', theme: 'warn' },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  private _openOutcomeDrawer(outcome: CallOutcomeDto | null): void {
    if (!this.canManageSettings()) return;

    const data: CallOutcomeDrawerData = {
      outcome,
      nextDisplayOrder: this.nextDisplayOrder(),
    };

    const ref = this._sideDrawerService.open<boolean, CallOutcomeDrawerData, CallOutcomeDrawer>(
      CallOutcomeDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );

    ref.closed.subscribe((saved) => {
      if (saved) this._loadOutcomes();
    });
  }

  private _setOutcomeActive(code: string, state: CallOutcomeActivationState): void {
    this.togglingCode.set(code);

    this._api
      .setTelephonyCallOutcomeActive(code, state)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Changement refusé',
            telephonyErrorMessage(
              error,
              "L'état de ce résultat d'appel n'a pas pu être changé.",
            ),
          );
          this.togglingCode.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.togglingCode.set(null);
        this._snackbar.success(
          state === 'deactivate' ? 'Résultat désactivé' : 'Résultat réactivé',
          state === 'deactivate'
            ? "Il n'est plus proposé aux agents. Les appels déjà qualifiés le gardent."
            : 'Il est de nouveau proposé aux agents.',
        );
        this._loadOutcomes();
      });
  }

  private _loadOutcomes(): void {
    this.isLoadingOutcomes.set(true);
    this.outcomesError.set(null);

    this._api
      .listTelephonyCallOutcomes(this.includeInactive())
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.outcomes.set([]);
          this.outcomesError.set(
            telephonyErrorMessage(
              error,
              "Le référentiel des résultats d'appel n'a pas pu être chargé.",
            ),
          );
          this.isLoadingOutcomes.set(false);
          return EMPTY;
        }),
      )
      .subscribe((outcomes) => {
        this.outcomes.set(outcomes ?? []);
        this.isLoadingOutcomes.set(false);
      });
  }

  private _loadPolicy(): void {
    this.isLoadingPolicy.set(true);
    this.policyError.set(null);

    this._api
      .getTelephonyRecordingPolicy()
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.policyError.set(
            telephonyErrorMessage(
              error,
              "La politique d'enregistrement n'a pas pu être lue.",
            ),
          );
          this.isLoadingPolicy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((policy) => {
        this.policy.set(policy);
        this.policyModel.set(RecordingPolicyFormModel.fromDto(policy));
        this.isLoadingPolicy.set(false);
        this._resolveAuthor(policy.updatedBy ?? null);
      });
  }

  /** `updatedBy` est un identifiant : sans ce nom, la trace de décision est illisible. */
  private _resolveAuthor(userId: string | null): void {
    if (!userId) {
      this.policyAuthorName.set(null);
      return;
    }

    this._usersApi
      .getUser(userId)
      .pipe(catchError(() => of(null)))
      .subscribe((user) =>
        this.policyAuthorName.set(user?.fullName || user?.email || 'Utilisateur inconnu'),
      );
  }

  private _loadMyStatus(): void {
    // Aucune permission requise, et c'est la seule lecture qui dise si une connexion
    // téléphonie est ACTIVE : sans elle, aucun de ces réglages ne produit d'appel.
    this._api
      .getMyTelephonyStatus()
      .pipe(catchError(() => EMPTY))
      .subscribe((status) => this.myStatus.set(status));
  }
}

export default TelephonySettingsPage;
