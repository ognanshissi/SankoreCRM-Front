import { Component, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSwitch } from '@talisoft/ui/switch';

/**
 * FE-19 + FE-21 — Assistant « API du fournisseur »
 * Steps: Connexion → Requête → Pagination → Extraction → Planification → Accusé → Coût
 */

export interface PullConfig {
  baseUrl: string;
  authType: 'ApiKey' | 'Bearer' | 'OAuthClientCredentials' | 'Basic' | 'None';
  authHeaderName: string;
  authHeaderLocation: 'header' | 'query';
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthScope: string;
  requestMethod: 'GET' | 'POST';
  requestPath: string;
  requestParams: string;
  paginationStrategy: 'None' | 'Page' | 'Offset' | 'Cursor' | 'LinkHeader' | 'Since';
  pageParamName: string;
  pageSizeParamName: string;
  cursorJsonPath: string;
  sinceField: string;
  dataJsonPath: string;
  idJsonPath: string;
  dateJsonPath: string;
  cronExpression: string;
  schedulePreset: string;
  ackEnabled: boolean;
  ackMethod: 'POST' | 'PUT' | 'PATCH';
  ackPath: string;
  costPerLead: number | null;
  costCurrency: string;
}

export function defaultPullConfig(): PullConfig {
  return {
    baseUrl: '',
    authType: 'None',
    authHeaderName: 'X-API-Key',
    authHeaderLocation: 'header',
    oauthTokenUrl: '',
    oauthClientId: '',
    oauthScope: '',
    requestMethod: 'GET',
    requestPath: '/leads',
    requestParams: '',
    paginationStrategy: 'None',
    pageParamName: 'page',
    pageSizeParamName: 'pageSize',
    cursorJsonPath: '$.nextCursor',
    sinceField: 'since',
    dataJsonPath: '$.data',
    idJsonPath: '$.id',
    dateJsonPath: '$.createdAt',
    cronExpression: '',
    schedulePreset: '15min',
    ackEnabled: false,
    ackMethod: 'POST',
    ackPath: '/leads/ack',
    costPerLead: null,
    costCurrency: 'XOF',
  };
}

const AUTH_OPTIONS = [
  { label: 'Aucune', value: 'None' },
  { label: 'Clé API', value: 'ApiKey' },
  { label: 'Bearer Token', value: 'Bearer' },
  { label: 'OAuth Client Credentials', value: 'OAuthClientCredentials' },
  { label: 'Basic Auth', value: 'Basic' },
];

const METHOD_OPTIONS = [
  { label: 'GET', value: 'GET' },
  { label: 'POST', value: 'POST' },
];

const PAGINATION_OPTIONS = [
  { label: 'Aucune', value: 'None' },
  { label: 'Numéro de page', value: 'Page' },
  { label: 'Offset / Limit', value: 'Offset' },
  { label: 'Curseur', value: 'Cursor' },
  { label: 'En-tête Link', value: 'LinkHeader' },
  { label: 'Depuis (since)', value: 'Since' },
];

const SCHEDULE_PRESETS = [
  { label: 'Toutes les 5 minutes', value: '5min', cron: '*/5 * * * *' },
  { label: 'Toutes les 15 minutes', value: '15min', cron: '*/15 * * * *' },
  { label: 'Toutes les 30 minutes', value: '30min', cron: '*/30 * * * *' },
  { label: 'Toutes les heures', value: '1h', cron: '0 * * * *' },
  { label: 'Quotidienne (6h)', value: 'daily', cron: '0 6 * * *' },
  { label: 'Personnalisée (cron)', value: 'custom', cron: '' },
];

const HEADER_LOCATION_OPTIONS = [
  { label: 'En-tête HTTP', value: 'header' },
  { label: 'Paramètre de requête', value: 'query' },
];

const VARIABLE_HINTS = '{{since}}, {{cursor}}, {{page}}, {{pageSize}}';

