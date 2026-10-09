import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { ConnectionSecretStatusDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import {
  integrationErrorMessage,
  IntegrationFacadeService,
} from '../data-access/integration-facade.service';
import {
  CONNECTION_SECRET_SLOTS,
  ConnectionMode,
  formatContractDate,
} from '../data-access/integration-referential';

interface SecretRow {
  name: string;
  label: string;
  hint: string;
  isConfigured: boolean;
  maskedValue: string | null;
  expiresAt: string | null;
  /** Vrai quand l'emplacement est utilisé par le mode courant de la connexion. */
  usedByMode: boolean;
}

class SecretFormModel {
  public value!: string;
  public expiresAt!: string;

  public static instantiate(): SecretFormModel {
    const model = new SecretFormModel();
    model.value = '';
    model.expiresAt = '';
    return model;
  }
}

/**
 * Panneau des identifiants d'une connexion.
 *
 * Aucun endpoint ne rend la valeur d'un secret : « the values themselves are not
 * retrievable by any endpoint ». Le panneau n'affiche donc que l'indice masqué du coffre
 * — « enough to tell two credentials apart while rotating one, never enough to use
 * either » —, l'état renseigné/non renseigné et l'expiration déclarée. Le champ de saisie
 * est vidé après l'enregistrement : le ré-afficher laisserait croire qu'on peut relire ce
 * qui est stocké.
 */
@Component({
  selector: 'connection-secrets-panel',
  imports: [
    Button,
    TasIcon,
    TasTable,
    TasTag,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    FormRoot,
    FormField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tas-table
      [data]="rows()"
      identifierField="name"
      [config]="tableConfig()"
      [isLoading]="isLoading()"
      [hasCaption]="false"
    >
      <ng-template #header>
        <tr>
          <th>Identifiant</th>
          <th>État</th>
          <th>Expiration déclarée</th>
          <th class="text-right"></th>
        </tr>
      </ng-template>

      <ng-template #body let-item>
        <tr>
          <td class="py-3">
            <div class="font-medium text-slate-800">{{ item.label }}</div>
            <div class="text-xs text-slate-400 mt-0.5">{{ item.hint }}</div>
            @if (!item.usedByMode) {
              <div class="text-xs text-slate-400 mt-1">
                Cet identifiant ne sert pas au mode actuel de la connexion.
              </div>
            }
          </td>
          <td>
            <div class="flex items-center gap-2">
              <tas-tag [severity]="item.isConfigured ? 'success' : 'neutral'">
                {{ item.isConfigured ? 'Renseigné' : 'Non renseigné' }}
              </tas-tag>
              @if (item.isConfigured && item.maskedValue) {
                <span class="text-xs text-slate-500 font-mono">{{ item.maskedValue }}</span>
              }
            </div>
          </td>
          <td class="text-sm text-slate-600 tabular-nums">
            {{ item.expiresAt ? formatDate(item.expiresAt) : '—' }}
          </td>
          <td class="text-right">
            @if (canManage()) {
              <button tas-outlined-button color="primary" type="button" (click)="startEdit(item.name)">
                {{ item.isConfigured ? 'Remplacer' : 'Renseigner' }}
              </button>
            }
          </td>
        </tr>

        @if (editing() === item.name) {
          <tr>
            <td colspan="4" class="p-0">
              <form [formRoot]="formSchema" class="bg-slate-50 p-4 flex flex-col gap-4">
                <div class="grid grid-cols-2 gap-4">
                  <tas-form-field>
                    <tas-label>Nouvelle valeur <span class="text-functional-error">*</span></tas-label>
                    <input tasInput type="password" autocomplete="new-password" [formField]="formSchema.value" />
                    @if (formSchema.value().touched() && formSchema.value().invalid()) {
                      <tas-error>{{ formSchema.value().errors()[0].message }}</tas-error>
                    } @else {
                      <tas-hint>La valeur part dans le coffre et n'est plus relisible ensuite.</tas-hint>
                    }
                  </tas-form-field>

                  <tas-form-field>
                    <tas-label>Expire le</tas-label>
                    <input tasInput type="date" [formField]="formSchema.expiresAt" />
                    @if (formSchema.expiresAt().touched() && formSchema.expiresAt().invalid()) {
                      <tas-error>{{ formSchema.expiresAt().errors()[0].message }}</tas-error>
                    } @else {
                      <tas-hint>Facultatif. Sert à prévenir avant une rotation.</tas-hint>
                    }
                  </tas-form-field>
                </div>

                <div class="flex items-center justify-end gap-2">
                  <button tas-text-button type="button" (click)="cancelEdit()">Annuler</button>
                  <button
                    tas-raised-button
                    color="primary"
                    type="button"
                    (click)="handleSave()"
                    [disabled]="formSchema().invalid() || formSchema().submitting()"
                    [isLoading]="formSchema().submitting()"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            </td>
          </tr>
        }
      </ng-template>
    </tas-table>

    @if (loadFailed()) {
      <p class="text-sm text-functional-error mt-3 flex items-center gap-2">
        <tas-icon iconName="feather:alert-triangle" iconSize="sm"></tas-icon>
        {{ loadFailed() }}
      </p>
    }
  `,
})
export class ConnectionSecretsPanelComponent {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly connectionId = input.required<string>();
  public readonly mode = input.required<ConnectionMode>();
  public readonly canManage = input(false);

  public readonly isLoading = signal(true);
  public readonly loadFailed = signal<string | null>(null);
  public readonly editing = signal<string | null>(null);

  private readonly _statuses = signal<ConnectionSecretStatusDto[]>([]);

  public readonly tableConfig = signal<TableConfig>({
    property: 'name',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10],
      totalElements: 0,
    },
  });

  /**
   * Les emplacements viennent du référentiel, l'état vient du serveur. Un emplacement
   * renseigné mais étranger au mode courant reste affiché : un secret stocké existe, et le
   * masquer ferait disparaître une rotation à faire.
   */
  public readonly rows = computed<SecretRow[]>(() => {
    const statuses = this._statuses();
    const mode = this.mode();

    return CONNECTION_SECRET_SLOTS.map((slot) => {
      const status = statuses.find((row) => row.name === slot.name);
      return {
        name: slot.name,
        label: slot.label,
        hint: slot.hint,
        isConfigured: status?.isConfigured ?? false,
        maskedValue: status?.maskedValue ?? null,
        expiresAt: status?.expiresAt ?? null,
        usedByMode: slot.modes.includes(mode),
      };
    }).filter((row) => row.usedByMode || row.isConfigured);
  });

  public model = signal(SecretFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.value, { message: 'La valeur du secret est obligatoire' });
    validate(schema.expiresAt, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (raw === '') return null;
      return Number.isFinite(Date.parse(raw))
        ? null
        : { kind: 'pattern', message: 'Entrez une date valide' };
    });
  });

  constructor() {
    effect(() => {
      const connectionId = this.connectionId();
      if (!this.canManage()) {
        // `GET connections/{id}/secrets` exige Integration.Connection.Manage : sans le
        // droit, l'appel répondrait 403 et l'écran afficherait une panne au lieu d'une
        // règle d'accès.
        this.isLoading.set(false);
        return;
      }
      this._load(connectionId);
    });
  }

  public formatDate(value: string): string {
    return formatContractDate(value);
  }

  public startEdit(name: string): void {
    this.model.set(SecretFormModel.instantiate());
    this.editing.set(name);
  }

  public cancelEdit(): void {
    this.editing.set(null);
    this.model.set(SecretFormModel.instantiate());
  }

  public handleSave(): void {
    const name = this.editing();
    if (!name) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();

      /**
       * L'endpoint répond 204, donc l'observable émet `null` : un succès ne se distingue
       * pas d'un repli sur `EMPTY` par la valeur reçue. Le drapeau le dit sans ambiguïté.
       */
      let saved = false;
      await firstValueFrom(
        this._facade
          .setSecret(this.connectionId(), name, value.value, toExpiryInstant(value.expiresAt))
          .pipe(
            tap(() => {
              saved = true;
            }),
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                integrationErrorMessage(err, "Impossible d'enregistrer cet identifiant."),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success('Identifiant enregistré', 'La valeur est dans le coffre.');
      this.cancelEdit();
      this._load(this.connectionId());
    });
  }

  private _load(connectionId: string): void {
    this.isLoading.set(true);
    this.loadFailed.set(null);

    this._facade
      .getSecretStatus(connectionId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadFailed.set(
            integrationErrorMessage(err, "Impossible de lire l'état des identifiants."),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((statuses) => {
        this._statuses.set(statuses);
        this.isLoading.set(false);
      });
  }
}

/**
 * Le contrat attend un `date-time` alors que la saisie est un jour. Une expiration
 * annoncée « le 12 » vaut jusqu'à la fin du 12 : prendre minuit ferait expirer le secret
 * un jour trop tôt.
 */
function toExpiryInstant(day: string): string | null {
  const trimmed = (day ?? '').trim();
  if (trimmed === '') return null;
  const parsed = new Date(`${trimmed}T23:59:59`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
