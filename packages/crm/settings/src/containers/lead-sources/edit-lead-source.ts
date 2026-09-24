import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, Observable } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { LeadSourceDetailDto } from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService } from '@sankore/crm/common';
import { LeadSourcesService } from './lead-sources.service';
import {
  channelLabel, modeLabel, statusLabel, statusSeverity,
  healthIcon, healthColor, channelIcon,
} from './lead-source.types';
import { FieldMappingEditor } from './field-mapping-editor';
import { MappingRule } from './field-mapping.types';
import { ConsentPolicyEditor, ConsentConfig } from './consent-policy-editor';
import { ScriptWizard, ScriptConfig } from './script-wizard';
import { ScriptInstaller } from './script-installer';
import { ScriptVerifier } from './script-verifier';
import { WebhookConnection } from './webhook-connection';
import { PullWizard, PullConfig } from './pull-wizard';
import { PullDryRun } from './pull-dry-run';
import { RunHistory } from './run-history';
import { IngestionList } from './ingestion-list';

@Component({
  selector: 'edit-lead-source',
  standalone: true,
  imports: [
    RouterLink, TasCard, TasSpinner, TasIcon, TasTag, Button,
    Menu, MenuItem, TasMenuTrigger,
    FieldMappingEditor, ConsentPolicyEditor,
    ScriptWizard, ScriptInstaller, ScriptVerifier,
    WebhookConnection,
    PullWizard, PullDryRun, RunHistory, IngestionList,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (source()) {
      <div class="pb-6">
        <!-- Header -->
        <div class="flex items-center gap-3 mb-6">
          <a [routerLink]="['/settings/lead-sources']" tas-icon-button>
            <tas-icon iconName="feather:arrow-left" style="font-size:16px"></tas-icon>
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <tas-icon [iconName]="getChannelIcon(source()!.channelType)"
                        class="text-slate-400" style="font-size:16px"></tas-icon>
              <h1 class="text-lg font-semibold text-slate-800 truncate">{{ source()!.label }}</h1>
              <span class="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded">
                {{ source()!.code }}
              </span>
              <tas-tag [severity]="getStatusSeverity(source()!.status)">
                {{ getStatusLabel(source()!.status) }}
              </tas-tag>
            </div>
            <p class="text-xs text-slate-400 mt-0.5">
              {{ getChannelLabel(source()!.channelType) }} · {{ getModeLabel(source()!.mode) }}
            </p>
          </div>

          <!-- Lifecycle actions (FE-09) -->
          @if (canWrite() && !source()!.isSystem) {
            <div class="flex items-center gap-2">
              @if (actionLoading()) {
                <tas-spinner size="4"></tas-spinner>
              } @else {
                @switch (source()!.status) {
                  @case ('Draft') {
                    <button tas-raised-button color="primary" type="button"
                            [disabled]="!canActivateSource()"
                            (click)="activateSource()">
                      <tas-icon iconName="feather:play" style="font-size:14px"></tas-icon>
                      Activer
                    </button>
                  }
                  @case ('Testing') {
                    <button tas-raised-button color="primary" type="button"
                            [disabled]="!canActivateSource()"
                            (click)="activateSource()">
                      <tas-icon iconName="feather:play" style="font-size:14px"></tas-icon>
                      Activer
                    </button>
                  }
                  @case ('Active') {
                    <button tas-outlined-button color="warn" type="button" (click)="pauseSource()">
                      <tas-icon iconName="feather:pause" style="font-size:14px"></tas-icon>
                      Mettre en pause
                    </button>
                  }
                  @case ('Paused') {
                    <button tas-raised-button color="primary" type="button" (click)="activateSource()">
                      <tas-icon iconName="feather:play" style="font-size:14px"></tas-icon>
                      Réactiver
                    </button>
                  }
                  @case ('Error') {
                    <button tas-raised-button color="primary" type="button" (click)="activateSource()">
                      <tas-icon iconName="feather:refresh-cw" style="font-size:14px"></tas-icon>
                      Réessayer
                    </button>
                  }
                }
                @if (source()!.status !== 'Archived') {
                  <button tas-icon-button TasMenuTrigger [panel]="moreMenu">
                    <tas-icon iconName="feather:more-vertical" style="font-size:14px"></tas-icon>
                  </button>
                  <ng-template #moreMenu>
                    <tas-menu>
                      <tas-menu-item (click)="archiveSource()">
                        <tas-icon iconName="feather:archive" style="font-size:12px" class="text-slate-400"></tas-icon>
                        Archiver
                      </tas-menu-item>
                    </tas-menu>
                  </ng-template>
                }
              }
            </div>
          }
        </div>

        <!-- Error banner -->
        @if (source()!.status === 'Error') {
          <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <tas-icon iconName="feather:alert-circle" class="text-red-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
            <div class="flex-1">
              <p class="text-xs font-medium text-red-800">Source en erreur</p>
              <p class="text-xs text-red-600 mt-0.5">
                La dernière exécution a échoué. Vérifiez la configuration puis cliquez « Réessayer ».
              </p>
            </div>
          </div>
        }

        <!-- Activation prerequisites checklist (Draft/Testing) -->
        @if ((source()!.status === 'Draft' || source()!.status === 'Testing') && !canActivateSource()) {
          <div class="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p class="text-xs font-medium text-amber-800 mb-2 flex items-center gap-1">
              <tas-icon iconName="feather:alert-triangle" class="text-amber-500" style="font-size:12px"></tas-icon>
              Prérequis pour l'activation
            </p>
            <ul class="space-y-1.5">
              @for (check of activationChecks(); track check.label) {
                <li class="flex items-center gap-2 text-xs">
                  @if (check.ok) {
                    <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:12px"></tas-icon>
                    <span class="text-slate-600">{{ check.label }}</span>
                  } @else {
                    <tas-icon iconName="feather:x-circle" class="text-red-400" style="font-size:12px"></tas-icon>
                    <span class="text-red-700 font-medium">{{ check.label }}</span>
                  }
                </li>
              }
            </ul>
          </div>
        }

        <!-- Archived banner -->
        @if (source()!.status === 'Archived') {
          <div class="mb-4 p-3 bg-slate-100 border border-slate-200 rounded-lg flex items-start gap-2">
            <tas-icon iconName="feather:archive" class="text-slate-400 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
            <p class="text-xs text-slate-600">
              Cette source est archivée. Les leads existants restent consultables mais aucun nouveau lead ne sera créé.
            </p>
          </div>
        }

        <!-- Tabs -->
        <div class="flex border-b border-slate-200 mb-6">
          @for (tab of tabs(); track tab.id) {
            <button class="px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px"
                    [class]="activeTab() === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-slate-500 hover:text-slate-700'"
                    (click)="activeTab.set(tab.id)">
              {{ tab.label }}
            </button>
          }
        </div>

        <!-- Tab content -->
        @switch (activeTab()) {
          @case ('general') {
            <div class="max-w-3xl">
              <tas-card class="block">
                <div class="p-4 border-b border-slate-100">
                  <p class="text-sm font-semibold text-slate-700">Informations générales</p>
                </div>
                <div class="p-4 grid grid-cols-2 gap-4">
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Code</p>
                    <p class="text-sm text-slate-800 font-mono">{{ source()!.code }}</p>
                  </div>
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Libellé</p>
                    <p class="text-sm text-slate-800">{{ source()!.label }}</p>
                  </div>
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Canal</p>
                    <p class="text-sm text-slate-800">{{ getChannelLabel(source()!.channelType) }}</p>
                  </div>
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Mode</p>
                    <p class="text-sm text-slate-800">{{ getModeLabel(source()!.mode) }}</p>
                  </div>
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Version</p>
                    <p class="text-sm text-slate-800">{{ source()!.version }}</p>
                  </div>
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Déduplication</p>
                    <p class="text-sm text-slate-800">{{ source()!.dedupWindowDays ?? 30 }} jours</p>
                  </div>
                  @if (source()!.description) {
                    <div class="col-span-2">
                      <p class="text-xs text-slate-400 mb-1">Description</p>
                      <p class="text-sm text-slate-800">{{ source()!.description }}</p>
                    </div>
                  }
                </div>
              </tas-card>

              <!-- Secrets -->
              @if (source()!.secrets?.length) {
                <tas-card class="block mt-4">
                  <div class="p-4 border-b border-slate-100">
                    <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <tas-icon iconName="feather:key" class="text-slate-400" style="font-size:14px"></tas-icon>
                      Secrets
                    </p>
                  </div>
                  <div class="divide-y divide-slate-100">
                    @for (secret of source()!.secrets; track secret.name) {
                      <div class="p-4 flex items-center justify-between">
                        <div>
                          <p class="text-sm font-medium text-slate-800">{{ secret.name }}</p>
                          <p class="text-xs text-slate-400 font-mono">{{ secret.hint }}</p>
                        </div>
                        @if (secret.updatedAt) {
                          <span class="text-xs text-slate-400">Mis à jour : {{ secret.updatedAt }}</span>
                        }
                      </div>
                    }
                  </div>
                </tas-card>
              }
            </div>
          }

          @case ('mapping') {
            <field-mapping-editor
              [sourceId]="source()!.id!"
              [mode]="source()!.mode ?? null"
              [readonly]="!canWrite()"
              (saved)="onMappingSaved($event)"
            ></field-mapping-editor>
          }

          @case ('consent') {
            <consent-policy-editor
              [mode]="source()!.mode ?? null"
              [readonly]="!canWrite()"
              [initialConfig]="consentConfig()"
              (configSaved)="onConsentSaved($event)"
            ></consent-policy-editor>
          }

          @case ('script-config') {
            <script-wizard
              [initialConfig]="scriptConfig()"
              [readonly]="!canWrite()"
              (saved)="onScriptConfigSaved($event)"
            ></script-wizard>
          }

          @case ('script-install') {
            <script-installer [sourceId]="source()!.id!"></script-installer>
          }

          @case ('script-verify') {
            <script-verifier
              [sourceId]="source()!.id!"
              [sourceStatus]="source()!.status ?? null"
              (activated)="onSourceActivated()"
            ></script-verifier>
          }

          @case ('webhook') {
            <webhook-connection
              [source]="source()!"
              [readonly]="!canWrite()"
              [canManageSecrets]="canManageSecrets()"
              (settingsSaved)="onSourceActivated()"
            ></webhook-connection>
          }

          @case ('pull-config') {
            <pull-wizard
              [initialConfig]="pullConfig()"
              [readonly]="!canWrite()"
              (saved)="onPullConfigSaved($event)"
            ></pull-wizard>
          }

          @case ('pull-test') {
            <pull-dry-run [sourceId]="source()!.id!"></pull-dry-run>
          }

          @case ('pull-history') {
            <run-history
              [sourceId]="source()!.id!"
              [sourceStatus]="source()!.status ?? null"
              [canPull]="canWrite() && source()!.status === 'Active'"
            ></run-history>
          }

          @case ('ingestions') {
            <ingestion-list
              [sourceId]="source()!.id!"
              [canViewPayload]="canViewPayload()"
              [canReplay]="canReplayIngestion()"
            ></ingestion-list>
          }
        }
      </div>
    }
  `,
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
      base.push(
        { id: 'webhook', label: 'Connexion' },
      );
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
    const settings = src.settings as any ?? {};
    const consent: ConsentConfig | null = settings.consent ?? null;
    const mappings: any[] = settings.fieldMappings ?? [];

    const checks = [
      {
        label: 'Correspondance des champs configurée',
        ok: mappings.length > 0,
      },
      {
        label: 'Champs obligatoires mappés (prénom ou nom, téléphone)',
        ok: mappings.some((m: any) => m.targetField === 'firstName' || m.targetField === 'lastName' || m.targetField === 'fullName')
          && mappings.some((m: any) => m.targetField === 'phoneNumber'),
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
      accept: () => this._lifecycleAction(this._sourcesService.activate(src.id!)),
    });
  }

  public pauseSource(): void {
    const src = this.source()!;
    const modeEffects: Record<string, string> = {
      EmbeddedScript: 'Les soumissions du formulaire seront refusées.',
      ServerWebhook: 'Le fournisseur recevra une réponse 403.',
      ScheduledPull: 'Les exécutions planifiées seront arrêtées.',
    };
    const effect = modeEffects[src.mode ?? ''] ?? 'Aucun lead ne sera créé tant que la source est en pause.';

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
    obs.pipe(
      catchError(() => {
        this.actionLoading.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.actionLoading.set(false);
      this._load(this.source()!.id!);
    });
  }

  public onPullConfigSaved(pull: PullConfig): void {
    const src = this.source();
    if (!src) return;
    this._sourcesService.update(src.id!, {
      version: src.version,
      label: src.label,
      settings: { ...(src.settings ?? {}), pull } as any,
      costPerLead: pull.costPerLead,
      costCurrency: pull.costCurrency || null,
    }).pipe(catchError(() => EMPTY)).subscribe(() => {
      this._snackbar.success('Enregistré', 'La configuration de l\'API fournisseur a été mise à jour.');
      this._load(src.id!);
    });
  }

  public onScriptConfigSaved(script: ScriptConfig): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService.update(src.id!, {
      version: src.version,
      label: src.label,
      settings: {
        ...(src.settings ?? {}),
        script,
      } as any,
    }).pipe(
      catchError(() => EMPTY),
    ).subscribe(() => {
      this._snackbar.success('Enregistré', 'La configuration du formulaire a été mise à jour.');
      this._load(src.id!);
    });
  }

  public onSourceActivated(): void {
    this._load(this.source()!.id!);
  }

  public onConsentSaved(consent: ConsentConfig): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService.update(src.id!, {
      version: src.version,
      label: src.label,
      settings: {
        ...(src.settings ?? {}),
        consent,
      } as any,
    }).pipe(
      catchError(() => EMPTY),
    ).subscribe(() => {
      this._snackbar.success('Enregistré', 'La politique de consentement a été mise à jour.');
      this._load(src.id!);
    });
  }

  public onMappingSaved(rules: MappingRule[]): void {
    const src = this.source();
    if (!src) return;

    this._sourcesService.update(src.id!, {
      version: src.version,
      label: src.label,
      settings: {
        ...(src.settings ?? {}),
        fieldMappings: rules.map((r) => ({
          sourceField: r.sourceField,
          targetField: r.targetField,
          transformation: r.transformation,
          defaultValue: r.defaultValue || null,
          e164Country: r.transformation === 'e164' ? r.e164Country : null,
          mapEntries: r.transformation === 'map' ? r.mapEntries : null,
          concatSeparator: r.transformation === 'concat' ? r.concatSeparator : null,
        })),
      } as any,
    }).pipe(
      catchError(() => EMPTY),
    ).subscribe(() => {
      this._snackbar.success('Enregistré', 'La correspondance des champs a été mise à jour.');
      this._load(src.id!);
    });
  }

  private _load(id: string): void {
    this.isLoading.set(true);
    this._sourcesService.get(id).pipe(
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((detail) => {
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
