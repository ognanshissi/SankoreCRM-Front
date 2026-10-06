import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, finalize, forkJoin, of, switchMap } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasInput } from '@talisoft/ui/input';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  LeadsApiService,
  UsersApiService,
  UserDto,
  LeadDto,
} from '@sankore/crm-api';
import { TasTitle } from '@talisoft/ui/title';

export interface ReassignLeadDrawerData {
  lead: LeadDto;
}

/** Un facteur du score, tel que le moteur l'a calculé — pas une approximation. */
interface FactorChip {
  label: string;
  contribution: number;
}

interface AgentRow {
  /** Pour l'affichage uniquement : email, agence, disponibilité, initiales. */
  user: UserDto;
  score: number;
  factors: FactorChip[];
  openTasks: number;
  maxTasks: number;
  hotLeads: number;
  /** L'agent que le moteur retiendrait de lui-même. */
  isEngineChoice: boolean;
  isExcludedByRule: boolean;
  isAtTaskCapacity: boolean;
  isBlockedByAntiMonopoly: boolean;
  isEligible: boolean;
}

/** Forme du `compatibilityFactorsJson` renvoyé par le moteur (CompatibilityScorer). */
interface ScoreFactors {
  language?: { matched?: boolean; contribution?: number };
  product?: { matched?: boolean; contribution?: number };
  geography?: { distanceKm?: number | null; contribution?: number };
  agency?: { matched?: boolean; contribution?: number };
  performance?: { contribution?: number };
  workload?: { contribution?: number };
}

