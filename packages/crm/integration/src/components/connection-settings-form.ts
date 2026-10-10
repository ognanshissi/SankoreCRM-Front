import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { FieldTree, FormField, schema, validate } from '@angular/forms/signals';
import { ConnectionSettings } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import {
  ConnectionSettingsDefaults,
  defaultConnectionSettings,
} from '../data-access/integration-facade.service';
import {
  CONNECTION_KIND_LABELS,
  CONNECTION_SETTING_FIELDS,
  CONNECTION_SYNC_FLOWS,
  ConnectionFamily,
  ConnectionKind,
  ConnectionMode,
} from '../data-access/integration-referential';

export type ConnectionSyncFlowKey = (typeof CONNECTION_SYNC_FLOWS)[number]['key'];

/**
 * Périodes de synchronisation, décrites ici plutôt qu'importées du contrat.
 *
 * Le générateur nomme ce dictionnaire d'après le PREMIER schéma qui le porte, par ordre
 * alphabétique : c'était `ConnectionSettingsSyncIntervalMinutes` tant que le socle commun
 * était le seul schéma, c'est devenu `AmplitudeSettingsSyncIntervalMinutes` le jour où le
 * contrat a publié les variantes par `$kind`. Un nouveau `$kind` placé avant Amplitude le
 * renommerait encore. Le référentiel tient déjà la liste des flux : on en dérive la forme.
 */
export type ConnectionSyncIntervals = Partial<Record<ConnectionSyncFlowKey, number>>;

/**
 * Réglages d'une connexion, en saisie.
 *
 * `ConnectionSettings` est polymorphe côté serveur (« it carries a "$kind" naming the
 * connection kind and is validated against that kind's own rules »), mais le swagger
 * n'expose aujourd'hui que le socle commun : quatre bornes techniques et six périodes de
 * synchronisation. Le formulaire est donc engendré depuis `CONNECTION_SETTING_FIELDS` et
 * `CONNECTION_SYNC_FLOWS` du référentiel, PAS depuis une liste de champs inventée par
 * système — un champ propre à Temenos ou à ORASS que le contrat ne déclare pas serait
 * refusé à l'enregistrement, et la saisie serait perdue sans explication. Quand le swagger
 * publiera les variantes par `$kind`, c'est le référentiel qui changera, pas cet écran.
 *
 * Les champs sont des `string` : un `input` rend du texte, et la conversion se fait à la
 * soumission.
 */
export class ConnectionSettingsFormModel {
  public rateLimitPerMinute!: string;
  public timeoutSeconds!: string;
  public circuitBreakerFailureThreshold!: string;
  public circuitBreakerBreakSeconds!: string;
  public syncIntervalMinutes!: Record<ConnectionSyncFlowKey, string>;

  public static instantiate(): ConnectionSettingsFormModel {
    return ConnectionSettingsFormModel.fromDto(defaultConnectionSettings());
  }

  public static fromDto(
    settings: ConnectionSettings | ConnectionSettingsDefaults | null | undefined,
  ): ConnectionSettingsFormModel {
    const defaults = defaultConnectionSettings();
    const source = settings ?? defaults;
    const sync = source.syncIntervalMinutes ?? null;

    const model = new ConnectionSettingsFormModel();
    model.rateLimitPerMinute = numberToField(source.rateLimitPerMinute, defaults.rateLimitPerMinute);
    model.timeoutSeconds = numberToField(source.timeoutSeconds, defaults.timeoutSeconds);
    model.circuitBreakerFailureThreshold = numberToField(
      source.circuitBreakerFailureThreshold,
      defaults.circuitBreakerFailureThreshold,
    );
    model.circuitBreakerBreakSeconds = numberToField(
      source.circuitBreakerBreakSeconds,
      defaults.circuitBreakerBreakSeconds,
    );
    model.syncIntervalMinutes = {
      Customers: numberToField(sync?.Customers, undefined),
      Accounts: numberToField(sync?.Accounts, undefined),
      Transactions: numberToField(sync?.Transactions, undefined),
      Loans: numberToField(sync?.Loans, undefined),
      Policies: numberToField(sync?.Policies, undefined),
      Claims: numberToField(sync?.Claims, undefined),
    };
    return model;
  }
}

