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
import { AuthenticationService, BreadcrumbService } from '@sankore/crm/common';
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
  private readonly _auth = inject(AuthenticationService);

  public isLoading = signal(true);
  public actionLoading = signal(false);
  public source = signal<LeadSourceDetailDto | null>(null);
  public activeTab = signal('general');

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

  public readonly canWrite = computed(() => {
    const perms = this._auth.connectedUser()?.permissions ?? [];
    return perms.includes('lead:source:manage');
  });

  public readonly canManageSecrets = computed(() => {
    const perms = this._auth.connectedUser()?.permissions ?? [];
    return perms.includes('lead:source:credentials');
  });

  public readonly canViewPayload = computed(() => {
    const perms = this._auth.connectedUser()?.permissions ?? [];
    return perms.includes('lead:ingestion:payload:read');
  });

  public readonly canReplayIngestion = computed(() => {
    const perms = this._auth.connectedUser()?.permissions ?? [];
    return perms.includes('lead:ingestion:replay');
  });

  // ——— FE-09: Activation prerequisites ———

  public readonly activationChecks = computed(() => {
    const settings = this.settings();
    if (!settings) return [];
    const src = this.source()!;
    const consent = settings.consent;
    const mappings = settings.fieldMappings;

    // FE-07 — la regle d'obligation vient de `field-mapping.types` : l'editeur
    // de correspondance et cette checklist ne peuvent plus diverger.
    const missing = missingRequiredFields(mappings);
    const checks = [
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
      });
  }

  public onSourceActivated(): void {
    this._load(this.source()!.id!);
  }

  public onConsentSaved(consent: ConsentConfig): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService
      .update(src.id!, {
        version: src.version,
        label: src.label,
        settings: writeSettings(src.settings, src.mode, { consent }),
      })
      .pipe(catchError(() => EMPTY))
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
      .pipe(catchError(() => EMPTY))
      .subscribe(() => {
        this._snackbar.success(
          'Enregistré',
          'La correspondance des champs a été mise à jour.',
        );
        this._load(src.id!);
      });
  }

  private _load(id: string): void {
    this.isLoading.set(true);
    this._sourcesService
      .get(id)
      .pipe(
        catchError(() => {
          this.isLoading.set(false);
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
      });
  }
}

export default EditLeadSource;
