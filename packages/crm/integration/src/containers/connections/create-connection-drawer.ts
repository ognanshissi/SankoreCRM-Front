import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { apply, form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import {
  CreateConnectionRequestFamilyEnum,
  CreateConnectionRequestKindEnum,
  CreateConnectionRequestModeEnum,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import {
  ConnectionSettingsFormComponent,
  ConnectionSettingsFormModel,
  connectionSettingsSchema,
  connectionSettingsToDto,
} from '../../components/connection-settings-form';
import {
  integrationErrorMessage,
  IntegrationFacadeService,
} from '../../data-access/integration-facade.service';
import {
  CONNECTION_FAMILIES,
  CONNECTION_KINDS_BY_FAMILY,
  CONNECTION_MODES,
  ConnectionFamily,
  ConnectionKind,
  ConnectionMode,
} from '../../data-access/integration-referential';

export interface CreateConnectionDrawerData {
  /** Famille imposée par l'écran appelant, ou `null` pour laisser le choix. */
  family: ConnectionFamily | null;
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
};

const KIND_ENUM: Record<ConnectionKind, CreateConnectionRequestKindEnum> = {
  Temenos: CreateConnectionRequestKindEnum.Temenos,
  Amplitude: CreateConnectionRequestKindEnum.Amplitude,
  Sab: CreateConnectionRequestKindEnum.Sab,
  PerfectVision: CreateConnectionRequestKindEnum.PerfectVision,
  Orass: CreateConnectionRequestKindEnum.Orass,
  Fake: CreateConnectionRequestKindEnum.Fake,
};

const MODE_ENUM: Record<ConnectionMode, CreateConnectionRequestModeEnum> = {
  Api: CreateConnectionRequestModeEnum.Api,
  Batch: CreateConnectionRequestModeEnum.Batch,
  Relay: CreateConnectionRequestModeEnum.Relay,
};

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
 * Déclaration d'une connexion.
 *
 * Le drawer ne porte que ce qui ne se change plus après : la famille et le système sont
 * l'identité de la connexion (« a different system is a different connection »). Aucun
 * secret n'y est saisi — `CreateConnectionRequest` n'en transporte pas — et aucun agent
 * relais n'y est choisi : le serveur pose ce lien à l'enrôlement. La connexion naît donc
 * INACTIVE et le reste du parcours se fait sur l'écran d'édition, vers lequel l'appelant
 * redirige avec l'id rendu.
 */
@Component({
  selector: 'create-connection-drawer',
  templateUrl: './create-connection-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
    ConnectionSettingsFormComponent,
  ],
})
export class CreateConnectionDrawer {
  private readonly _dialogRef = inject<DialogRef<string>>(DialogRef);
  public readonly data = inject<CreateConnectionDrawerData>(DIALOG_DATA);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly familyOptions = CONNECTION_FAMILIES.map((family) => ({
    label: family.label,
    value: family.value,
  }));

  public readonly modeOptions = CONNECTION_MODES.map((mode) => ({
    label: mode.label,
    value: mode.value,
  }));

  public model = signal(CreateConnectionFormModel.instantiate(this.data.family));

  public formSchema = form(this.model, (schema) => {
    required(schema.family, { message: 'Choisissez une famille' });
    required(schema.mode, { message: 'Choisissez un mode' });
    required(schema.name, { message: 'Le nom de la connexion est obligatoire' });

    validate(schema.kind, (ctx) => {
      const kind = ctx.value();
      if (!kind) return { kind: 'required', message: 'Choisissez un système' };

      const family = ctx.valueOf(schema.family) as ConnectionFamily;
      const allowed = CONNECTION_KINDS_BY_FAMILY[family] ?? [];
      return allowed.some((option) => option.value === kind)
        ? null
        : { kind: 'mismatch', message: 'Ce système n’appartient pas à la famille choisie' };
    });

    apply(schema.settings, connectionSettingsSchema);
  });

  public readonly selectedFamily = computed<ConnectionFamily>(() => {
    const family = this.formSchema.family().value();
    return family === 'Insurance' ? 'Insurance' : 'CoreBanking';
  });

  public readonly selectedMode = computed<ConnectionMode>(() => {
    const mode = this.formSchema.mode().value();
    if (mode === 'Batch') return 'Batch';
    if (mode === 'Relay') return 'Relay';
    return 'Api';
  });

  public readonly kindOptions = computed(() => {
    const family = this.formSchema.family().value() as ConnectionFamily;
    return (CONNECTION_KINDS_BY_FAMILY[family] ?? []).map((kind) => ({
      label: kind.label,
      value: kind.value,
    }));
  });

  public readonly familyDescription = computed(
    () => CONNECTION_FAMILIES.find((f) => f.value === this.formSchema.family().value())?.description ?? '',
  );

  public readonly modeDescription = computed(
    () => CONNECTION_MODES.find((m) => m.value === this.formSchema.mode().value())?.description ?? '',
  );

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

  public handleSubmit(): void {
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
            name: value.name,
            settings: connectionSettingsToDto(value.settings, null),
            $kind: KIND_ENUM[value.kind as ConnectionKind],
          } as any)
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

      this._snackbar.success(
        'Connexion déclarée',
        'Elle est inactive : renseignez ses identifiants, testez-la, puis activez-la.',
      );
      this._dialogRef.close(connectionId);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