function numberToField(value: number | null | undefined, fallback: number | undefined): string {
  if (value !== null && value !== undefined) return String(value);
  return fallback !== undefined ? String(fallback) : '';
}

/**
 * Réglages prêts pour `POST connections` / `PUT connections/{id}`, qui réécrivent l'objet
 * ENTIER.
 *
 * Deux points dont dépend l'enregistrement, et qui manquaient tous les deux :
 *
 * 1. `$kind` est le discriminant que le serveur exige DANS `settings`, jamais à la racine de
 *    la requête. Sans lui son convertisseur rend `null` et l'API refuse en 422 « settings is
 *    required and must carry a "$kind" » — sur un formulaire correctement rempli. Il vient du
 *    `kind` de la connexion, pas de l'objet existant, parce qu'à la création il n'y a pas
 *    d'objet existant.
 * 2. Le sac existant est REPORTÉ. Le formulaire n'édite que le socle commun (quatre bornes et
 *    six périodes), alors que l'appel réécrit tout : repartir d'un objet neuf effaçait à
 *    chaque enregistrement les coordonnées propres au `$kind` — `baseUrl`, `entity`,
 *    `sftpHost`, `companyId` — que l'écran n'affiche même pas.
 *
 * `expectedKind` est déclaré `readonly` par le contrat : il est affiché mais jamais renvoyé,
 * le serveur le tient depuis la nature de la connexion. `schemaVersion` est reprise de
 * l'objet existant pour ne pas faire reculer une connexion déjà migrée.
 */
export function connectionSettingsToDto(
  value: ConnectionSettingsFormModel,
  current: ConnectionSettings | null | undefined,
  kind: ConnectionKind,
): ConnectionSettings {
  const sync: ConnectionSyncIntervals = {};
  for (const flow of CONNECTION_SYNC_FLOWS) {
    const raw = value.syncIntervalMinutes[flow.key];
    if (raw !== '' && raw !== null && raw !== undefined) {
      sync[flow.key] = Number(raw);
    }
  }

  return {
    ...(current ?? {}),
    $kind: kind,
    schemaVersion: current?.schemaVersion ?? defaultConnectionSettings().schemaVersion,
    rateLimitPerMinute: Number(value.rateLimitPerMinute),
    timeoutSeconds: Number(value.timeoutSeconds),
    circuitBreakerFailureThreshold: Number(value.circuitBreakerFailureThreshold),
    circuitBreakerBreakSeconds: Number(value.circuitBreakerBreakSeconds),
    syncIntervalMinutes: Object.keys(sync).length > 0 ? sync : null,
  } as ConnectionSettings;
}

function boundedField(raw: string, min: number, max: number): string | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return 'Cette valeur est obligatoire';
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return 'Entrez un nombre entier';
  if (parsed < min || parsed > max) return `Entrez un entier entre ${min} et ${max}`;
  return null;
}

/**
 * Schéma de validation des réglages, à appliquer sur le sous-chemin `settings` du
 * formulaire qui le porte (`apply(path.settings, connectionSettingsSchema)`). Les bornes
 * viennent du référentiel, pas d'une constante locale : le message doit nommer la borne,
 * sinon l'utilisateur corrige à l'aveugle jusqu'au refus du serveur.
 */
export const connectionSettingsSchema = schema<ConnectionSettingsFormModel>((path) => {
  for (const meta of CONNECTION_SETTING_FIELDS) {
    validate(path[meta.key], (ctx) => {
      const message = boundedField(ctx.value(), meta.min, meta.max);
      return message ? { kind: 'range', message } : null;
    });
  }

  for (const flow of CONNECTION_SYNC_FLOWS) {
    validate(path.syncIntervalMinutes[flow.key], (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (raw === '') return null;
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed > 0
        ? null
        : { kind: 'range', message: 'Entrez un nombre de minutes entier et positif' };
    });
  }
});

