import { Component, computed, input, output, signal, OnInit } from '@angular/core';
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

import { JSONPATH_HINT, isValidJsonPath } from '../lead-source-validators';
import {
  AckHttpMethod,
  PaginationStrategy,
  PullAuthType,
  PullConfig,
  PullHttpMethod,
  defaultPullConfig,
} from '../lead-source-settings.types';

// FE-01 : la forme de `settings.pull` vit dans le module de settings.
export type { PullConfig, PullAuthType, PaginationStrategy, AckHttpMethod, PullHttpMethod };
export { defaultPullConfig };

const AUTH_OPTIONS: { label: string; value: PullAuthType }[] = [
  { label: 'Aucune', value: 'None' },
  { label: 'Clé API', value: 'ApiKey' },
  { label: 'Bearer Token', value: 'Bearer' },
  { label: 'OAuth Client Credentials', value: 'OAuthClientCredentials' },
  { label: 'Basic Auth', value: 'Basic' },
];

const METHOD_OPTIONS: { label: string; value: PullHttpMethod }[] = [
  { label: 'GET', value: 'GET' },
  { label: 'POST', value: 'POST' },
];

const PAGINATION_OPTIONS: { label: string; value: PaginationStrategy }[] = [
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
  { label: 'Quotidienne', value: 'daily', cron: '0 6 * * *' },
  { label: 'Personnalisée (cron)', value: 'custom', cron: '' },
];

const HEADER_LOCATION_OPTIONS = [
  { label: 'En-tête HTTP', value: 'header' },
  { label: 'Paramètre de requête', value: 'query' },
];

/** FE-19 AC3 — variables insérables dans le chemin et les paramètres. */
const TEMPLATE_VARIABLES = ['{{since}}', '{{cursor}}', '{{page}}', '{{pageSize}}'];
const VARIABLE_HINTS = TEMPLATE_VARIABLES.join(', ');

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
  /** Etape d'ouverture — utilisee par le test a blanc pour renvoyer sur l'etape fautive. */
  public readonly initialStep = input(0);
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
  public readonly templateVariables = TEMPLATE_VARIABLES;
  public readonly jsonPathHint = JSONPATH_HINT;
  public readonly requestParamsPlaceholder = 'status=new&limit={{pageSize}}';
  public readonly ackMethodOptions: { label: string; value: AckHttpMethod }[] = [
    { label: 'POST', value: 'POST' },
    { label: 'PUT', value: 'PUT' },
    { label: 'PATCH', value: 'PATCH' },
  ];

  ngOnInit(): void {
    const initial = this.initialConfig();
    if (initial) this.config.set({ ...initial });
    const step = this.initialStep();
    if (step > 0 && step < this.steps.length) this.currentStep.set(step);
  }

  public set(field: keyof PullConfig, value: any): void {
    this.config.update((c) => ({ ...c, [field]: value }));
  }

  // ——— FE-19 AC3 : variables de gabarit ———

  /** Ajoute la variable a la fin du champ (insertion au curseur non gérée par tasInput). */
  public insertVariable(field: 'requestPath' | 'requestParams', variable: string): void {
    const current = this.config()[field] ?? '';
    this.set(field, current + variable);
  }

  /** Variables reconnues presentes dans la valeur — sert a les mettre en evidence. */
  public usedVariables(value: string | null | undefined): string[] {
    if (!value) return [];
    return TEMPLATE_VARIABLES.filter((v) => value.includes(v));
  }

  /** `{{...}}` ecrits dans la valeur mais hors de la liste connue. */
  public unknownVariables(value: string | null | undefined): string[] {
    if (!value) return [];
    const found = value.match(/\{\{\s*[^}]*\s*\}\}/g) ?? [];
    return found.filter((f) => !TEMPLATE_VARIABLES.includes(f.replace(/\s+/g, '')));
  }

  // ——— FE-19 AC5 : JSONPath ———

  /** Vrai si la valeur est renseignee ET mal formee (un champ vide n'est pas « invalide »). */
  public jsonPathInvalid(value: string | null | undefined): boolean {
    return !!value && !isValidJsonPath(value);
  }

  /** Tous les JSONPath du formulaire qui bloquent l'enregistrement. */
  public readonly invalidJsonPaths = computed(() => {
    const c = this.config();
    const candidates: [string, string][] = [
      ['Liste', c.dataJsonPath],
      ['Identifiant', c.idJsonPath],
      ['Date', c.dateJsonPath],
    ];
    if (c.paginationStrategy === 'Cursor') {
      candidates.push(['Curseur', c.cursorJsonPath]);
    }
    return candidates.filter(([, v]) => this.jsonPathInvalid(v)).map(([label]) => label);
  });

  public onScheduleChange(preset: string): void {
    this.set('schedulePreset', preset);
    if (preset === 'custom') return;
    this.set('cronExpression', this._cronFor(preset, this.config().dailyHour));
  }

  /** FE-21 — « quotidienne à une heure donnée », au lieu de 06 h figé. */
  public onDailyHourChange(value: number | string): void {
    const hour = Math.min(23, Math.max(0, Number(value) || 0));
    this.set('dailyHour', hour);
    if (this.config().schedulePreset === 'daily') {
      this.set('cronExpression', this._cronFor('daily', hour));
    }
  }

  private _cronFor(preset: string, dailyHour: number): string {
    if (preset === 'daily') return `0 ${dailyHour} * * *`;
    return SCHEDULE_PRESETS.find((p) => p.value === preset)?.cron ?? '';
  }

  /** FE-21 AC3 — le montant doit etre positif. */
  public readonly costInvalid = computed(() => {
    const c = this.config().costPerLead;
    return c !== null && c !== undefined && c < 0;
  });

  /** FE-21 — insere `{{ids}}` dans le chemin de l'accuse de reception. */
  public insertAckVariable(): void {
    this.set('ackPath', (this.config().ackPath ?? '') + '{{ids}}');
  }

  public canProceed(): boolean {
    const c = this.config();
    switch (this.currentStep()) {
      case 0: return !!c.baseUrl && c.baseUrl.startsWith('https://');
      case 1: return !!c.requestPath;
      case 2:
        return c.paginationStrategy !== 'Cursor' || !this.jsonPathInvalid(c.cursorJsonPath);
      case 3:
        return isValidJsonPath(c.dataJsonPath) && this.invalidJsonPaths().length === 0;
      case 4:
        return (!!c.cronExpression || c.schedulePreset !== 'custom') && !this.costInvalid();
      default: return true;
    }
  }

  public onSave(): void {
    const c = this.config();
    if (c.schedulePreset !== 'custom') {
      this.set('cronExpression', this._cronFor(c.schedulePreset, c.dailyHour));
    }
    this.saved.emit(this.config());
  }
}

export default PullWizard;
