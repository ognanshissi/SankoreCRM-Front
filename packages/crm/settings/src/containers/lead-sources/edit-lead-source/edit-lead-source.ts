import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, Observable } from 'rxjs';
import { LeadSourcesService } from '../lead-sources.service';
import {
  channelLabel, modeLabel, statusLabel, statusSeverity,
  healthIcon, healthColor, channelIcon,
} from '../lead-source.types';
import { FieldMappingEditor } from '../field-mapping-editor/field-mapping-editor';
import { MappingRule, missingRequiredFields } from '../field-mapping.types';
import {
  ConsentConfig,
  HostedFormConfig,
  LeadSourceSettings,
  PullConfig,
  ScriptConfig,
  isPullSettings,
  isScriptSettings,
  readSettings,
  toPersistedRules,
  writeSettings,
} from '../lead-source-settings.types';
import { isValidJsonPath } from '../lead-source-validators';
import { ConsentPolicyEditor } from '../consent-policy-editor/consent-policy-editor';
import { ScriptWizard } from '../script-wizard';
import { HostedFormEditor } from '../hosted-form-editor/hosted-form-editor';
import { ScriptInstaller } from '../script-installer';
import { ScriptVerifier } from '../script-verifier';
import { WebhookConnection } from '../webhook-connection';
import { PullWizard } from '../pull-wizard/pull-wizard';
import { PullConnection } from '../pull-connection';
import { PullDryRun } from '../pull-dry-run';
import { RunHistory } from '../run-history';
import { IngestionList } from '../ingestion-list';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Anchor, Button } from '@talisoft/ui/button';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { LeadSourceDetailDto } from '@sankore/crm-api';