@Component({
  selector: 'connection-settings-form',
  imports: [Button, TasIcon, TasFormField, TasLabel, TasError, TasHint, TasInput, FormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-5">
      @if (expectedKindLabel()) {
        <div class="flex items-baseline gap-2 text-sm">
          <span class="text-slate-500">Système attendu par ces réglages</span>
          <span class="font-medium text-slate-800">{{ expectedKindLabel() }}</span>
        </div>
      }

      <div class="grid grid-cols-2 gap-4">
        @for (row of numericFields(); track row.meta.key) {
          <tas-form-field>
            <tas-label>{{ row.meta.label }} <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="number" [formField]="row.field" />
            @if (row.field().touched() && row.field().invalid()) {
              <tas-error>{{ row.field().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>{{ row.meta.hint }}</tas-hint>
            }
          </tas-form-field>
        }
      </div>

      @if (syncFlows().length > 0) {
        <div class="rounded-lg border border-slate-200">
          <button
            tas-text-button
            type="button"
            class="w-full justify-between"
            (click)="toggleSync()"
          >
            <span class="text-sm font-medium text-slate-700">Périodes de synchronisation</span>
            <tas-icon [iconName]="isSyncOpen() ? 'feather:chevron-up' : 'feather:chevron-down'"></tas-icon>
          </button>

          @if (isSyncOpen()) {
            <div class="p-4 pt-0">
              <p class="text-xs text-slate-500 mb-3">{{ syncIntent() }}</p>
              <div class="grid grid-cols-3 gap-4">
                @for (row of syncFlows(); track row.meta.key) {
                  <tas-form-field>
                    <tas-label>{{ row.meta.label }}</tas-label>
                    <input tasInput type="number" placeholder="—" [formField]="row.field" />
                    @if (row.field().touched() && row.field().invalid()) {
                      <tas-error>{{ row.field().errors()[0].message }}</tas-error>
                    }
                  </tas-form-field>
                }
              </div>
              <p class="text-xs text-slate-400 mt-3">
                Un flux laissé vide n'est pas synchronisé automatiquement.
              </p>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ConnectionSettingsFormComponent {
  public readonly fields = input.required<FieldTree<ConnectionSettingsFormModel>>();
  public readonly family = input.required<ConnectionFamily>();
  public readonly mode = input.required<ConnectionMode>();
  public readonly expectedKind = input<ConnectionKind | string | null>(null);

  public readonly expectedKindLabel = computed(() => {
    const kind = this.expectedKind();
    if (!kind) return null;
    return CONNECTION_KIND_LABELS[kind as ConnectionKind] ?? kind;
  });

  public readonly numericFields = computed(() =>
    CONNECTION_SETTING_FIELDS.map((meta) => ({ meta, field: this.fields()[meta.key] })),
  );

  public readonly syncFlows = computed(() => {
    const family = this.family();
    return CONNECTION_SYNC_FLOWS.filter((flow) => flow.families.includes(family)).map((meta) => ({
      meta,
      field: this.fields().syncIntervalMinutes[meta.key],
    }));
  });

  /**
   * La section s'ouvre d'office en mode Fichiers, où les périodes sont le réglage central,
   * et reste repliée en mode API où elles sont accessoires. Un `linkedSignal` plutôt qu'un
   * `computed` : l'utilisateur garde la main après avoir changé de mode.
   */
  public readonly isSyncOpen = linkedSignal<ConnectionMode, boolean>({
    source: this.mode,
    computation: (mode) => mode === 'Batch',
  });

  public readonly syncIntent = computed(() =>
    this.mode() === 'Batch'
      ? 'En mode Fichiers, ces périodes déterminent la cadence des envois.'
      : 'En mode API, les écritures partent à la demande : ces périodes ne servent qu’aux rattrapages.',
  );

  public toggleSync(): void {
    this.isSyncOpen.update((open) => !open);
  }
}
