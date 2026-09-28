import { Component, computed, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSwitch } from '@talisoft/ui/switch';
import { LeadSourceDetailDto } from '@sankore/crm-api';

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
    TasFormField, TasLabel, TasHint, TasError, TasInput, TasSelect, TasSwitch,
  ],
  templateUrl: 'pull-wizard.html',
})
export class PullWizard implements OnInit {
  public readonly initialConfig = input<PullConfig | null>(null);
  /**
   * FE-21 — le coût saisi à la création vit à la RACINE de la source
   * (`costPerLead: Money`), pas dans `settings.pull` : sans cette entrée,
   * l'étape « Coût » s'ouvrait vide et le premier enregistrement renvoyait
   * `null` à la racine, effaçant le montant et la devise saisis.
   */
  public readonly source = input<LeadSourceDetailDto | null>(null);
  /** Etape d'ouverture — utilisee par le test a blanc pour renvoyer sur l'etape fautive. */
  public readonly initialStep = input(0);
  public readonly readonly = input(false);
  public readonly saved = output<PullConfig>();

  public config = signal<PullConfig>(defaultPullConfig());
  public currentStep = signal(0);
  /**
   * Etape la plus avancée déjà franchie. L'en-tête ne permet de sauter que
   * jusqu'ici : un clic direct sur « Planification & Coût » contournait sinon
   * toute la validation et envoyait une configuration vide au serveur.
   */
  public maxVisitedStep = signal(0);

  /** Planification telle qu'elle a été ouverte — sert à ne pas réécrire le cron sans raison. */
  private _openedPreset = '';
  private _openedDailyHour = 0;

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
    const config: PullConfig = initial
      ? { ...defaultPullConfig(), ...initial }
      : defaultPullConfig();

    /**
     * FE-21 — une source créée par l'API (ou dont le sac a été normalisé côté
     * serveur) porte un `cronExpression` sans `schedulePreset`. Sans cette
     * dérivation, l'assistant se rouvrait sur « Toutes les 15 minutes » et le
     * moindre « Enregistrer » remplaçait un cron `0 8 * * *` par celui du
     * préréglage affiché. Le cron est la source de vérité : c'est lui que le
     * serveur exécute.
     */
    const derived = this._scheduleFromCron(config.cronExpression, config.dailyHour);
    if (derived) {
      config.schedulePreset = derived.preset;
      config.dailyHour = derived.dailyHour;
    }

    // Le coût de la racine fait foi tant que `settings.pull` n'en porte pas.
    const rootCost = this.source()?.costPerLead;
    const pullHasCost = initial?.costPerLead !== null && initial?.costPerLead !== undefined;
    if (!pullHasCost && rootCost) {
      if (typeof rootCost.amount === 'number') config.costPerLead = rootCost.amount;
      if (rootCost.currency) config.costCurrency = rootCost.currency;
    }

    this.config.set(config);
    this._openedPreset = config.schedulePreset;
    this._openedDailyHour = config.dailyHour;

    const step = this.initialStep();
    const opening = step > 0 && step < this.steps.length ? step : 0;
    this.currentStep.set(opening);