@Component({
  selector: 'reassign-lead-drawer',
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
    TasInput,
    TasFormField,
    TasLabel,
    TasHint,
    FormsModule,
    TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Réassigner le lead</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Lead summary -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p class="text-sm font-medium text-slate-800">
            {{ data.lead.fullName ?? leadDisplayName() }}
          </p>
          @if (data.lead.phoneNumber) {
            <p class="text-xs text-slate-400 mt-0.5">
              {{ data.lead.phoneNumber }}
            </p>
          }
          @if (data.lead.currentAssignedId) {
            <div class="flex items-center gap-1 mt-1.5">
              <tas-icon
                iconName="feather:user"
                class="text-slate-400"
                style="font-size:10px"
              ></tas-icon>
              <span class="text-xs text-slate-500"
                >Assigné actuellement à :
                <span class="font-medium">{{ currentOwnerName() }}</span></span
              >
            </div>
          }
        </div>

        <!-- Search -->
        <tas-form-field size="small">
          <tas-label>Rechercher un agent</tas-label>
          <input
            tasInput
            type="text"
            placeholder="Nom, email..."
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
          />
        </tas-form-field>

        <!-- Reason — requis : l'API écrit l'affectation avec WasManualOverride = true et
             conserve ce motif, c'est lui qui explique l'override dans l'historique. -->
        <div class="mt-3">
          <tas-form-field size="small">
            <tas-label
              >Motif de réassignation
              <span class="text-functional-error">*</span></tas-label
            >
            <input
              tasInput
              type="text"
              placeholder="Ex : congé de l'agent, meilleur profil..."
              [ngModel]="reason()"
              (ngModelChange)="reason.set($event)"
            />
            @if (!reason().trim()) {
              <tas-hint>Obligatoire : conservé dans l'historique d'affectation.</tas-hint>
            }
          </tas-form-field>
        </div>

        <!-- Agent list -->
        <div class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-semibold text-slate-600">
              Agents disponibles
              <span class="text-slate-400 font-normal">
                @if (ruleName()) {
                  (règle « {{ ruleName() }} »
                } @else {
                  (règles par défaut
                }
                @if (strategy()) {
                  · {{ strategy() }}
                }
                )
              </span>
            </p>
            @if (isLoadingAgents()) {
              <tas-spinner size="3" class="text-primary"></tas-spinner>
            }
          </div>

          @if (previewError()) {
            <div class="py-8 text-center">
              <tas-icon
                iconName="feather:alert-triangle"
                class="text-functional-error mb-1"
                style="font-size:24px"
              ></tas-icon>
              <p class="text-xs text-slate-600">{{ previewError() }}</p>
              <button
                tas-text-button
                color="primary"
                type="button"
                class="mt-2"
                (click)="reload()"
              >
                <tas-icon iconName="feather:refresh-cw"></tas-icon> Réessayer
              </button>
            </div>
          } @else if (isLoadingAgents() && filteredAgents().length === 0) {
            <div class="flex justify-center py-8">
              <tas-spinner size="6" class="text-primary"></tas-spinner>
            </div>
          } @else if (filteredAgents().length === 0) {
            <div class="py-8 text-center">
              <tas-icon
                iconName="feather:users"
                class="text-slate-300 mb-1"
                style="font-size:24px"></tas-icon>
              <p class="text-xs text-slate-400">Aucun agent trouvé</p>
            </div>
          } @else {
            <div class="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto">
              @for (agent of filteredAgents(); track agent.user.id) {
                <!-- Un agent exclu par la règle est montré mais pas sélectionnable : le
                     serveur refuserait (AGENT_EXCLUDED_BY_RULE), alors que « à capacité » et
                     « quota anti-monopole » restent choisissables — l'override les franchit
                     volontairement. -->
                <button
                  type="button"
                  [disabled]="agent.isExcludedByRule"
                  class="w-full text-left p-3 rounded-lg border transition-all"
                  [class]="
                    agent.isExcludedByRule
                      ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                      : selectedAgentId() === agent.user.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30 hover:shadow-sm'
                        : agent.isAtTaskCapacity || agent.isBlockedByAntiMonopoly
                          ? 'border-amber-200 bg-amber-50/50 hover:shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                  "
                  (click)="selectAgent(agent)"
                >
                  <div class="flex items-center gap-3">
                    <!-- Avatar -->
                    <div
                      class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                      [class]="
                        agent.isAtTaskCapacity || agent.isBlockedByAntiMonopoly
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-teal-50 text-teal-800'
                      "
                    >
                      {{ initials(agent.user) }}
                    </div>

                    <!-- Info -->
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5">
                        <p class="text-sm font-medium text-slate-800 truncate">
                          {{ agent.user.fullName ?? agent.user.email }}
                        </p>
                        @if (agent.isEngineChoice) {
                          <tas-tag severity="primary" class="shrink-0"
                            >Choix du moteur</tas-tag
                          >
                        }
                        @if (agent.isExcludedByRule) {
                          <tas-tag severity="neutral" class="shrink-0"
                            >Exclu par la règle</tas-tag
                          >
                        }
                        @if (agent.isAtTaskCapacity) {
                          <tas-tag severity="warning" class="shrink-0"
                            >À capacité ({{ agent.openTasks }}/{{
                              agent.maxTasks
                            }})</tas-tag
                          >
                        }
                        @if (agent.isBlockedByAntiMonopoly) {
                          <tas-tag severity="warning" class="shrink-0"
                            >Quota anti-monopole</tas-tag
                          >
                        }
                        @if (agent.user.isAvailable === false) {
                          <tas-tag severity="neutral" class="shrink-0"
                            >Indisponible</tas-tag
                          >
                        }
                      </div>
                      <div class="flex items-center gap-3 mt-0.5">
                        @if (agent.user.agencyName) {
                          <span class="text-[10px] text-slate-400">{{
                            agent.user.agencyName
                          }}</span>
                        }
                        <span class="text-[10px] text-slate-400 tabular-nums"
                          >{{ agent.openTasks }} tâche(s) ouverte(s)</span
                        >
                        @if (agent.hotLeads > 0) {
                          <span class="text-[10px] text-slate-400 tabular-nums"
                            >{{ agent.hotLeads }} lead(s) chaud(s)</span
                          >
                        }
                      </div>
                      <!-- Facteurs du score, tels que le moteur les a calculés -->
                      @if (agent.factors.length > 0) {
                        <div class="flex items-center gap-1 flex-wrap mt-1">
                          <tas-icon
                            iconName="feather:zap"
                            style="font-size:8px"
                            class="text-amber-500"
                          ></tas-icon>
                          @for (f of agent.factors; track f.label) {
                            <span
                              class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 tabular-nums"
                            >
                              {{ f.label }}@if (f.contribution > 0) {
                                <span class="text-slate-400"
                                  >&nbsp;+{{ f.contribution }}</span
                                >
                              }
                            </span>
                          }
                        </div>
                      }
                    </div>

                    <!-- Score -->
                    <div class="text-right shrink-0">
                      <div
                        class="text-lg font-bold tabular-nums"
                        [class]="compatibilityScoreColor(agent.score)">
                        {{ agent.score }}
                      </div>
                      <p class="text-[9px] text-slate-400 -mt-0.5">
                        compatibilité
                      </p>
                    </div>
                  </div>

                  <!-- Charge réelle : tâches ouvertes sur le plafond de la règle. C'était
                       auparavant un taux de respect du SLA inventé côté client — le preview n'en
                       fournit pas, et la charge est précisément ce que signale « À capacité ». -->
                  @if (agent.maxTasks > 0) {
                    <div class="mt-2 flex items-center gap-2">
                      <div
                        class="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden"
                      >
                        <div
                          class="h-full rounded-full transition-all"
                          [class]="loadBarColor(agent)"
                          [style.width.%]="loadPercent(agent)"
                        ></div>
                      </div>
                      <span
                        class="text-[9px] text-slate-400 tabular-nums shrink-0"
                      >
                        charge {{ agent.openTasks }}/{{ agent.maxTasks }}
                      </span>
                    </div>
                  }
                </button>
              }
            </div>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
          <button tas-outlined-button type="button" (click)="close()">
            <tas-icon iconName="feather:x"></tas-icon> Annuler
          </button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="!canSubmit() || isSubmitting()"
            (click)="confirm()"
          >
            @if (isSubmitting()) {
              <tas-spinner size="3" class="text-white"></tas-spinner>
            } @else if (!isSubmitting()) {
              <tas-icon iconName="feather:send"></tas-icon>
            }
            Réassigner
          </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ReassignLeadDrawer implements OnInit {
  public readonly data: ReassignLeadDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);

  public isLoadingAgents = signal(true);
  public isSubmitting = signal(false);
  public searchQuery = signal('');
  public reason = signal('');
  public selectedAgentId = signal<string | null>(null);
  public currentOwnerName = signal('—');
  /** Message d'erreur du preview : s'il est posé, aucune liste n'est affichable. */
  public previewError = signal<string | null>(null);
  public engineChoiceId = signal<string | null>(null);
  public ruleName = signal<string | null>(null);
  public strategy = signal<string | null>(null);

  public agents = signal<AgentRow[]>([]);

  /** Un agent ET un motif : l'API refuse un override sans motif. */
  public readonly canSubmit = computed(
    () => !!this.selectedAgentId() && this.reason().trim().length > 0,
  );

  public readonly filteredAgents = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const list = this.agents();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.user.fullName?.toLowerCase().includes(q) ||
        a.user.email?.toLowerCase().includes(q) ||
        a.user.agencyName?.toLowerCase().includes(q),
    );
  });

  ngOnInit(): void {
    this._loadAgents();
  }

  public leadDisplayName(): string {
    const l = this.data.lead;
    const parts = [l.firstName, l.lastName].filter(Boolean);
    return parts.length
      ? parts.join(' ')
      : (l.phoneNumber ?? l.email ?? 'Lead');
  }

  public initials(user: UserDto): string {
    const name = user.fullName ?? user.email ?? '';
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  }

  public compatibilityScoreColor(score: number): string {
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-amber-600';
    return 'text-red-500';
  }

  /**
   * Réassignation = créer une AFFECTATION, puis aligner le propriétaire.
   *
   * Ce tiroir n'appelait que `updateLeadOwner`, qui ne touche que `OwnerId`. Or ce que l'écran
   * montre — compatibilité, saturation, respect du SLA, « les agents seront notifiés » — relève
   * de l'affectation : `OwnerId` dit qui porte la relation, `CurrentAssignmentId` dit quelle
   * décision de dispatch est en vigueur (cf. Lead.cs). Sans affectation, aucun SLA ne démarre et
   * `RecordFirstContact` refuse le lead avec LEAD_HAS_NO_ACTIVE_ASSIGNMENT — un agent voyait donc
   * le lead « réassigné » puis ne pouvait pas enregistrer son premier contact.
   *
   * `dispatchLead` accepte désormais un agent explicite : le moteur ne classe plus, il prend
   * celui qu'on nomme. `overrideReason` est obligatoire côté API (l'affectation est écrite avec
   * WasManualOverride = true, et un override sans motif n'explique rien dans l'historique), d'où
   * le motif devenu requis dans le formulaire.
   *
   * Les deux appels sont séquentiels et non atomiques. Si le propriétaire échoue après une
   * affectation réussie — `UpdateLeadOwner` refuse un non-superviseur qui réassigne le lead d'un
   * autre — on le dit, au lieu d'annoncer un succès complet : l'affectation, elle, est bien faite.
   */
  public confirm(): void {
    const agentId = this.selectedAgentId();
    const reason = this.reason().trim();
    if (!agentId || !reason) return;

    const agent = this.agents().find((a) => a.user.id === agentId);
    const agentName = agent?.user.fullName ?? agent?.user.email ?? agentId;

    this.isSubmitting.set(true);
    this._leadsApiService
      .dispatchLead(this.data.lead.id!, {
        agentId,
        overrideReason: reason,
      })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            this._dispatchErrorMessage(err, agentName),
          );
          return EMPTY;
        }),
        // Le propriétaire suit l'affectation. Son échec ne remet pas l'affectation en cause.
        switchMap(() =>
          this._leadsApiService
            .updateLeadOwner(this.data.lead.id!, {
              ownerId: agentId,
              reason,
              assignmentMethod: 'ManualReassignment',
            })
            .pipe(
              catchError(() => {
                this._snackbar.error(
                  'Partiellement appliqué',
                  `Le lead est bien affecté à ${agentName}, mais son propriétaire n'a pas pu être changé — droits insuffisants.`,
                );
                this._dialogRef.close(true);
                return EMPTY;
              }),
            ),
        ),
        finalize(() => this.isSubmitting.set(false)),
      )
      .subscribe({
        next: () => {
          this._snackbar.success(
            'Lead réassigné',
            `Le lead a été affecté à ${agentName}. L'ancien et le nouvel agent seront notifiés.`,
          );
          this._dialogRef.close(true);
        },
      });
  }

  /** Les refus du moteur sont nommés : les afficher tels quels évite un aller-retour. */
  private _dispatchErrorMessage(err: HttpErrorResponse, agentName: string): string {
    const detail = err.error?.detail ?? '';

    if (detail.includes('AGENT_NOT_ELIGIBLE'))
      return `${agentName} ne fait pas partie des agents disponibles pour l'agence de ce lead.`;
    if (detail.includes('AGENT_EXCLUDED_BY_RULE'))
      return `${agentName} est exclu par la règle de dispatching en vigueur.`;
    if (detail.includes('LEAD_NOT_DISPATCHABLE'))
      return 'Ce lead est clôturé : il ne peut plus être affecté.';

    return err.error?.title ?? 'Impossible de réassigner le lead.';
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  public reload(): void {
    this._loadAgents();
  }

  /** Un agent exclu par la règle n'est pas sélectionnable : le serveur le refuserait. */
  public selectAgent(agent: AgentRow): void {
    if (agent.isExcludedByRule) return;
    this.selectedAgentId.set(agent.user.id ?? null);
  }

  public loadPercent(agent: AgentRow): number {
    if (agent.maxTasks <= 0) return 0;
    return Math.min(100, Math.round((agent.openTasks / agent.maxTasks) * 100));
  }

  /** Vert tant que la charge est basse — l'inverse de l'ancienne barre de SLA. */
  public loadBarColor(agent: AgentRow): string {
    const pct = this.loadPercent(agent);
    if (pct >= 100) return 'bg-red-400';
    if (pct >= 75) return 'bg-amber-500';
    return 'bg-green-500';
  }

  private _loadAgents(): void {
    this.isLoadingAgents.set(true);
    this.previewError.set(null);

    // Deux lectures, jointes sur l'identifiant de l'agent :
    //  - `dispatch-preview` donne les CHIFFRES, calculés par le moteur lui-même (score, facteurs,
    //    charge réelle, et ce que le moteur choisirait) ;
    //  - `listUsers` ne donne que l'affichage (email, agence, disponibilité), absent du preview.
    //
    // C'est le preview qui pilote la liste, pas `listUsers`. Son vivier est l'agence du lead
    // (GetAvailableAgentsAsync(tenantId, lead.PreferredAgencyId)) : un agent qui n'y figure pas ne
    // PEUT PAS recevoir ce lead, et le choisir renvoyait AGENT_NOT_ELIGIBLE à la validation. La
    // liste est donc plus courte qu'avant, et c'est le but — l'impossibilité est visible à
    // l'ouverture au lieu d'être découverte à l'envoi.
    forkJoin({
      users: this._usersApiService
        .listUsers('Active', undefined, undefined, 1, 200)
        .pipe(catchError(() => of({ items: [] as UserDto[], totalCount: 0 }))),
      preview: this._leadsApiService
        .previewLeadDispatch(this.data.lead.id!)
        .pipe(
          catchError((err: HttpErrorResponse) => {
            // Pas de repli sur des estimations : ce serait revenir aux chiffres inventés que ce
            // changement supprime. Mieux vaut un état d'erreur explicite et aucune liste.
            this.previewError.set(
              (err.error?.detail ?? '').includes('LEAD_NOT_DISPATCHABLE')
                ? 'Ce lead est clôturé : il ne peut plus être réassigné.'
                : "Impossible de calculer les affectations possibles pour ce lead.",
            );
            return of(null);
          }),
        ),
    }).subscribe(({ users, preview }) => {
      const userList = users?.items ?? [];

      // Le nom de l'agent en charge vient de `listUsers` : il peut être hors du vivier.
      const ownerId = this.data.lead.ownerId ?? this.data.lead.currentAssignedId;
      if (ownerId) {
        const owner = userList.find((u) => u.id === ownerId);
        if (owner) {
          this.currentOwnerName.set(owner.fullName ?? owner.email ?? ownerId);
        }
      }

      if (!preview) {
        this.agents.set([]);
        this.isLoadingAgents.set(false);
        return;
      }

      this.engineChoiceId.set(preview.wouldAssignToAgentId ?? null);
      this.ruleName.set(preview.ruleName ?? null);
      this.strategy.set(preview.strategy ?? null);

      const byId = new Map(userList.map((u) => [u.id, u]));

      const agents: AgentRow[] = (preview.candidates ?? [])
        .filter((c) => c.agentId !== ownerId) // exclut l'agent déjà en charge
        .map((c) => {
          const user = byId.get(c.agentId);

          return {
            // Le preview porte le nom ; `listUsers` complète le reste quand il le connaît.
            user: user ?? { id: c.agentId, fullName: c.fullName },
            score: Math.round(c.compatibilityScore ?? 0),
            factors: this._parseFactors(c.compatibilityFactorsJson),
            openTasks: c.openTaskCount ?? 0,
            maxTasks: preview.maxTasksPerAgent ?? 0,
            hotLeads: c.hotLeadsCount ?? 0,
            isEngineChoice: c.agentId === preview.wouldAssignToAgentId,
            isExcludedByRule: c.isExcludedByRule ?? false,
            isAtTaskCapacity: c.isAtTaskCapacity ?? false,
            isBlockedByAntiMonopoly: c.isBlockedByAntiMonopoly ?? false,
            isEligible: c.isEligible ?? false,
          };
        })
        // Le serveur trie déjà (éligibles d'abord, puis score) ; on le refait pour ne pas
        // dépendre de l'ordre de sérialisation.
        .sort((a, b) =>
          a.isEligible === b.isEligible
            ? b.score - a.score
            : Number(b.isEligible) - Number(a.isEligible),
        );

      this.agents.set(agents);
      this.isLoadingAgents.set(false);
    });
  }

  /**
   * Transforme le `compatibilityFactorsJson` du moteur en pastilles lisibles. On n'affiche qu'un
   * facteur qui a réellement contribué : une pastille « Langue ✓ +25 » explique le score, une
   * ligne « langue : non » ne fait que du bruit.
   *
   * Le JSON vient du serveur, mais un `parse` qui échoue ne doit pas faire tomber la liste : on
   * renvoie alors aucune pastille et le score reste affiché.
   */
  private _parseFactors(json: string | null | undefined): FactorChip[] {
    if (!json) return [];

    let f: ScoreFactors;
    try {
      f = JSON.parse(json) as ScoreFactors;
    } catch {
      return [];
    }

    const chips: FactorChip[] = [];
    const add = (label: string, contribution?: number): void => {
      if (contribution && contribution > 0) {
        chips.push({ label, contribution: Math.round(contribution) });
      }
    };

    if (f.language?.matched) add('Langue', f.language.contribution);
    if (f.product?.matched) add('Produit', f.product.contribution);
    if (f.agency?.matched) add('Agence', f.agency.contribution);
    add('Performance', f.performance?.contribution);
    add('Charge', f.workload?.contribution);

    // La distance n'est pas un « bonus » lisible : on montre le kilométrage, pas sa contribution.
    const km = f.geography?.distanceKm;
    if (typeof km === 'number') {
      chips.push({ label: `${Math.round(km)} km`, contribution: 0 });
    }

    return chips;
  }





}
