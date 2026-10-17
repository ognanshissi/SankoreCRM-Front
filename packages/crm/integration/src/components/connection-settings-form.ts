import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { FieldTree, FormField, schema, validate } from '@angular/forms/signals';
import { ConnectionSettings } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  ConnectionSettingsDefaults,
  defaultConnectionSettings,
} from '../data-access/integration-facade.service';
import {
  CONNECTION_KIND_FIELDS,
  CONNECTION_KIND_LABELS,
  CONNECTION_SETTING_FIELDS,
  CONNECTION_SYNC_FLOWS,
  ConnectionFamily,
  ConnectionKind,
  ConnectionKindField,
  ConnectionMode,
} from '../data-access/integration-referential';

/**
 * Tous les champs propres à un `$kind`, toutes variantes confondues.
 *
 * Le modèle les porte TOUS, quel que soit le système choisi : la forme du modèle fixe
 * l'arbre du formulaire, et un modèle qui ne porterait que les champs du système courant
 * n'aurait plus de champ à lier au changement de système dans le drawer de création.
 * Les champs étrangers au système choisi ne sont ni affichés, ni validés, ni envoyés.
 */
const ALL_KIND_FIELD_KEYS: ReadonlyArray<string> = [
  ...new Set(
    Object.values(CONNECTION_KIND_FIELDS).flatMap((fields) =>
      fields.map((field) => field.key),
    ),
  ),
];