    // Une configuration déjà enregistrée reste navigable jusqu'à la première
    // étape qui ne valide pas : sinon la rouvrir obligerait à reparcourir tout
    // l'assistant pour atteindre « Planification & Coût ».
    let reachable = 0;
    while (reachable < this.steps.length - 1 && this.canProceedFrom(reachable)) reachable++;
    this.maxVisitedStep.set(Math.max(reachable, opening));
  }

  public set(field: keyof PullConfig, value: any): void {
    this.config.update((c) => ({ ...c, [field]: value }));
  }

  // ——— Navigation ———

  /** L'en-tête ne saute que vers une étape déjà franchie. */
  public goToStep(index: number): void {
    if (index >= 0 && index <= this.maxVisitedStep()) this.currentStep.set(index);
  }

  public nextStep(): void {
    if (!this.canProceed()) return;
    const next = Math.min(this.currentStep() + 1, this.steps.length - 1);
    this.currentStep.set(next);
    this.maxVisitedStep.update((m) => Math.max(m, next));
  }

  public previousStep(): void {
    this.currentStep.update((s) => Math.max(0, s - 1));
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

  /**
   * Conversion cron → préréglage, réciproque de `_cronFor`. Renvoie `null`
   * quand aucun cron n'est stocké (le préréglage enregistré fait alors foi).
   */
  private _scheduleFromCron(
    cron: string | null | undefined,
    fallbackHour: number,
  ): { preset: string; dailyHour: number } | null {
    const normalized = (cron ?? '').trim().replace(/\s+/g, ' ');
    if (!normalized) return null;

    const daily = normalized.match(/^0 (\d{1,2}) \* \* \*$/);
    if (daily) {
      const hour = Number(daily[1]);
      if (hour >= 0 && hour <= 23) return { preset: 'daily', dailyHour: hour };
    }

    const preset = SCHEDULE_PRESETS.find((p) => !!p.cron && p.cron === normalized);
    if (preset) return { preset: preset.value, dailyHour: fallbackHour };

    return { preset: 'custom', dailyHour: fallbackHour };
  }

  /** FE-21 AC3 — le montant doit etre positif. */
  public readonly costInvalid = computed(() => {
    const c = this.config().costPerLead;
    if (c === null || c === undefined || (c as unknown) === '') return false;
    const amount = Number(c);
    return !Number.isFinite(amount) || amount < 0;
  });

  /** FE-21 — insere `{{ids}}` dans le chemin de l'accuse de reception. */
  public insertAckVariable(): void {
    this.set('ackPath', (this.config().ackPath ?? '') + '{{ids}}');
  }

  /**
   * Le type declare `ackPath: string`, mais le sac stocke peut porter `null` :
   * `config().ackPath.includes(...)` levait dans le template.
   */
  public ackPathHasIds(): boolean {
    const path = this.config().ackPath as string | null | undefined;
    return !!path && path.includes('{{ids}}');
  }

  /** Validation d'une étape donnée — appelée aussi bien pour « Suivant » que pour l'enregistrement. */
  public canProceedFrom(step: number): boolean {
    const c = this.config();
    switch (step) {
      case 0: {
        // Basic Auth sans nom d'utilisateur : le serveur n'a pas de quoi composer
        // l'en-tête et l'appel échoue systématiquement en 401. Le mot de passe, lui,
        // est un secret et ne transite pas par les settings.
        const urlOk = !!c.baseUrl && c.baseUrl.startsWith('https://');
        return urlOk && (c.authType !== 'Basic' || !!c.basicUsername.trim());
      }
      case 1: return !!c.requestPath && this.unknownVariables(c.requestParams).length === 0
        && this.unknownVariables(c.requestPath).length === 0;
      case 2:
        return c.paginationStrategy !== 'Cursor' || !this.jsonPathInvalid(c.cursorJsonPath);
      case 3:
        return isValidJsonPath(c.dataJsonPath) && this.invalidJsonPaths().length === 0;
      case 4:
        return (!!c.cronExpression || c.schedulePreset !== 'custom') && !this.costInvalid();
      default: return true;
    }
  }

  public canProceed(): boolean {
    return this.canProceedFrom(this.currentStep());
  }

  /** Aucune étape ne doit être invalide au moment d'enregistrer (FE-19). */
  public readonly allStepsValid = computed(() =>
    this.steps.every((_, i) => this.canProceedFrom(i)),
  );

  /** Première étape en défaut, pour y renvoyer l'utilisateur. */
  public firstInvalidStep(): number {
    return this.steps.findIndex((_, i) => !this.canProceedFrom(i));
  }

  public onSave(): void {
    // `onSave` revalide tout : l'en-tête d'étapes permettait d'atteindre la
    // dernière étape sans passer par « Suivant », et une URL vide partait au
    // serveur avec un « Enregistré » affiché malgré tout.
    const invalid = this.firstInvalidStep();
    if (invalid >= 0) {
      this.currentStep.set(invalid);
      this.maxVisitedStep.update((m) => Math.max(m, invalid));
      return;
    }

    const c = this.config();
    // Le cron n'est réécrit que si la planification a changé depuis l'ouverture :
    // sinon un simple « Enregistrer » écrasait un cron posé côté serveur par
    // celui du préréglage affiché par défaut.
    if (
      c.schedulePreset !== 'custom' &&
      (c.schedulePreset !== this._openedPreset || c.dailyHour !== this._openedDailyHour)
    ) {
      this.set('cronExpression', this._cronFor(c.schedulePreset, c.dailyHour));
    }
    this._openedPreset = this.config().schedulePreset;
    this._openedDailyHour = this.config().dailyHour;
    this.saved.emit(this.config());
  }
}

export default PullWizard;