@Component({
  selector: 'edit-lead-source',
  standalone: true,
  imports: [
    RouterLink,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    Menu,
    MenuItem,
    TasMenuTrigger,
    FieldMappingEditor,
    ConsentPolicyEditor,
    ScriptWizard,
    HostedFormEditor,
    ScriptInstaller,
    ScriptVerifier,
    WebhookConnection,
    PullWizard,
    PullConnection,
    PullDryRun,
    RunHistory,
    IngestionList,
    Anchor,
  ],
  templateUrl: 'edit-lead-source.html',
})
export class EditLeadSource implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);

  /** Premier chargement uniquement : le spinner remplace tout l'écran. */
  public isLoading = signal(true);
  /**
   * Rechargement d'une source déjà affichée. Distinct d'`isLoading` : repasser
   * `isLoading` à `true` après chaque enregistrement démontait l'en-tête, les
   * onglets et l'onglet courant, ce qui réinitialisait l'état local des enfants
   * (filtres de réceptions, résultat du test à blanc, sondage du vérificateur).
   */
  public isRefreshing = signal(false);
  public actionLoading = signal(false);
  public source = signal<LeadSourceDetailDto | null>(null);
  public activeTab = signal('general');

  /** Identifiant courant, conservé pour pouvoir recharger sans la source. */
  private _sourceId: string | null = null;

  /** Conflit de version signalé par le service (409). */
  public readonly versionConflict = this._sourcesService.versionConflict;

  /**
   * FE-11 — vrai après une régénération de clé publique : l'installeur affiche
   * alors l'avertissement « l'ancien script ne fonctionne plus ».
   */
  public keyWasRegenerated = signal(false);

  public readonly tabs = computed(() => {
    const base = [
      { id: 'general', label: 'Général' },
      { id: 'mapping', label: 'Correspondance des champs' },
      { id: 'consent', label: 'Consentement' },
      { id: 'ingestions', label: 'Réceptions' },
    ];
    const mode = this.source()?.mode;
    if (mode === 'EmbeddedScript') {
      base.push({ id: 'script-config', label: 'Formulaire' });
      // FE-16 — l'éditeur n'a de sens que si le script doit rendre le formulaire.
      if (this.scriptConfig()?.formMode === 'hosted') {
        base.push({ id: 'hosted-form', label: 'Champs du formulaire' });
      }
      base.push(
        { id: 'script-install', label: 'Installer le script' },
        { id: 'script-verify', label: 'Vérification' },
      );
    }
    if (mode === 'ServerWebhook') {
      base.push({ id: 'webhook', label: 'Connexion' });
    }
    if (mode === 'ScheduledPull') {
      base.push(
        { id: 'pull-config', label: 'API fournisseur' },
        { id: 'pull-connection', label: 'Connexion' },
        { id: 'pull-test', label: 'Tester' },
        { id: 'pull-history', label: 'Historique' },
      );
    }
    return base;
  });

  // Label helpers
  public getChannelLabel = channelLabel;
  public getChannelIcon = channelIcon;
  public getModeLabel = modeLabel;
  public getStatusLabel = statusLabel;
  public getStatusSeverity = statusSeverity;
  public getHealthIcon = healthIcon;
  public getHealthColor = healthColor;

  /**
   * FE-02 — La permission locale ne suffit pas : un 403 serveur ne change rien
   * à `PermissionsService`, le bouton restait donc cliquable indéfiniment. On
   * combine les deux. `get()` remet `forbidden` à `false`, un rechargement
   * réussi restaure donc les actions.
   */
  public readonly canWrite = computed(
    () => this._permissions.has('lead:source:manage') && !this._sourcesService.forbidden(),
  );
  public readonly canManageSecrets = computed(
    () =>
      this._permissions.has('lead:source:credentials') &&
      !this._sourcesService.forbidden(),
  );
  public readonly canViewPayload = this._permissions.can('lead:ingestion:payload:read');
  public readonly canReplayIngestion = this._permissions.can('lead:ingestion:replay');

  // ——— FE-09: Activation prerequisites ———

  /**
   * Prérequis d'activation.
   *
   * La checklist ne portait que sur la correspondance des champs : une collecte
   * planifiée sans URL ni authentification, un script sans origine autorisée ou
   * une connexion plateforme sans connexion s'activaient sans un mot. Les
   * prérequis par mode ci-dessous sont **déduits des US** (FE-09, FE-10, FE-17,
   * FE-19) et restent **à confirmer côté API** : seul le serveur refuse pour de
   * bon une activation, cette liste ne fait que l'anticiper côté écran.
   */
  public readonly activationChecks = computed(() => {
    const settings = this.settings();
    if (!settings) return [];
    const src = this.source()!;
    const consent = settings.consent;
    const mappings = settings.fieldMappings;

    // FE-07 — la regle d'obligation vient de `field-mapping.types` : l'editeur
    // de correspondance et cette checklist ne peuvent plus diverger.
    const missing = missingRequiredFields(mappings);
    const checks: { label: string; ok: boolean }[] = [
      {
        label: 'Correspondance des champs configurée',
        ok: mappings.length > 0,
      },
      {
        label:
          missing.length > 0
            ? `Champs obligatoires non mappés : ${missing.map((g) => g.label).join(', ')}`
            : 'Champs obligatoires mappés',
        ok: missing.length === 0,
      },
    ];

    // FE-08 — controle inconditionnel : `consent` absent (onglet jamais ouvert)
    // ou politique `None` veut dire « aucune base legale », c'est l'inverse d'un
    // consentement valide. Sans ce controle, ne pas configurer le consentement
    // etait le moyen le plus simple d'activer une source.
    checks.push({
      label: 'Base légale de consentement définie',
      ok: !!consent && consent.policy !== 'None',
    });

    // Consent check depends on mode
    if (src.mode === 'EmbeddedScript') {
      checks.push({
        label: 'Champ de consentement configuré',
        ok: !!consent?.consentFieldPath,
      });
    } else if (consent?.policy === 'CollectedByForm') {
      checks.push({
        label: 'Champ de consentement configuré',
        ok: !!consent.consentFieldPath,
      });
    } else if (consent?.policy === 'ProviderAttested') {
      checks.push({
        label: 'Référence contrat fournisseur renseignée',
        ok: !!consent.providerContractRef,
      });
    }

    // Prerequis propres au mode. On commute sur `settings.$mode` — resolu depuis
    // `src.mode` par `readSettings` — pour que l'union discriminee narrow les
    // champs specifiques sans garde ni cast.
    switch (settings.$mode) {
      case 'EmbeddedScript': {
        const origins = settings.script?.allowedOrigins ?? [];
        checks.push({
          label: 'Au moins une origine autorisée',
          ok: origins.some((o) => !!o?.trim()),
        });
        break;
      }
      case 'ServerWebhook': {
        // Rien d'obligatoire au contrat : un webhook sans filtrage d'IP et sans
        // identifiant externe reste valide. En revanche, un chemin renseigne
        // mais invalide casserait la deduplication a la premiere reception.
        const path = settings.externalIdPath;
        if (path?.trim()) {
          checks.push({
            label: "Chemin de l'identifiant externe valide",
            ok: isValidJsonPath(path),
          });
        }
        break;
      }
      case 'ScheduledPull': {
        const pull = settings.pull;
        const baseUrl = pull?.baseUrl?.trim() ?? '';
        checks.push({
          label: "URL de base de l'API fournisseur en https://",
          ok: baseUrl.startsWith('https://'),
        });
        checks.push({
          label: "Type d'authentification choisi",
          ok: !!pull && pull.authType !== 'None',
        });
        break;
      }
      case 'PlatformConnection': {
        checks.push({
          label: 'Connexion plateforme associée',
          ok: !!src.platformConnectionId,
        });
        break;
      }
      case 'SocialTracking':
      case 'Internal':
        // Aucun prerequis supplementaire : ces modes n'ont pas de connexion
        // technique a configurer.
        break;
    }

    return checks;
  });

  public readonly canActivateSource = computed(() => {
    return this.activationChecks().every((c) => c.ok);
  });

  /**
   * FE-01 — Lecture unique des settings : `readSettings` normalise le sac libre
   * de l'API (casse comprise) en union discriminée sur `$mode`. Les vues
   * ci-dessous n'en sont que des projections ; plus aucun `as any`.
   */
  public readonly settings = computed((): LeadSourceSettings | null => {
    const src = this.source();
    return src ? readSettings(src.settings, src.mode) : null;
  });

  public readonly consentConfig = computed((): ConsentConfig | null => {
    return this.settings()?.consent ?? null;
  });

  public readonly scriptConfig = computed((): ScriptConfig | null => {
    const s = this.settings();
    return s && isScriptSettings(s) ? s.script : null;
  });

  public readonly pullConfig = computed((): PullConfig | null => {
    const s = this.settings();
    return s && isPullSettings(s) ? s.pull : null;
  });

  public readonly mappingRules = computed((): MappingRule[] => {
    return this.settings()?.fieldMappings ?? [];
  });

  /**
   * FE-08 AC3 — l'editeur de consentement ne peut bloquer l'enregistrement que
   * s'il sait qu'une regle persistee alimente reellement `consentGiven` : une
   * regle dont le champ source est vide ne collecte rien.
   */
  public readonly hasConsentMapping = computed((): boolean => {
    return this.mappingRules().some(
      (r) => r.targetField === 'consentGiven' && !!r.sourceField?.trim(),
    );
  });

  public readonly hostedFormConfig = computed((): HostedFormConfig | null => {
    const s = this.settings();
    return s && isScriptSettings(s) ? s.hostedForm : null;
  });

  ngOnInit(): void {
    const id = this._route.snapshot.paramMap.get('id')!;
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Sources & Campagnes', link: ['/settings/lead-sources'] },
      { label: 'Détail' },
    ]);
    // FE-05 — `?tab=` permet d'ouvrir directement l'assistant du mode apres la
    // creation. L'onglet n'est retenu que s'il existe pour ce mode (verifie une
    // fois la source chargee, `tabs()` en dependant).
    this._requestedTab = this._route.snapshot.queryParamMap.get('tab');
    // FE-23 AC2 — statut pre-filtre lorsqu'on arrive depuis le tableau qualite.
    this.requestedIngestionStatus.set(this._route.snapshot.queryParamMap.get('status'));
    this._load(id);
  }

  /** Onglet demandé par l'URL, appliqué une fois la source chargée. */
  private _requestedTab: string | null = null;

  /** Statut de réception demandé par l'URL (FE-23). */
  public requestedIngestionStatus = signal<string | null>(null);

  /** Etape sur laquelle ouvrir l'assistant pull (renvoi depuis le test a blanc). */
  public pullWizardStep = signal(0);

  /** FE-20 AC3 — le test a blanc renvoie sur l'etape fautive de l'assistant. */
  public onDryRunGoToStep(step: number): void {
    this.pullWizardStep.set(step);
    this.selectTab('pull-config');
  }

  public selectTab(id: string): void {
    this.activeTab.set(id);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { tab: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ——— FE-09: Lifecycle actions ———

  public activateSource(): void {
    const src = this.source()!;
    this._confirm.confirm({
      title: 'Activer cette source ?',
      message: `La source « ${src.label} » commencera à recevoir et créer des leads réels.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Activer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () =>
        this._lifecycleAction(this._sourcesService.activate(src.id!)),
    });
  }

  public pauseSource(): void {
    const src = this.source()!;
    const modeEffects: Record<string, string> = {
      EmbeddedScript: 'Les soumissions du formulaire seront refusées.',
      ServerWebhook: 'Le fournisseur recevra une réponse 403.',
      ScheduledPull: 'Les exécutions planifiées seront arrêtées.',
    };
    const effect =
      modeEffects[src.mode ?? ''] ??
      'Aucun lead ne sera créé tant que la source est en pause.';

    this._confirm.confirm({
      title: 'Mettre en pause ?',
      message: `La source « ${src.label} » sera suspendue. ${effect}`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Mettre en pause', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._lifecycleAction(this._sourcesService.pause(src.id!)),
    });
  }

  public archiveSource(): void {
    const src = this.source()!;
    this._confirm.confirm({
      title: 'Archiver cette source ?',
      message: `La source « ${src.label} » sera définitivement archivée. Les leads existants restent consultables.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Archiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._lifecycleAction(this._sourcesService.archive(src.id!));
      },
    });
  }

  private _lifecycleAction(obs: Observable<any>): void {
    this.actionLoading.set(true);
    obs
      .pipe(
        catchError(() => {
          this.actionLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.actionLoading.set(false);
        this._load(this.source()!.id!);
      });
  }

  public onPullConfigSaved(pull: PullConfig): void {
    const src = this.source();
    if (!src) return;
    this._sourcesService
      .update(src.id!, {
        version: src.version,
        label: src.label,
        settings: writeSettings(src.settings, src.mode, { pull }),
        costPerLead: pull.costPerLead,
        costCurrency: pull.costCurrency || null,
      })
      .pipe(catchError(() => EMPTY))
      .subscribe(() => {
        this._snackbar.success(
          'Enregistré',
          "La configuration de l'API fournisseur a été mise à jour.",
        );
        this._load(src.id!);
      });
  }

  public onHostedFormSaved(hostedForm: HostedFormConfig): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService
      .update(src.id!, {
        version: src.version,
        label: src.label,
        settings: writeSettings(src.settings, src.mode, { hostedForm }),
      })
      .pipe(catchError(() => EMPTY))
      .subscribe(() => {
        this._snackbar.success('Enregistré', 'Le formulaire hébergé a été mis à jour.');
        this._load(src.id!);
      });
  }

  public onScriptConfigSaved(script: ScriptConfig): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService
      .update(src.id!, {
        version: src.version,
        label: src.label,
        settings: writeSettings(src.settings, src.mode, { script }),
      })
      .pipe(catchError(() => EMPTY))
      .subscribe(() => {
        this._snackbar.success(
          'Enregistré',
          'La configuration du formulaire a été mise à jour.',
        );
        this._load(src.id!);
        // FE-10 AC5 — la fin de l'assistant enchaine sur l'ecran d'installation.
        this.selectTab('script-install');
      });
  }

  public onSourceActivated(): void {
    this.reloadSource();
  }

  /**
   * FE-11 — la regeneration de cle invalide le script deja installe : on
   * recharge la source ET on memorise l'evenement pour que l'installeur puisse
   * l'annoncer.
   */
  public onKeyRotated(): void {
    this.keyWasRegenerated.set(true);
    this.reloadSource();
  }

  /**
   * Rechargement déclenché par l'utilisateur : conflit de version (409) ou
   * échec du chargement initial.
   */
  public reloadSource(): void {
    if (this._sourceId) this._load(this._sourceId);
  }

  /**
   * Incrémenté à chaque refus serveur d'un onglet éditeur. Les enfants s'y abonnent pour
   * relâcher leur bouton « Enregistrer » : ils ne voient pas l'erreur, que le service
   * traite et que ce composant avale.
   */
  public readonly saveFailedAt = signal(0);

  public onConsentSaved(consent: ConsentConfig): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService
      .update(src.id!, {
        version: src.version,
        label: src.label,
        settings: writeSettings(src.settings, src.mode, { consent }),
      })
      .pipe(
        catchError(() => {
          this.saveFailedAt.update((n) => n + 1);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Enregistré',
          'La politique de consentement a été mise à jour.',
        );
        this._load(src.id!);
      });
  }

  public onMappingSaved(rules: MappingRule[]): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService
      .update(src.id!, {
        version: src.version,
        label: src.label,
        settings: writeSettings(src.settings, src.mode, {
          fieldMappings: toPersistedRules(rules),
        }),
      })
      .pipe(
        catchError(() => {
          this.saveFailedAt.update((n) => n + 1);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Enregistré',
          'La correspondance des champs a été mise à jour.',
        );
        this._load(src.id!);
      });
  }

  private _load(id: string): void {
    this._sourceId = id;
    // Le spinner plein ecran est reserve au PREMIER chargement : un rechargement
    // apres enregistrement doit laisser l'en-tete, les onglets et l'onglet
    // courant montes, sinon l'etat local des enfants repart de zero.
    if (this.source()) this.isRefreshing.set(true);
    else this.isLoading.set(true);
    this._sourcesService
      .get(id)
      .pipe(
        catchError(() => {
          this.isLoading.set(false);
          this.isRefreshing.set(false);
          return EMPTY;
        }),
      )
      .subscribe((detail) => {
        this.source.set(detail);
        if (this._requestedTab) {
          const exists = this.tabs().some((t) => t.id === this._requestedTab);
          if (exists) this.activeTab.set(this._requestedTab);
          this._requestedTab = null;
        }
        this._breadcrumb.set([
          { label: 'Paramétrage', link: ['/settings'] },
          { label: 'Sources & Campagnes', link: ['/settings/lead-sources'] },
          { label: detail.label ?? detail.code ?? 'Détail' },
        ]);
        this.isLoading.set(false);
        this.isRefreshing.set(false);
      });
  }
}

export default EditLeadSource;