export type ConnectionSettingsSection = 'kind' | 'limits' | 'sync';

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
 * connection kind and is validated against that kind's own rules ») : le socle commun —
 * quatre bornes techniques et six périodes de synchronisation — plus les coordonnées
 * propres au système. Le formulaire est engendré depuis le référentiel
 * (`CONNECTION_SETTING_FIELDS`, `CONNECTION_SYNC_FLOWS` et `CONNECTION_KIND_FIELDS`), PAS
 * depuis une liste de champs écrite dans cet écran — un champ que le contrat ne déclare pas
 * serait refusé à l'enregistrement, et la saisie serait perdue sans explication. Un nouveau
 * `$kind`, ou un champ de plus sur un `$kind` existant, se déclare donc dans le
 * référentiel : cet écran ne change pas.
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
  /** Coordonnées propres au `$kind`, en chaînes, indexées par le nom du champ. */
  public kindFields!: Record<string, string>;

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
      Calls: numberToField(sync?.Calls, undefined),
    };

    // Le sac est polymorphe : on le lit par nom de champ, en chaîne, comme le reste du
    // formulaire. Un champ absent de cette variante repart vide et ne sera pas envoyé.
    const bag = (source ?? {}) as Record<string, unknown>;
    const kindFields: Record<string, string> = {};
    for (const key of ALL_KIND_FIELD_KEYS) {
      const value = bag[key];
      kindFields[key] = value === null || value === undefined ? '' : String(value);
    }
    model.kindFields = kindFields;

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
  family: ConnectionFamily,
): ConnectionSettings {
  const sync: ConnectionSyncIntervals = {};
  for (const flow of CONNECTION_SYNC_FLOWS) {
    const raw = value.syncIntervalMinutes[flow.key];
    if (raw !== '' && raw !== null && raw !== undefined) {
      sync[flow.key] = Number(raw);
    }
  }

  // SEULS les champs du système choisi partent : ceux d'un autre `$kind` sont restés dans
  // le modèle (sa forme est fixe) et le serveur les refuserait.
  const kindFields: Record<string, string | number | null> = {};
  for (const field of CONNECTION_KIND_FIELDS[kind] ?? []) {
    const raw = (value.kindFields[field.key] ?? '').trim();
    if (raw === '') {
      kindFields[field.key] = null;
    } else {
      kindFields[field.key] = field.kind === 'number' ? Number(raw) : raw;
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
    ...kindFields,
    // `FakeSettings.family` vaut `CoreBanking` par défaut côté serveur, et ce formulaire ne
    // l'éditait pas : un simulateur déclaré en assurance ou en téléphonie se croyait donc
    // cœur bancaire, en silence. La famille de la connexion est la seule réponse juste, et
    // elle n'est pas saisissable — ce n'est pas un champ, c'est une déduction.
    ...(kind === 'Fake' ? { family } : {}),
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
 * formulaire qui le porte (`apply(path.settings, connectionSettingsSchema(() => kind))`).
 * Les bornes viennent du référentiel, pas d'une constante locale : le message doit nommer la
 * borne, sinon l'utilisateur corrige à l'aveugle jusqu'au refus du serveur.
 *
 * Le système est passé en FONCTION et non en valeur : à la création il n'est pas encore
 * choisi, et il change pendant la saisie. Lu dans les validateurs, il les rend réactifs
 * sans qu'on ait à reconstruire le formulaire à chaque changement de système.
 */
export function connectionSettingsSchema(kind: () => ConnectionKind | null) {
  return schema<ConnectionSettingsFormModel>((path) => {
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

    /**
     * Les champs propres au `$kind` sont tous déclarés, et chacun ne se valide que si le
     * système COURANT le réclame : le système est lu dans le validateur, donc changer de
     * système dans le drawer de création revalide tout seul, sans reconstruire le
     * formulaire. Un champ étranger au système choisi n'est jamais en erreur, même rempli
     * — il ne sera pas envoyé.
     */
    for (const key of ALL_KIND_FIELD_KEYS) {
      validate(path.kindFields[key], (ctx) => {
        const current = kind();
        const meta = current
          ? (CONNECTION_KIND_FIELDS[current] ?? []).find((field) => field.key === key)
          : undefined;
        if (!meta) return null;

        const raw = (ctx.value() ?? '').trim();
        if (raw === '') {
          return meta.isRequired
            ? { kind: 'required', message: `${meta.label} est obligatoire` }
            : null;
        }

        if (meta.kind === 'number') {
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) {
            return { kind: 'type', message: 'Entrez un nombre' };
          }
        }

        const message = meta.validate?.(raw) ?? null;
        return message ? { kind: 'pattern', message } : null;
      });
    }
  });
}

@Component({
  selector: 'connection-settings-form',
  imports: [
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    FormField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-5">
      @if (expectedKindLabel()) {
        <div class="flex items-baseline gap-2 text-sm">
          <span class="text-slate-500">Système attendu par ces réglages</span>
          <span class="font-medium text-slate-800">{{ expectedKindLabel() }}</span>
        </div>
      }

      @if (show('kind') && kindFieldRows().length > 0) {
        <div class="flex flex-col gap-4 rounded-lg border border-slate-200 p-4">
          <div>
            <p class="text-sm font-medium text-slate-700">
              Coordonnées {{ kindLabel() }}
            </p>
            <p class="text-xs text-slate-500 mt-0.5">
              Propres à ce système : le serveur les valide contre ses propres règles.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            @for (row of kindFieldRows(); track row.meta.key) {
              <tas-form-field>
                <tas-label>
                  {{ row.meta.label }}
                  @if (row.meta.isRequired) {
                    <span class="text-functional-error">*</span>
                  }
                </tas-label>
                <!--
                  Le type est écrit en dur dans chaque branche, jamais lié : le sélecteur de
                  TasInput est une liste de input[tasInput][type=…], donc un type dynamique
                  ne matche aucune de ses entrées et le champ sortirait sans style ni
                  liaison au form-field.
                -->
                @if (row.meta.kind === 'number') {
                  <input
                    tasInput
                    type="number"
                    [attr.placeholder]="row.meta.placeholder ?? null"
                    [formField]="row.field"
                  />
                } @else if (row.meta.kind === 'select' && row.meta.options) {
                  <tas-select
                    [options]="row.meta.options"
                    optionLabel="label"
                    optionValue="value"
                    [formField]="row.field"
                  ></tas-select>
                } @else {
                  <input
                    tasInput
                    type="text"
                    [attr.placeholder]="row.meta.placeholder ?? null"
                    [formField]="row.field"
                  />
                }
                @if (row.field().touched() && row.field().invalid()) {
                  <tas-error>{{ row.field().errors()[0].message }}</tas-error>
                } @else {
                  <tas-hint>{{ row.meta.hint }}</tas-hint>
                }
              </tas-form-field>
            }
          </div>
        </div>
      }

      @if (show('limits')) {
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
      }

      @if (show('sync') && syncFlows().length > 0) {
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
  /** Le système RÉELLEMENT choisi : c'est lui qui décide des champs propres au `$kind`. */
  public readonly kind = input<ConnectionKind | null>(null);
  /**
   * Les blocs à rendre. Le drawer de création les répartit dans ses propres étapes
   * (coordonnées sous le nom, bornes dans « Protection du système externe ») ; l'écran de
   * la connexion garde les trois à la suite.
   */
  public readonly sections = input<ReadonlyArray<ConnectionSettingsSection>>(['kind', 'limits', 'sync']);

  public show(section: ConnectionSettingsSection): boolean {
    return this.sections().includes(section);
  }

  public readonly expectedKindLabel = computed(() => {
    const kind = this.expectedKind();
    if (!kind) return null;
    return CONNECTION_KIND_LABELS[kind as ConnectionKind] ?? kind;
  });

  public readonly kindLabel = computed(() => {
    const kind = this.kind();
    return kind ? CONNECTION_KIND_LABELS[kind] : '';
  });

  public readonly kindFieldRows = computed<
    ReadonlyArray<{ meta: ConnectionKindField; field: FieldTree<string> }>
  >(() => {
    const kind = this.kind();
    if (!kind) return [];
    return (CONNECTION_KIND_FIELDS[kind] ?? []).map((meta) => ({
      meta,
      field: this.fields().kindFields[meta.key],
    }));
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