@Component({
  selector: 'pull-wizard',
  standalone: true,
  imports: [
    FormsModule, TasCard, TasIcon, Button,
    TasFormField, TasLabel, TasInput, TasSelect, TasSwitch,
  ],
  template: `
    <div class="max-w-3xl flex flex-col gap-4">
      <!-- Step indicator -->
      <div class="flex items-center gap-1 mb-2 flex-wrap">
        @for (s of steps; track s.id; let i = $index) {
          <button class="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                  [class]="currentStep() === i
                    ? 'bg-primary text-white'
                    : i < currentStep() ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'"
                  (click)="currentStep.set(i)">
            @if (i < currentStep()) {
              <tas-icon iconName="feather:check" style="font-size:9px"></tas-icon>
            }
            {{ s.label }}
          </button>
          @if (i < steps.length - 1) {
            <div class="w-3 h-px bg-slate-300"></div>
          }
        }
      </div>

      <!-- Step 1: Connexion -->
      @if (currentStep() === 0) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Connexion à l'API</p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <tas-form-field>
              <tas-label>URL de base <span class="text-red-500">*</span></tas-label>
              <input tasInput type="url" placeholder="https://api.fournisseur.com"
                     [ngModel]="config().baseUrl" (ngModelChange)="set('baseUrl', $event)" [disabled]="readonly()" />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Authentification</tas-label>
              <tas-select [options]="authOptions" optionLabel="label" optionValue="value"
                          [ngModel]="config().authType" (ngModelChange)="set('authType', $event)" [disabled]="readonly()"></tas-select>
            </tas-form-field>

            @if (config().authType === 'ApiKey') {
              <div class="grid grid-cols-2 gap-3">
                <tas-form-field>
                  <tas-label>Nom du header/param</tas-label>
                  <input tasInput type="text" placeholder="X-API-Key"
                         [ngModel]="config().authHeaderName" (ngModelChange)="set('authHeaderName', $event)" [disabled]="readonly()" />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Emplacement</tas-label>
                  <tas-select [options]="headerLocationOptions" optionLabel="label" optionValue="value"
                              [ngModel]="config().authHeaderLocation" (ngModelChange)="set('authHeaderLocation', $event)" [disabled]="readonly()"></tas-select>
                </tas-form-field>
              </div>
            }

            @if (config().authType === 'OAuthClientCredentials') {
              <tas-form-field>
                <tas-label>URL du jeton</tas-label>
                <input tasInput type="url" placeholder="https://auth.fournisseur.com/token"
                       [ngModel]="config().oauthTokenUrl" (ngModelChange)="set('oauthTokenUrl', $event)" [disabled]="readonly()" />
              </tas-form-field>
              <div class="grid grid-cols-2 gap-3">
                <tas-form-field>
                  <tas-label>Client ID</tas-label>
                  <input tasInput type="text" [ngModel]="config().oauthClientId" (ngModelChange)="set('oauthClientId', $event)" [disabled]="readonly()" />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Scope</tas-label>
                  <input tasInput type="text" placeholder="leads:read"
                         [ngModel]="config().oauthScope" (ngModelChange)="set('oauthScope', $event)" [disabled]="readonly()" />
                </tas-form-field>
              </div>
            }

            <p class="text-xs text-slate-400">
              Les secrets (clé API, secret OAuth, mot de passe) sont saisis séparément dans l'onglet Connexion pour ne jamais être stockés en clair.
            </p>
          </div>
        </tas-card>
      }

      <!-- Step 2: Requête -->
      @if (currentStep() === 1) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Requête</p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <div class="grid grid-cols-3 gap-3">
              <tas-form-field>
                <tas-label>Méthode</tas-label>
                <tas-select [options]="methodOptions" optionLabel="label" optionValue="value"
                            [ngModel]="config().requestMethod" (ngModelChange)="set('requestMethod', $event)" [disabled]="readonly()"></tas-select>
              </tas-form-field>
              <tas-form-field class="col-span-2">
                <tas-label>Chemin</tas-label>
                <input tasInput type="text" placeholder="/api/v1/leads"
                       [ngModel]="config().requestPath" (ngModelChange)="set('requestPath', $event)" [disabled]="readonly()" />
              </tas-form-field>
            </div>
            <tas-form-field>
              <tas-label>Paramètres de requête</tas-label>
              <input tasInput type="text" [placeholder]="requestParamsPlaceholder"
                     [ngModel]="config().requestParams" (ngModelChange)="set('requestParams', $event)" [disabled]="readonly()" />
              <p class="text-xs text-slate-400 mt-1">Variables disponibles : {{ variableHints }}</p>
            </tas-form-field>
          </div>
        </tas-card>
      }

      <!-- Step 3: Pagination -->
      @if (currentStep() === 2) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Pagination</p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Stratégie</tas-label>
              <tas-select [options]="paginationOptions" optionLabel="label" optionValue="value"
                          [ngModel]="config().paginationStrategy" (ngModelChange)="set('paginationStrategy', $event)" [disabled]="readonly()"></tas-select>
            </tas-form-field>

            @switch (config().paginationStrategy) {
              @case ('Page') {
                <div class="grid grid-cols-2 gap-3">
                  <tas-form-field>
                    <tas-label>Paramètre de page</tas-label>
                    <input tasInput type="text" placeholder="page" [ngModel]="config().pageParamName" (ngModelChange)="set('pageParamName', $event)" [disabled]="readonly()" />
                  </tas-form-field>
                  <tas-form-field>
                    <tas-label>Paramètre de taille</tas-label>
                    <input tasInput type="text" placeholder="pageSize" [ngModel]="config().pageSizeParamName" (ngModelChange)="set('pageSizeParamName', $event)" [disabled]="readonly()" />
                  </tas-form-field>
                </div>
              }
              @case ('Offset') {
                <div class="grid grid-cols-2 gap-3">
                  <tas-form-field>
                    <tas-label>Paramètre offset</tas-label>
                    <input tasInput type="text" placeholder="offset" [ngModel]="config().pageParamName" (ngModelChange)="set('pageParamName', $event)" [disabled]="readonly()" />
                  </tas-form-field>
                  <tas-form-field>
                    <tas-label>Paramètre limit</tas-label>
                    <input tasInput type="text" placeholder="limit" [ngModel]="config().pageSizeParamName" (ngModelChange)="set('pageSizeParamName', $event)" [disabled]="readonly()" />
                  </tas-form-field>
                </div>
              }
              @case ('Cursor') {
                <tas-form-field>
                  <tas-label>JSONPath du curseur suivant</tas-label>
                  <input tasInput type="text" placeholder="$.meta.nextCursor" class="font-mono"
                         [ngModel]="config().cursorJsonPath" (ngModelChange)="set('cursorJsonPath', $event)" [disabled]="readonly()" />
                </tas-form-field>
              }
              @case ('Since') {
                <tas-form-field>
                  <tas-label>Champ « depuis »</tas-label>
                  <input tasInput type="text" placeholder="since" [ngModel]="config().sinceField" (ngModelChange)="set('sinceField', $event)" [disabled]="readonly()" />
                </tas-form-field>
              }
            }
          </div>
        </tas-card>
      }

      <!-- Step 4: Extraction -->
      @if (currentStep() === 3) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Extraction</p>
            <p class="text-xs text-slate-400 mt-0.5">Indiquez où trouver les données dans la réponse JSON.</p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <tas-form-field>
              <tas-label>JSONPath de la liste <span class="text-red-500">*</span></tas-label>
              <input tasInput type="text" placeholder="$.data" class="font-mono"
                     [ngModel]="config().dataJsonPath" (ngModelChange)="set('dataJsonPath', $event)" [disabled]="readonly()" />
            </tas-form-field>
            <div class="grid grid-cols-2 gap-3">
              <tas-form-field>
                <tas-label>JSONPath de l'identifiant</tas-label>
                <input tasInput type="text" placeholder="$.id" class="font-mono"
                       [ngModel]="config().idJsonPath" (ngModelChange)="set('idJsonPath', $event)" [disabled]="readonly()" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>JSONPath de la date</tas-label>
                <input tasInput type="text" placeholder="$.createdAt" class="font-mono"
                       [ngModel]="config().dateJsonPath" (ngModelChange)="set('dateJsonPath', $event)" [disabled]="readonly()" />
              </tas-form-field>
            </div>
          </div>
        </tas-card>
      }

      <!-- Step 5: Planification (FE-21) -->
      @if (currentStep() === 4) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Planification</p>
          </div>
          <div class="p-4 flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Fréquence</tas-label>
              <tas-select [options]="schedulePresets" optionLabel="label" optionValue="value"
                          [ngModel]="config().schedulePreset" (ngModelChange)="onScheduleChange($event)" [disabled]="readonly()"></tas-select>
            </tas-form-field>
            @if (config().schedulePreset === 'custom') {
              <tas-form-field>
                <tas-label>Expression cron</tas-label>
                <input tasInput type="text" placeholder="*/15 * * * *" class="font-mono"
                       [ngModel]="config().cronExpression" (ngModelChange)="set('cronExpression', $event)" [disabled]="readonly()" />
                <p class="text-xs text-slate-400 mt-1">Format : minute heure jour_mois mois jour_semaine</p>
              </tas-form-field>
            }
          </div>
        </tas-card>

        <!-- Accusé de réception -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <p class="text-sm font-semibold text-slate-700">Accusé de réception</p>
            <tas-switch [checked]="config().ackEnabled" (toggle)="set('ackEnabled', $event)" [disabled]="readonly()"></tas-switch>
          </div>
          @if (config().ackEnabled) {
            <div class="p-4 flex flex-col gap-4">
              <div class="grid grid-cols-3 gap-3">
                <tas-form-field>
                  <tas-label>Méthode</tas-label>
                  <tas-select [options]="ackMethodOptions" optionLabel="label" optionValue="value"
                              [ngModel]="config().ackMethod" (ngModelChange)="set('ackMethod', $event)" [disabled]="readonly()"></tas-select>
                </tas-form-field>
                <tas-form-field class="col-span-2">
                  <tas-label>Chemin</tas-label>
                  <input tasInput type="text" placeholder="/leads/ack"
                         [ngModel]="config().ackPath" (ngModelChange)="set('ackPath', $event)" [disabled]="readonly()" />
                </tas-form-field>
              </div>
              <p class="text-xs text-slate-400">La variable <code class="bg-slate-100 px-1 rounded">{{ '{{ids}}' }}</code> sera remplacée par les IDs des leads traités.</p>
            </div>
          }
        </tas-card>

        <!-- Coût -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Coût par lead</p>
          </div>
          <div class="p-4 grid grid-cols-2 gap-3">
            <tas-form-field>
              <tas-label>Montant</tas-label>
              <input tasInput type="number" placeholder="0"
                     [ngModel]="config().costPerLead" (ngModelChange)="set('costPerLead', $event)" [disabled]="readonly()" />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Devise</tas-label>
              <input tasInput type="text" placeholder="XOF"
                     [ngModel]="config().costCurrency" (ngModelChange)="set('costCurrency', $event)" [disabled]="readonly()" />
            </tas-form-field>
          </div>
        </tas-card>
      }

      <!-- Navigation -->
      <div class="flex items-center justify-between">
        <div>
          @if (currentStep() > 0) {
            <button tas-outlined-button type="button" (click)="currentStep.update(s => s - 1)">
              <tas-icon iconName="feather:arrow-left" style="font-size:12px"></tas-icon>
              Précédent
            </button>
          }
        </div>
        <div>
          @if (currentStep() < steps.length - 1) {
            <button tas-raised-button color="primary" type="button" [disabled]="!canProceed()" (click)="currentStep.update(s => s + 1)">
              Suivant
              <tas-icon iconName="feather:arrow-right" style="font-size:12px"></tas-icon>
            </button>
          } @else if (!readonly()) {
            <button tas-raised-button color="primary" type="button" (click)="onSave()">
              <tas-icon iconName="feather:save" style="font-size:14px"></tas-icon>
              Enregistrer
            </button>
          }
        </div>
      </div>
    </div>
  `,
})
export class PullWizard implements OnInit {
  public readonly initialConfig = input<PullConfig | null>(null);
  public readonly readonly = input(false);
  public readonly saved = output<PullConfig>();

