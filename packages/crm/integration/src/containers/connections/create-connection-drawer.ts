import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { apply, form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import {
  CreateConnectionRequestFamilyEnum,
  CreateConnectionRequestKindEnum,
  CreateConnectionRequestModeEnum,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { TenantModulesService } from '@sankore/crm/common';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import {
  ConnectionSettingsFormComponent,
  ConnectionSettingsFormModel,
  connectionSettingsSchema,
  connectionSettingsToDto,
} from '../../components/connection-settings-form';
import {
  defaultConnectionSettings,
  integrationErrorMessage,
  IntegrationFacadeService,
} from '../../data-access/integration-facade.service';
import {
  availableFamilies,
  CONNECTION_FAMILY_LABELS,
  CONNECTION_KIND_LABELS,
  CONNECTION_KINDS_BY_FAMILY,
  CONNECTION_MODES,
  CONNECTION_SETTING_FIELDS,
  ConnectionFamily,
  ConnectionKind,
  ConnectionMode,
} from '../../data-access/integration-referential';

export interface CreateConnectionDrawerData {
  /** Famille imposée par l'écran appelant, ou `null` pour laisser le choix. */
  family: ConnectionFamily | null;
}

/**
 * Ce que le drawer rend à sa fermeture. La connexion existe dès l'écran de succès : même
 * fermé par « Retour à la liste », l'appelant doit recharger sa liste, d'où l'id rendu
 * dans les deux cas et `openDetail` pour dire s'il faut ouvrir son écran.
 */
export interface CreateConnectionDrawerResult {
  connectionId: string;
  openDetail: boolean;
}

/**
 * Les énumérations du contrat sont nominales côté TypeScript alors que le référentiel
 * travaille en unions de chaînes. Ces tables explicites valent mieux qu'un cast : si le
 * swagger gagne une famille, un système ou un mode, c'est ici que la compilation casse,
 * au lieu de passer silencieusement une valeur que le serveur refusera.
 */
const FAMILY_ENUM: Record<ConnectionFamily, CreateConnectionRequestFamilyEnum> = {
  CoreBanking: CreateConnectionRequestFamilyEnum.CoreBanking,
  Insurance: CreateConnectionRequestFamilyEnum.Insurance,
  Telephony: CreateConnectionRequestFamilyEnum.Telephony,
  Messaging: CreateConnectionRequestFamilyEnum.Messaging,
};

const KIND_ENUM: Record<ConnectionKind, CreateConnectionRequestKindEnum> = {
  Temenos: CreateConnectionRequestKindEnum.Temenos,
  Amplitude: CreateConnectionRequestKindEnum.Amplitude,
  Sab: CreateConnectionRequestKindEnum.Sab,
  PerfectVision: CreateConnectionRequestKindEnum.PerfectVision,
  Orass: CreateConnectionRequestKindEnum.Orass,
  Ringover: CreateConnectionRequestKindEnum.Ringover,
  Fake: CreateConnectionRequestKindEnum.Fake,
  Dialog360: CreateConnectionRequestKindEnum.Dialog360,
};

const MODE_ENUM: Record<ConnectionMode, CreateConnectionRequestModeEnum> = {
  Api: CreateConnectionRequestModeEnum.Api,
  Batch: CreateConnectionRequestModeEnum.Batch,
  Relay: CreateConnectionRequestModeEnum.Relay,
};

const FAMILY_STYLE: Record<ConnectionFamily, { icon: string; tile: string }> = {
  CoreBanking: { icon: 'feather:database', tile: 'bg-primary/10 text-primary' },
  Insurance: { icon: 'feather:shield', tile: 'bg-blue-50 text-blue-800' },
  Telephony: { icon: 'feather:phone', tile: 'bg-amber-50 text-amber-800' },
  Messaging: { icon: 'feather:message-circle', tile: 'bg-emerald-50 text-emerald-800' },
};

/** Nom proposé tant que l'utilisateur n'a pas écrit le sien. */
function suggestedName(family: ConnectionFamily, kind: ConnectionKind | null): string {
  if (!kind) return '';
  if (kind === 'Fake') return `Recette ${CONNECTION_FAMILY_LABELS[family].toLowerCase()}`;
  return `${CONNECTION_KIND_LABELS[kind]} · production`;
}

class CreateConnectionFormModel {
  public family!: string;
  public kind!: string;
  public mode!: string;
  public name!: string;
  public settings!: ConnectionSettingsFormModel;

  public static instantiate(family: ConnectionFamily | null): CreateConnectionFormModel {
    const model = new CreateConnectionFormModel();
    model.family = family ?? '';
    model.kind = '';
    model.mode = 'Api';
    model.name = '';
    model.settings = ConnectionSettingsFormModel.instantiate();
    return model;
  }
}

/**
 * Déclaration d'une connexion, en trois choix : la famille, le système, le nom.
 *
 * Le drawer ne porte que ce qui ne se change plus après : la famille et le système sont
 * l'identité de la connexion (« a different system is a different connection »). Aucun
 * secret n'y est saisi — `CreateConnectionRequest` n'en transporte pas — et aucun agent
 * relais n'y est choisi : le serveur pose ce lien à l'enrôlement. La connexion naît donc
 * INACTIVE ; l'écran de succès dit ce qui reste à faire, puis l'appelant ouvre l'écran de
 * la connexion avec l'id rendu.
 */
@Component({
  selector: 'create-connection-drawer',
  templateUrl: './create-connection-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    FormRoot,
    FormField,
    ConnectionSettingsFormComponent,
  ],
})
export class CreateConnectionDrawer {
  private readonly _dialogRef = inject<DialogRef<CreateConnectionDrawerResult>>(DialogRef);
  public readonly data = inject<CreateConnectionDrawerData>(DIALOG_DATA);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _tenantModules = inject(TenantModulesService);

  public readonly modes = CONNECTION_MODES;

  public model = signal(CreateConnectionFormModel.instantiate(this.data.family));

  public formSchema = form(this.model, (schema) => {
    required(schema.family, { message: 'Choisissez ce que vous voulez relier' });
    required(schema.mode, { message: 'Choisissez un mode' });
    required(schema.name, { message: 'Donnez un nom à la connexion' });

    validate(schema.kind, (ctx) => {
      const kind = ctx.value();
      if (!kind) return { kind: 'required', message: 'Choisissez un système' };

      const family = ctx.valueOf(schema.family) as ConnectionFamily;
      const allowed = CONNECTION_KINDS_BY_FAMILY[family] ?? [];
      return allowed.some((option) => option.value === kind)
        ? null
        : { kind: 'mismatch', message: 'Ce système n’appartient pas à la famille choisie' };
    });

    // Le système n'est pas encore choisi à l'ouverture et change pendant la saisie : il
    // est donc passé en fonction, lue dans les validateurs des champs propres au `$kind`.
    apply(schema.settings, connectionSettingsSchema(() => this.selectedKind()));
  });

  /** Id rendu par le serveur : sa présence fait passer le drawer sur l'écran de succès. */
  public readonly createdId = signal<string | null>(null);
  public readonly createdName = signal('');
  public readonly isProtectionOpen = signal(false);

  /** `null` tant qu'aucune famille n'est choisie : les étapes suivantes restent masquées. */
  public readonly selectedFamily = computed<ConnectionFamily | null>(() => {
    const family = this.formSchema.family().value();
    return family === 'CoreBanking' || family === 'Insurance' || family === 'Telephony'
      ? family
      : null;
  });

  /**
   * Les trois familles du contrat, jamais un ternaire « assurance ou cœur bancaire » :
   * déclarer une connexion de TÉLÉPHONIE passait sinon les réglages du cœur bancaire au
   * formulaire, avec ses périodes de synchronisation et son libellé.
   */
  public readonly settingsFamily = computed<ConnectionFamily>(
    () => this.selectedFamily() ?? 'CoreBanking',
  );

  /** Le système choisi, ou `null` tant qu'il ne l'est pas. */
  public readonly selectedKind = computed<ConnectionKind | null>(() => {
    const kind = this.formSchema.kind().value();
    return kind ? (kind as ConnectionKind) : null;
  });

  public readonly selectedKindLabel = computed(() => {
    const kind = this.selectedKind();
    return kind ? CONNECTION_KIND_LABELS[kind] : '';
  });

  public readonly selectedMode = computed<ConnectionMode>(() => {
    const mode = this.formSchema.mode().value();
    if (mode === 'Batch') return 'Batch';
    if (mode === 'Relay') return 'Relay';
    return 'Api';
  });

  /** Une famille imposée par l'écran appelant n'offre plus qu'une carte, déjà cochée. */
  public readonly families = computed(() => {
    const selected = this.selectedFamily();
    return availableFamilies(this._tenantModules.active())
      .filter((f) => !this.data.family || f.value === this.data.family)
      .map((f) => ({ ...f, ...FAMILY_STYLE[f.value], isSelected: f.value === selected }));
  });

  public readonly systems = computed(() => {
    const family = this.selectedFamily();
    const selected = this.formSchema.kind().value();
    return (family ? CONNECTION_KINDS_BY_FAMILY[family] : []).map((kind) => ({
      ...kind,
      isSelected: kind.value === selected,
      isTest: kind.value === 'Fake',
    }));
  });

  public readonly isNameDone = computed(
    () => !!this.selectedKind() && this.formSchema.name().value().trim() !== '',
  );

  public readonly isNameSuggested = computed(
    () =>
      this.formSchema.name().value() ===
      suggestedName(this.settingsFamily(), this.selectedKind()),
  );

  /** Les bornes saisies, dans l'ordre du référentiel, pour le résumé replié. */
  private readonly _limits = computed(() => {
    const settings = this.formSchema.settings().value();
    return CONNECTION_SETTING_FIELDS.map((field) => settings[field.key]);
  });

  public readonly isProtectionDefault = computed(() => {
    const defaults = defaultConnectionSettings();
    return CONNECTION_SETTING_FIELDS.every(
      (field, i) => Number(this._limits()[i]) === defaults[field.key],
    );
  });

  public readonly isProtectionInvalid = computed(() =>
    CONNECTION_SETTING_FIELDS.some((field) => this.formSchema.settings[field.key]().invalid()),
  );

  public readonly protectionSummary = computed(() => {
    const [rate, timeout, failures, pause] = this._limits();
    return `Jusqu’à ${rate} appels par minute, délai de ${timeout} s, pause de ${pause} s après ${failures} échecs.`;
  });

  public readonly footHint = computed(() => {
    if (!this.selectedFamily()) return 'Choisissez ce que vous voulez relier.';
    if (!this.selectedKind()) return 'Choisissez le système pour continuer.';
    if (!this.isNameDone()) return 'Donnez un nom à la connexion.';
    if (this.formSchema().invalid()) return 'Corrigez les champs signalés pour continuer.';
    return 'La connexion sera créée inactive, sans identifiants.';
  });

  public readonly nextSteps = computed(() => [
    {
      title: 'Renseigner les identifiants',
      description: `Adresse du service, clé ou compte fourni par ${this.selectedKindLabel() || 'l’éditeur'}.`,
    },
    {
      title: 'Lancer le premier test',
      description: 'SANKORE vérifie que le système répond et que les droits sont corrects.',
    },
    {
      title: 'Activer la connexion',
      description: 'Possible seulement après un test réussi.',
    },
  ]);

  constructor() {
    /**
     * Changer de famille rend le système choisi impossible : on le vide plutôt que de
     * laisser un couple refusé par le serveur partir à l'enregistrement.
     */
    effect(() => {
      const family = this.formSchema.family().value() as ConnectionFamily;
      const kind = this.formSchema.kind().value();
      if (!kind) return;
      const allowed = CONNECTION_KINDS_BY_FAMILY[family] ?? [];
      if (!allowed.some((option) => option.value === kind)) {
        this.formSchema.kind().value.set('');
      }
    });
  }

  public pickFamily(family: ConnectionFamily): void {
    if (this.data.family) return;
    this.formSchema.family().value.set(family);
  }

  /**
   * Le nom suit le système tant que l'utilisateur ne l'a pas réécrit : on ne remplace que
   * le vide ou la proposition précédente, jamais un nom saisi à la main.
   */
  public pickSystem(kind: ConnectionKind): void {
    const family = this.settingsFamily();
    const previous = suggestedName(family, this.selectedKind());
    const name = this.formSchema.name().value();
    this.formSchema.kind().value.set(kind);
    if (name.trim() === '' || name === previous) {
      this.formSchema.name().value.set(suggestedName(family, kind));
    }
  }

  public pickMode(mode: ConnectionMode): void {
    this.formSchema.mode().value.set(mode);
  }

  public toggleProtection(): void {
    this.isProtectionOpen.update((open) => !open);
  }

  public resetProtection(): void {
    const defaults = defaultConnectionSettings();
    for (const field of CONNECTION_SETTING_FIELDS) {
      this.formSchema.settings[field.key]().value.set(String(defaults[field.key]));
    }
  }

  public handleSubmit(): void {
    // Une borne invalide dans la section repliée bloquerait l'envoi sans que rien ne se
    // voie : on la déplie pour que l'erreur soit sous les yeux.
    if (this.isProtectionInvalid()) this.isProtectionOpen.set(true);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const family = value.family as ConnectionFamily;
      const mode = value.mode as ConnectionMode;

      const connectionId = await firstValueFrom(
        this._facade
          .createConnection({
            family: FAMILY_ENUM[family],
            kind: KIND_ENUM[value.kind as ConnectionKind],
            mode: MODE_ENUM[mode],
            name: value.name.trim(),
            // `$kind` descend DANS `settings` — il y était posé à la racine de la requête,
            // d'où le `as any` qui le laissait passer et le 422 « settings is required and
            // must carry a "$kind" » que le serveur renvoyait ensuite systématiquement.
            settings: connectionSettingsToDto(
              value.settings,
              null,
              value.kind as ConnectionKind,
              family,
            ),
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                integrationErrorMessage(err, 'Impossible de déclarer la connexion.'),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: undefined },
      );

      if (!connectionId) return;

      this.createdName.set(value.name.trim());
      this.createdId.set(connectionId);
    });
  }

  public openDetail(): void {
    const connectionId = this.createdId();
    if (connectionId) this._dialogRef.close({ connectionId, openDetail: true });
  }

  /** Après la création, fermer rend quand même l'id : la liste doit se recharger. */
  public close(): void {
    const connectionId = this.createdId();
    this._dialogRef.close(connectionId ? { connectionId, openDetail: false } : undefined);
  }
}
