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
  templateUrl: 'pull-wizard.html',
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