  public config = signal<PullConfig>(defaultPullConfig());
  public currentStep = signal(0);

  public readonly steps = [
    { id: 'connection', label: 'Connexion' },
    { id: 'request', label: 'Requête' },
    { id: 'pagination', label: 'Pagination' },
    { id: 'extraction', label: 'Extraction' },
    { id: 'schedule', label: 'Planification & Coût' },
  ];

  public readonly authOptions = AUTH_OPTIONS;
  public readonly methodOptions = METHOD_OPTIONS;
  public readonly paginationOptions = PAGINATION_OPTIONS;
  public readonly schedulePresets = SCHEDULE_PRESETS;
  public readonly headerLocationOptions = HEADER_LOCATION_OPTIONS;
  public readonly variableHints = VARIABLE_HINTS;
  public readonly requestParamsPlaceholder = 'status=new&limit={{pageSize}}';
  public readonly ackMethodOptions = [
    { label: 'POST', value: 'POST' },
    { label: 'PUT', value: 'PUT' },
    { label: 'PATCH', value: 'PATCH' },
  ];

  ngOnInit(): void {
    const initial = this.initialConfig();
    if (initial) this.config.set({ ...initial });
  }

  public set(field: keyof PullConfig, value: any): void {
    this.config.update((c) => ({ ...c, [field]: value }));
  }

  public onScheduleChange(preset: string): void {
    this.set('schedulePreset', preset);
    const match = SCHEDULE_PRESETS.find((p) => p.value === preset);
    if (match && preset !== 'custom') {
      this.set('cronExpression', match.cron);
    }
  }

  public canProceed(): boolean {
    const c = this.config();
    switch (this.currentStep()) {
      case 0: return !!c.baseUrl && c.baseUrl.startsWith('https://');
      case 1: return !!c.requestPath;
      case 2: return true;
      case 3: return !!c.dataJsonPath;
      case 4: return !!c.cronExpression || c.schedulePreset !== 'custom';
      default: return true;
    }
  }

  public onSave(): void {
    // Resolve cron from preset if not custom
    const c = this.config();
    if (c.schedulePreset !== 'custom') {
      const match = SCHEDULE_PRESETS.find((p) => p.value === c.schedulePreset);
      if (match) this.set('cronExpression', match.cron);
    }
    this.saved.emit(this.config());
  }
}

export default PullWizard;
