import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { RelayAgentDto, RelayAgentEnrolmentDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import {
  integrationErrorMessage,
  IntegrationFacadeService,
} from '../data-access/integration-facade.service';
import { isRelayAgentOnline, relayAgentStatusMeta } from '../data-access/integration-referential';

class RegisterAgentFormModel {
  public name!: string;

  public static instantiate(suggestion: string): RegisterAgentFormModel {
    const model = new RegisterAgentFormModel();
    model.name = suggestion;
    return model;
  }
}

/**
 * Agent relais d'une connexion en mode `Relay`.
 *
 * Deux faits du contrat dictent la forme de ce panneau. D'abord le lien connexion ↔ agent
 * est posé par le serveur à l'enrôlement et n'est jamais accepté dans un corps de requête
 * (« an id taken from a request body could name another tenant's on-premise agent ») : on
 * ne propose donc aucun choix d'agent, on retrouve le sien par `connection.relayAgentId`.
 * Ensuite `GET relay-agents` renvoie TOUS les agents du tenant, sans filtre par connexion :
 * la liste d'attente d'enrôlement est donc présentée comme telle, à l'échelle du tenant.
 */
@Component({
  selector: 'relay-agent-panel',
  imports: [
    Button,
    TasIcon,
    TasTag,
    TasTable,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TimeagoPipe,
    FormRoot,
    FormField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (enrolment(); as token) {
      <div class="rounded-lg border border-functional-warning bg-yellow-50 p-4 mb-5">
        <p class="text-sm font-semibold text-slate-800">Jeton d'enrôlement de « {{ token.name }} »</p>
        <p class="text-sm text-slate-600 mt-1">
          Ce jeton ne sera plus affiché. Copiez-le maintenant et donnez-le à l'agent lors de son
          installation. Un jeton perdu ne se retrouve pas : enregistrez un autre agent et révoquez
          celui-ci.
        </p>
        <div class="mt-3 flex items-start gap-2">
          <code
            class="flex-1 break-all rounded-lg border border-slate-200 bg-white p-3 text-xs font-mono text-slate-800"
            >{{ token.enrolmentToken }}</code
          >
          <button tas-outlined-button color="primary" type="button" (click)="copyToken()">
            <tas-icon iconName="feather:copy" iconSize="sm"></tas-icon>
            Copier
          </button>
        </div>
        <p class="text-xs text-slate-500 mt-2">
          Valable jusqu'au {{ token.expiresAt | dateTimeAgo }}, puis il faudra en générer un autre.
        </p>
        @if (guideUrl()) {
          <a class="text-xs text-primary underline mt-2 inline-block" [href]="guideUrl()" target="_blank" rel="noopener">
            Guide d'installation de l'agent relais
          </a>
        } @else {
          <p class="text-xs text-slate-500 mt-2">
            La procédure d'installation est livrée avec le paquet de l'agent relais.
          </p>
        }
        <div class="mt-3">
          <button tas-text-button type="button" (click)="dismissToken()">J'ai copié le jeton</button>
        </div>
      </div>
    }

    @if (agent(); as current) {
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-medium text-slate-800">{{ current.name || 'Agent relais' }}</span>
            <tas-tag [severity]="statusMeta().severity">{{ statusMeta().label }}</tas-tag>
            <tas-tag [severity]="isOnline() ? 'success' : 'error'">
              {{ isOnline() ? 'En ligne' : 'Hors ligne' }}
            </tas-tag>
          </div>
          <dl class="mt-3 grid grid-cols-3 gap-x-8 gap-y-2 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Dernier contact</dt>
              <dd class="text-slate-700">
                {{ current.lastHeartbeatAt ? (current.lastHeartbeatAt | dateTimeAgo) : '—' }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Version annoncée</dt>
              <dd class="text-slate-700">{{ current.reportedVersion || '—' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Latence annoncée</dt>
              <dd class="text-slate-700 tabular-nums">
                {{ current.reportedLatencyMs != null ? current.reportedLatencyMs + ' ms' : '—' }}
              </dd>
            </div>
          </dl>
          @if (current.reportedStatusDetail) {
            <p class="text-xs text-slate-500 mt-2">{{ current.reportedStatusDetail }}</p>
          }
          @if (!isOnline() && current.status === 'Active') {
            <p class="text-xs text-slate-500 mt-2">
              L'agent n'a pas donné signe de vie depuis plus de trois minutes. Les écritures restent
              en attente tant qu'il ne répond pas.
            </p>
          }
        </div>
        @if (canManage() && current.status !== 'Revoked') {
          <button tas-outlined-button color="warn" type="button" (click)="confirmRevoke(current)">
            Révoquer
          </button>
        }
      </div>
    } @else {
      <p class="text-sm text-slate-600">
        Aucun agent n'est encore rattaché à cette connexion. Générez un jeton d'enrôlement, puis
        installez l'agent chez vous avec ce jeton : c'est l'agent qui se rattache à la connexion au
        moment de son enrôlement.
      </p>

      @if (canManage()) {
        <form [formRoot]="formSchema" class="mt-4 flex items-start gap-3">
          <tas-form-field class="flex-1">
            <tas-label>Nom de l'agent <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="ex: Relais siège" [formField]="formSchema.name" />
            @if (formSchema.name().touched() && formSchema.name().invalid()) {
              <tas-error>{{ formSchema.name().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Ce nom vous sert à reconnaître la machine qui relaie les appels.</tas-hint>
            }
          </tas-form-field>
          <button
            tas-raised-button
            color="primary"
            type="button"
            class="mt-6"
            (click)="handleRegister()"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
          >
            Générer un jeton d'enrôlement
          </button>
        </form>
      }

      @if (pendingAgents().length > 0) {
        <div class="mt-5">
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm font-medium text-slate-700">Agents en attente d'enrôlement</p>
            <button tas-text-button type="button" (click)="reload()">Actualiser</button>
          </div>
          <p class="text-xs text-slate-400 mb-2">
            Le serveur ne rattache un agent qu'à son enrôlement : ces agents appartiennent au tenant
            et ne sont encore liés à aucune connexion.
          </p>
          <tas-table
            [data]="pendingAgents()"
            identifierField="id"
            [config]="tableConfig()"
            [isLoading]="isLoading()"
            [hasCaption]="false"
          >
            <ng-template #header>
              <tr>
                <th>Agent</th>
                <th>Jeton</th>
                <th class="text-right"></th>
              </tr>
            </ng-template>
            <ng-template #body let-item>
              <tr>
                <td class="py-3 font-medium text-slate-800">{{ item.name || 'Agent relais' }}</td>
                <td class="text-sm text-slate-600">
                  {{ item.enrolmentTokenExpiresAt ? ('expire ' + (item.enrolmentTokenExpiresAt | dateTimeAgo)) : '—' }}
                </td>
                <td class="text-right">
                  @if (canManage()) {
                    <button tas-text-button color="warn" type="button" (click)="confirmRevoke(item)">
                      Révoquer
                    </button>
                  }
                </td>
              </tr>
            </ng-template>
          </tas-table>
        </div>
      }
    }

    @if (loadFailed()) {
      <p class="text-sm text-functional-error mt-3">{{ loadFailed() }}</p>
    }
  `,
})
export class RelayAgentPanelComponent {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly connectionName = input<string>('');
  public readonly relayAgentId = input<string | null>(null);
  public readonly canManage = input(false);

  /**
   * Le contrat ne publie aucune adresse de guide d'installation. Le panneau l'accepte donc
   * en entrée : l'écran qui le monte la fournit si le déploiement en a une, et à défaut le
   * panneau dit où trouver la procédure plutôt que d'afficher un lien mort.
   */
  public readonly guideUrl = input<string | null>(null);

  public readonly agentChanged = output<void>();

  public readonly isLoading = signal(true);
  public readonly loadFailed = signal<string | null>(null);
  public readonly enrolment = signal<RelayAgentEnrolmentDto | null>(null);

  private readonly _agents = signal<RelayAgentDto[]>([]);

  public readonly agent = computed(() => {
    const id = this.relayAgentId();
    if (!id) return null;
    return this._agents().find((row) => row.id === id) ?? null;
  });

  public readonly pendingAgents = computed(() =>
    this._agents().filter((row) => row.isEnrolmentPending && row.status !== 'Revoked'),
  );

  public readonly statusMeta = computed(() => relayAgentStatusMeta(this.agent()?.status));

  public readonly isOnline = computed(() => isRelayAgentOnline(this.agent()?.lastHeartbeatAt));

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10],
      totalElements: 0,
    },
  });

  public model = signal(RegisterAgentFormModel.instantiate(''));

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: "Le nom de l'agent est obligatoire" });
  });

  constructor() {
    effect(() => {
      const suggestion = this.connectionName();
      if (!this.canManage()) {
        // `GET relay-agents` exige Integration.Connection.Manage : sans le droit, l'appel
        // répondrait 403 et le panneau afficherait une panne au lieu d'une règle d'accès.
        this.isLoading.set(false);
        return;
      }
      this.model.set(RegisterAgentFormModel.instantiate(suggestion ? `Relais ${suggestion}` : ''));
      this._load();
    });
  }

  public reload(): void {
    this._load();
  }

  public dismissToken(): void {
    this.enrolment.set(null);
  }

  public copyToken(): void {
    const token = this.enrolment()?.enrolmentToken;
    if (!token) return;

    navigator.clipboard?.writeText(token).then(
      () => this._snackbar.success('Jeton copié', 'Collez-le dans la configuration de l’agent.'),
      () =>
        this._snackbar.info(
          'Copie impossible',
          'Sélectionnez le jeton affiché et copiez-le à la main.',
        ),
    );
  }

  public handleRegister(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const result = await firstValueFrom(
        this._facade.registerRelayAgent(value.name).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error(
              'Erreur',
              integrationErrorMessage(err, "Impossible d'enregistrer l'agent relais."),
            );
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      if (!result) return;

      this.enrolment.set(result);
      this._snackbar.success(
        'Jeton généré',
        'Il est affiché une seule fois : copiez-le avant de quitter cet écran.',
      );
      this._load();
      this.agentChanged.emit();
    });
  }

  public confirmRevoke(agent: RelayAgentDto): void {
    const name = agent.name || 'cet agent';
    this._confirm.confirm({
      title: "Révoquer l'agent relais ?",
      message:
        `Le certificat de ${name} cesse d'être admis immédiatement, et un jeton d'enrôlement encore ` +
        `armé est brûlé. Les appels qui passaient par lui échoueront jusqu'à l'enrôlement d'un autre agent.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Révoquer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._revoke(agent),
    });
  }

  private _revoke(agent: RelayAgentDto): void {
    if (!agent.id) return;

    this._facade
      .revokeRelayAgent(agent.id)
      .pipe(
        tap(() => {
          this._snackbar.success('Agent révoqué', "Son certificat n'est plus admis.");
        }),
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, "Impossible de révoquer cet agent."),
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._load();
        this.agentChanged.emit();
      });
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadFailed.set(null);

    this._facade
      .listRelayAgents()
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadFailed.set(
            integrationErrorMessage(err, "Impossible de lire l'état des agents relais."),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((agents) => {
        this._agents.set(agents);
        this.isLoading.set(false);
      });
  }
}
