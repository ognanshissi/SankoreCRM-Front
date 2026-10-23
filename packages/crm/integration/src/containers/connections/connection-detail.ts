import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { apply, form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import {
  ConnectionDetailDto,
  ConnectionHealthDto,
  ConnectionListDto,
  UnmappedCodesResponse,
  UpdateConnectionRequestModeEnum,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService, TENANT_MODULES, TenantModulesService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { catchError, EMPTY, firstValueFrom, forkJoin, map, of, tap } from 'rxjs';
import { ConnectionHealthBadgeComponent } from '../../components/connection-health-badge';
import { ConnectionSecretsPanelComponent } from '../../components/connection-secrets-panel';
import {
  ConnectionSettingsFormComponent,
  ConnectionSettingsFormModel,
  connectionSettingsSchema,
  connectionSettingsToDto,
} from '../../components/connection-settings-form';
import { RelayAgentPanelComponent } from '../../components/relay-agent-panel';
import { TelephonyWebhookPanel } from './telephony-webhook-panel';
import {
  integrationErrorMessage,
  IntegrationFacadeService,
} from '../../data-access/integration-facade.service';
import {
  CONNECTION_FAMILY_LABELS,
  CONNECTION_KIND_LABELS,
  CONNECTION_MODES,
  CONNECTION_MODE_LABELS,
  ConnectionFamily,
  ConnectionKind,
  ConnectionMode,
  MAPPING_DOMAINS,
  MappingDomain,
  unmappedAvailabilityMeta,
} from '../../data-access/integration-referential';

const MODE_ENUM: Record<ConnectionMode, UpdateConnectionRequestModeEnum> = {
  Api: UpdateConnectionRequestModeEnum.Api,
  Batch: UpdateConnectionRequestModeEnum.Batch,
  Relay: UpdateConnectionRequestModeEnum.Relay,
};

interface MappingCheck {
  domain: MappingDomain;
  label: string;
  response: UnmappedCodesResponse | null;
}

export interface ActivationBlocker {
  title: string;
  detail: string;
  /** Route vers l'écran qui lève le blocage, quand il y en a une. */
  link: string[] | null;
  linkLabel: string | null;
  linkQuery: Record<string, string> | null;
}

interface HealthRow {
  id: string;
  isHealthy: boolean;
  detail: string | null;
  latencyMs: number | null;
  checkedAt: string | null;
  /** « server » = le test enregistré sur la connexion ; « session » = un test de cet écran. */
  origin: 'server' | 'session';
}

class EditConnectionFormModel {
  public name!: string;
  public mode!: string;
  public settings!: ConnectionSettingsFormModel;

  public static fromDto(dto: ConnectionDetailDto): EditConnectionFormModel {
    const model = new EditConnectionFormModel();
    model.name = dto.name ?? '';
    model.mode = dto.mode ?? 'Api';
    model.settings = ConnectionSettingsFormModel.fromDto(dto.settings);
    return model;
  }
}

/**
 * Écran d'une connexion, ordonné comme l'exploitant procède : identité, réglages,
 * identifiants, test, agent relais, activation. L'activation est la fin du parcours, et
 * c'est elle qui porte la liste de ce qui bloque — le contrat refuse une activation sans
 * test passé (422 INTEGRATION_CONNECTION_NOT_HEALTHY), on ne propose donc pas un bouton
 * qui échoue.
 */
@Component({
  templateUrl: './connection-detail.html',
  imports: [
    Button,
    TasCard,
    TasIcon,
    TasTag,
    TasTable,
    TasSpinner,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TimeagoPipe,
    FormRoot,
    FormField,
    ConnectionHealthBadgeComponent,
    ConnectionSecretsPanelComponent,
    ConnectionSettingsFormComponent,
    RelayAgentPanelComponent,
    TelephonyWebhookPanel,
  ],
})
export class ConnectionDetailPage {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _router = inject(Router);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  private readonly _permissions = inject(PermissionsService);
  public readonly canManage = this._permissions.can('Integration.Connection.Manage');
  public readonly canManageMappings = this._permissions.can('Integration.Mapping.Manage');
  private readonly _tenantModules = inject(TenantModulesService);
  private readonly _hasInsuranceProductPermission = this._permissions.can('Ins.Product.Manage');
  /** Le catalogue d'un assureur relève du module « Assurance » ; sans lui, la route répond 403. */
  public readonly canSeeInsuranceProducts = computed(
    () => this._hasInsuranceProductPermission() && this._tenantModules.canRead(TENANT_MODULES.INSURANCE),
  );

  public readonly id = input.required<string>();

  public readonly isLoading = signal(true);
  public readonly isTesting = signal(false);
  public readonly isActivating = signal(false);
  public readonly connection = signal<ConnectionDetailDto | null>(null);
  public readonly loadFailed = signal<string | null>(null);

  /**
   * Historique des tests DE LA SESSION. Le contrat ne stocke pas de journal : la connexion
   * ne porte que `lastHealthAt` / `lastHealthStatus` / `lastHealthDetail`. Cette liste est
   * donc perdue au rechargement de la page, et l'écran le dit — laisser croire à un
   * journal persistant ferait chercher un historique qui n'existe pas.
   */
  private readonly _sessionHealth = signal<ConnectionHealthDto[]>([]);

  private readonly _siblings = signal<ConnectionListDto[]>([]);
  private readonly _mappingChecks = signal<MappingCheck[]>([]);

  public readonly modeOptions = CONNECTION_MODES.map((mode) => ({
    label: mode.label,
    value: mode.value,
  }));

  public readonly healthTableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 5,
      pageSizeOptions: [5, 10],
      totalElements: 0,
    },
  });

  public model = signal(new EditConnectionFormModel());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom de la connexion est obligatoire' });
    required(schema.mode, { message: 'Choisissez un mode' });
    // Le système est fixé par la connexion : il est lu dans les validateurs des champs
    // propres au `$kind`, et il ne change jamais pendant l'édition.
    apply(schema.settings, connectionSettingsSchema(() => this.kind()));
  });

  /**
   * La famille venait d'un ternaire « assurance ou cœur bancaire » : une connexion de
   * TÉLÉPHONIE s'affichait donc « Core banking », proposait les périodes de
   * synchronisation du cœur bancaire et annonçait la règle d'unicité du cœur bancaire sur
   * son activation. Les trois familles du contrat sont désormais reconnues.
   */
  public readonly family = computed<ConnectionFamily>(() => {
    const family = this.connection()?.family;
    if (family === 'Insurance') return 'Insurance';
    if (family === 'Telephony') return 'Telephony';
    return 'CoreBanking';
  });

  public readonly kind = computed<ConnectionKind | null>(() => {
    const kind = this.connection()?.kind;
    return kind ? (kind as ConnectionKind) : null;
  });

  public readonly isTelephony = computed(() => this.family() === 'Telephony');

  public readonly savedMode = computed<ConnectionMode>(() => {
    const mode = this.connection()?.mode;
    if (mode === 'Batch') return 'Batch';
    if (mode === 'Relay') return 'Relay';
    return 'Api';
  });

  public readonly formMode = computed<ConnectionMode>(() => {
    const mode = this.formSchema.mode().value();
    if (mode === 'Batch') return 'Batch';
    if (mode === 'Relay') return 'Relay';
    return 'Api';
  });

  public readonly familyLabel = computed(() => CONNECTION_FAMILY_LABELS[this.family()]);

  public readonly kindLabel = computed(() => {
    const kind = this.connection()?.kind;
    return kind ? CONNECTION_KIND_LABELS[kind] : '—';
  });

  public readonly savedModeLabel = computed(() => CONNECTION_MODE_LABELS[this.savedMode()]);

  public readonly isRelay = computed(() => this.savedMode() === 'Relay');

  /** Un seul core banking actif par tenant : la liste dit s'il y en a déjà un autre. */
  public readonly otherActiveCoreBanking = computed(() => {
    const dto = this.connection();
    if (!dto || dto.family !== 'CoreBanking' || dto.isActive) return null;
    return this._siblings().find((row) => row.isActive && row.id !== dto.id) ?? null;
  });

  public readonly mappingBlockers = computed<ActivationBlocker[]>(() =>
    this._mappingChecks()
      .filter((check) => {
        const meta = unmappedAvailabilityMeta(check.response?.availability);
        return meta.isMeasured && (check.response?.codes?.length ?? 0) > 0;
      })
      .map((check) => {
        const count = check.response?.codes?.length ?? 0;
        const source = check.response?.source ?? '';
        return {
          title: `${count} correspondance(s) manquante(s) — ${check.label}`,
          detail:
            check.response?.availability === 'Partial'
              ? `${source} La liste est partielle : d'autres codes peuvent manquer.`.trim()
              : source,
          link: ['/settings/integrations/mappings'],
          linkLabel: 'Ouvrir les correspondances de codes',
          linkQuery: { connectionId: this.id(), domain: check.domain },
        };
      }),
  );

  /**
   * Domaines dont le manque n'est pas mesurable : `availability: Unavailable` veut dire
   * qu'aucun contrat de module n'expose la liste CRM, donc une réponse vide par
   * construction. La présenter comme « tout est mappé » serait un contresens.
   */
  public readonly mappingNotices = computed(() =>
    this._mappingChecks()
      .filter((check) => !unmappedAvailabilityMeta(check.response?.availability).isMeasured)
      .map((check) => ({
        label: check.label,
        domain: check.domain,
        availabilityLabel: unmappedAvailabilityMeta(check.response?.availability).label,
        source: check.response?.source ?? null,
      })),
  );

  public readonly blockers = computed<ActivationBlocker[]>(() => {
    const dto = this.connection();
    if (!dto) return [];

    const blockers: ActivationBlocker[] = [];

    if (!dto.hasPassedHealthCheck) {
      blockers.push({
        title: "Le test de connexion n'est pas passé",
        detail:
          'Lancez un test depuis « Test de connexion ». Le serveur refuse une activation sans test réussi.',
        link: null,
        linkLabel: null,
        linkQuery: null,
      });
    }

    blockers.push(...this.mappingBlockers());

    const other = this.otherActiveCoreBanking();
    if (other) {
      blockers.push({
        title: 'Une autre connexion core banking est déjà active',
        detail: `« ${other.name || 'Connexion sans nom'} » occupe la place. Un client ne peut pas être créé dans deux systèmes de comptes : désactivez-la avant d'activer celle-ci.`,
        link: ['/settings/integrations/connections', other.id ?? ''],
        linkLabel: 'Ouvrir cette connexion',
        linkQuery: null,
      });
    }

    return blockers;
  });

  public readonly canActivateNow = computed(
    () => this.canManage() && this.blockers().length === 0 && !this.connection()?.isActive,
  );

  public readonly healthRows = computed<HealthRow[]>(() => {
    const dto = this.connection();
    const rows = new Map<string, HealthRow>();

    if (dto?.lastHealthAt) {
      rows.set(dto.lastHealthAt, {
        id: dto.lastHealthAt,
        isHealthy: dto.lastHealthStatus === true,
        detail: dto.lastHealthDetail ?? null,
        latencyMs: null,
        checkedAt: dto.lastHealthAt,
        origin: 'server',
      });
    }

    for (const result of this._sessionHealth()) {
      const key = result.checkedAt ?? '';
      if (!key) continue;
      rows.set(key, {
        id: key,
        isHealthy: result.isHealthy === true,
        detail: result.detail ?? null,
        latencyMs: result.latencyMs ?? null,
        checkedAt: result.checkedAt ?? null,
        origin: key === dto?.lastHealthAt ? 'server' : 'session',
      });
    }

    return [...rows.values()].sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''));
  });

  public readonly hasSessionHistory = computed(() =>
    this.healthRows().some((row) => row.origin === 'session'),
  );

  constructor() {
    effect(() => {
      const connectionId = this.id();
      this._sessionHealth.set([]);
      this._load(connectionId);
    });
  }

  public handleSave(): void {
    const dto = this.connection();
    if (!dto) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      let saved = false;

      await firstValueFrom(
        this._facade
          .updateConnection(this.id(), {
            name: value.name,
            mode: MODE_ENUM[value.mode as ConnectionMode],
            settings: connectionSettingsToDto(
              value.settings,
              dto.settings,
              dto.kind as ConnectionKind,
              this.family(),
            ),
            // Le contrat veut l'une des deux sentinelles : sans elles, deux
            // administrateurs qui enregistrent en même temps s'écrasent en silence.
            expectedVersion: dto.version ?? null,
            expectedUpdatedAt: dto.updatedAt ?? null,
          })
          .pipe(
            tap(() => {
              saved = true;
            }),
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                integrationErrorMessage(err, "Impossible d'enregistrer la connexion."),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success('Connexion enregistrée', 'Les réglages sont à jour.');
      this._load(this.id());
    });
  }

  public testConnection(): void {
    this.isTesting.set(true);

    this._facade
      .checkConnectionHealth(this.id())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Test impossible',
            integrationErrorMessage(err, "Le test n'a pas pu être lancé."),
          );
          this.isTesting.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        // Un système injoignable répond 200 avec `isHealthy: false` : c'est un fait
        // enregistré, pas une panne de l'appel.
        this._sessionHealth.update((history) => [
          { ...result, checkedAt: result.checkedAt ?? new Date().toISOString() },
          ...history,
        ]);

        if (result.isHealthy) {
          this._snackbar.success('Test réussi', 'Le système externe a répondu.');
        } else {
          this._snackbar.info('Test échoué', result.detail || "Le système externe n'a pas répondu.");
        }

        this.isTesting.set(false);
        /**
         * Le test ENREGISTRE son résultat sur la connexion : il faut relire la ligne, sinon
         * `expectedVersion` est périmé et le prochain enregistrement répond 409. En revanche
         * on ne repousse le modèle du formulaire que s'il est intact — sinon un test effacerait
         * des réglages saisis et pas encore enregistrés.
         */
        this._load(this.id(), !this.formSchema().dirty());
      });
  }

  public activate(): void {
    this.isActivating.set(true);

    this._facade
      .activateConnection(this.id())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Activation refusée',
            integrationErrorMessage(err, "Impossible d'activer la connexion."),
          );
          this.isActivating.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success('Connexion activée', 'Les écritures passent désormais par elle.');
        this.isActivating.set(false);
        this._load(this.id());
      });
  }

  public confirmDeactivate(): void {
    const dto = this.connection();
    if (!dto) return;

    if (dto.family !== 'Insurance' || !this.canSeeInsuranceProducts()) {
      this._askDeactivation(
        dto.family === 'Insurance'
          ? "Les produits de cet assureur ne pourront plus être souscrits. La liste des produits concernés demande le droit de gestion du catalogue d'assurance."
          : 'Les écritures vers ce système seront refusées tant qu’aucune connexion de la famille n’est active. La connexion est conservée, avec son historique.',
      );
      return;
    }

    // L'offrabilité d'un produit est dérivée de l'activité de sa connexion : la
    // désactivation retire ces produits de la souscription dans le même instant. On les
    // nomme avant de demander confirmation.
    this.isActivating.set(true);
    this._facade
      .listInsuranceProducts({ connectionId: this.id(), page: 1, pageSize: 200 })
      .pipe(
        catchError(() => {
          this.isActivating.set(false);
          this._askDeactivation(
            "Les produits de cet assureur ne pourront plus être souscrits. La liste n'a pas pu être chargée.",
          );
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.isActivating.set(false);
        const names = (result.items ?? []).map((product) => product.name || product.insurerProductCode || '—');

        this._askDeactivation(
          names.length === 0
            ? "Aucun produit n'est rattaché à cet assureur : la désactivation ne retire aucune souscription possible."
            : `${names.length} produit(s) ne pourront plus être souscrits : ${names.join(', ')}.`,
        );
      });
  }

  public followBlocker(blocker: ActivationBlocker): void {
    if (!blocker.link) return;
    this._router.navigate(blocker.link, { queryParams: blocker.linkQuery ?? {} });
  }

  public openMappings(): void {
    this._router.navigate(['/settings/integrations/mappings'], {
      queryParams: { connectionId: this.id() },
    });
  }

  public backToList(): void {
    // La téléphonie n'a pas d'écran de liste dédié : elle vit dans la liste générale.
    this._router.navigate([
      this.family() === 'Insurance'
        ? '/settings/integrations/insurance'
        : '/settings/integrations/connections',
    ]);
  }

  public reload(): void {
    this._load(this.id());
  }

  private _askDeactivation(message: string): void {
    this._confirm.confirm({
      title: 'Désactiver cette connexion ?',
      message,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._deactivate(),
    });
  }

  private _deactivate(): void {
    this.isActivating.set(true);

    this._facade
      .deactivateConnection(this.id())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, 'Impossible de désactiver la connexion.'),
          );
          this.isActivating.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success('Connexion désactivée', 'Plus aucune écriture ne passe par elle.');
        this.isActivating.set(false);
        this._load(this.id());
      });
  }

  private _load(connectionId: string, resetForm = true): void {
    this.isLoading.set(true);
    this.loadFailed.set(null);

    this._facade
      .getConnection(connectionId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadFailed.set(
            integrationErrorMessage(err, 'Impossible de charger cette connexion.'),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((dto) => {
        this.connection.set(dto);
        if (resetForm) {
          this.model.set(EditConnectionFormModel.fromDto(dto));
        }
        this.isLoading.set(false);

        this._breadcrumbService.set([
          { label: 'Paramétrage', link: ['/settings'] },
          { label: 'Intégrations', link: ['/settings/integrations/connections'] },
          dto.family === 'Insurance'
            ? { label: 'Assurance', link: ['/settings/integrations/insurance'] }
            : { label: 'Connexions', link: ['/settings/integrations/connections'] },
          { label: dto.name || 'Connexion' },
        ]);

        this._loadActivationContext(dto);
      });
  }

  private _loadActivationContext(dto: ConnectionDetailDto): void {
    if (dto.family === 'CoreBanking') {
      this._facade
        .listAllConnections('CoreBanking')
        .pipe(catchError(() => EMPTY))
        .subscribe((rows) => this._siblings.set(rows));
    } else {
      this._siblings.set([]);
    }

    if (dto.family === 'Telephony') {
      /**
       * Les correspondances de codes ne concernent PAS la téléphonie : un standard
       * téléphonique n'a ni produits, ni types de pièce, et l'agence d'un appel est lue sur
       * l'agent par le module Administration, pas par une table de correspondance. Sans ce
       * court-circuit, les codes CRM sans contrepartie externe remontaient comme des
       * blocages d'activation et le bouton « Activer » restait grisé pour toujours, alors
       * que le serveur n'exige qu'un test de connexion réussi.
       */
      this._mappingChecks.set([]);
      return;
    }

    if (!this.canManageMappings()) {
      // `GET mappings/{domain}/unmapped` exige Integration.Mapping.Manage : sans le droit
      // l'écran annonce qu'il ne peut pas vérifier, au lieu d'afficher un 403.
      this._mappingChecks.set([]);
      return;
    }

    const required = MAPPING_DOMAINS.filter((domain) => domain.isRequired);

    forkJoin(
      required.map((domain) =>
        this._facade.listUnmappedCodes(dto.id ?? '', domain.value).pipe(
          map((response) => ({ domain: domain.value, label: domain.label, response })),
          catchError(() =>
            of({ domain: domain.value, label: domain.label, response: null as UnmappedCodesResponse | null }),
          ),
        ),
      ),
    ).subscribe((checks) => this._mappingChecks.set(checks));
  }
}

export default ConnectionDetailPage;
