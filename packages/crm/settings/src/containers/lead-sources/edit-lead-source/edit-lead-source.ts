import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, Observable } from 'rxjs';
import { LeadSourcesService } from '../lead-sources.service';
import {
  channelLabel, modeLabel, statusLabel, statusSeverity,
  healthIcon, healthColor, channelIcon,
} from '../lead-source.types';
import { FieldMappingEditor } from '../field-mapping-editor/field-mapping-editor';
import { emptyRule, MappingRule } from '../field-mapping.types';
import { ConsentPolicyEditor, ConsentConfig } from '../consent-policy-editor/consent-policy-editor';
import { ScriptWizard, ScriptConfig } from '../script-wizard';
import { ScriptInstaller } from '../script-installer';
import { ScriptVerifier } from '../script-verifier';
import { WebhookConnection } from '../webhook-connection';
import { PullWizard, PullConfig } from '../pull-wizard/pull-wizard';
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
    ScriptInstaller,
    ScriptVerifier,
    WebhookConnection,
    PullWizard,
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
      base.push(
        { id: 'script-config', label: 'Formulaire' },
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
    const src = this.source();
    if (!src) return [];
    const settings = (src.settings as any) ?? {};
    const consent: ConsentConfig | null = settings.consent ?? null;
    const mappings: any[] = settings.FieldMappings ?? [];

    const checks = [
      {
        label: 'Correspondance des champs configurée',
        ok: mappings.length > 0,
      },
      {
        label: 'Champs obligatoires mappés (prénom ou nom, téléphone)',
        ok:
          mappings.some(
            (m: any) =>
              m.TargetField === 'firstName' ||
              m.TargetField === 'lastName' ||
              m.TargetField === 'fullName',
          ) && mappings.some((m: any) => m.TargetField === 'phoneNumber'),
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

  public readonly consentConfig = computed((): ConsentConfig | null => {
    const settings = this.source()?.settings as any;
    if (!settings?.consent) return null;
    return settings.consent as ConsentConfig;
  });

  public readonly scriptConfig = computed((): ScriptConfig | null => {
    const settings = this.source()?.settings as any;
    if (!settings?.script) return null;
    return settings.script as ScriptConfig;
  });

  public readonly pullConfig = computed((): PullConfig | null => {
    const settings = this.source()?.settings as any;
    if (!settings?.pull) return null;
    return settings.pull as PullConfig;
  });

  public readonly mappingRules = computed((): MappingRule[] => {
    const settings = this.source()?.settings as any;
    console.log({ settings });
    const raw = settings?.FieldMappings;
    if (!Array.isArray(raw)) return [];
    // Les règles persistées stockent `null` pour les options non utilisées
    // (cf. onMappingSaved) : on retombe sur les valeurs par défaut.
    return raw.map((m: any) => {
      const base = emptyRule();
      return {
        ...base,
        sourceField: m.SourceField ?? base.sourceField,
        targetField: m.TargetField ?? base.targetField,
        transformation: m.Transformation ?? base.transformation,
        defaultValue: m.DefaultValue ?? base.defaultValue,
        e164Country: m.E164Country ?? base.e164Country,
        mapEntries: m.PapEntries ?? base.mapEntries,
        concatSeparator: m.ConcatSeparator ?? base.concatSeparator,
      };
    });
  });

  ngOnInit(): void {
    const id = this._route.snapshot.paramMap.get('id')!;
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Sources & Campagnes', link: ['/settings/lead-sources'] },
      { label: 'Détail' },
    ]);
    this._load(id);
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
        settings: { ...(src.settings ?? {}), pull } as any,
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

  public onScriptConfigSaved(script: ScriptConfig): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService
      .update(src.id!, {
        version: src.version,
        label: src.label,
        settings: {
          ...(src.settings ?? {}),
          script,
        } as any,
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
        settings: {
          ...(src.settings ?? {}),
          consent,
        } as any,
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
        settings: {
          ...(src.settings ?? {}),
          $mode: src.mode,
          fieldMappings: rules.map((r) => ({
            sourceField: r.sourceField,
            targetField: r.targetField,
            transformation: r.transformation,
            defaultValue: r.defaultValue || null,
            e164Country: r.transformation === 'e164' ? r.e164Country : null,
            mapEntries: r.transformation === 'map' ? r.mapEntries : null,
            concatSeparator:
              r.transformation === 'concat' ? r.concatSeparator : null,
          })),
        } as any,
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
