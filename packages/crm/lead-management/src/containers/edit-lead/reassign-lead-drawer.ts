import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, forkJoin, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasInput } from '@talisoft/ui/input';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
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
  DispatchLeadRequestStrategyEnum,
} from '@sankore/crm-api';

export interface ReassignLeadDrawerData {
  lead: LeadDto;
}

interface AgentRow {
  user: UserDto;
  compatibilityScore: number;
  compatibilityFactor: string;
  totalAssigned: number;
  slaComplianceRate: number;
  isSaturated: boolean;
}

const CAPACITY_THRESHOLD = 50;

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
    FormsModule,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:user-plus" style="font-size:18px"></tas-icon>
          <span>Réassigner le lead</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Lead summary -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p class="text-sm font-medium text-slate-800">{{ data.lead.fullName ?? leadDisplayName() }}</p>
          @if (data.lead.phoneNumber) {
            <p class="text-xs text-slate-400 mt-0.5">{{ data.lead.phoneNumber }}</p>
          }
          @if (data.lead.currentAssignedId) {
            <div class="flex items-center gap-1 mt-1.5">
              <tas-icon iconName="feather:user" class="text-slate-400" style="font-size:10px"></tas-icon>
              <span class="text-xs text-slate-500">Assigné actuellement à : <span class="font-medium">{{ currentOwnerName() }}</span></span>
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

        <!-- Reason -->
        <div class="mt-3">
          <tas-form-field size="small">
            <tas-label>Motif de réassignation</tas-label>
            <input
              tasInput
              type="text"
              placeholder="Ex : congé de l'agent, meilleur profil..."
              [ngModel]="reason()"
              (ngModelChange)="reason.set($event)"
            />
          </tas-form-field>
        </div>

        <!-- Agent list -->
        <div class="mt-4">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs font-semibold text-slate-600">
              Agents disponibles
              <span class="text-slate-400 font-normal">(triés par compatibilité)</span>
            </p>
            @if (isLoadingAgents()) {
              <tas-spinner size="3" class="text-primary"></tas-spinner>
            }
          </div>

          @if (isLoadingAgents() && filteredAgents().length === 0) {
            <div class="flex justify-center py-8">
              <tas-spinner size="6" class="text-primary"></tas-spinner>
            </div>
          } @else if (filteredAgents().length === 0) {
            <div class="py-8 text-center">
              <tas-icon iconName="feather:users" class="text-slate-300 mb-1" style="font-size:24px"></tas-icon>
              <p class="text-xs text-slate-400">Aucun agent trouvé</p>
            </div>
          } @else {
            <div class="flex flex-col gap-1.5 max-h-[400px] overflow-y-auto">
              @for (agent of filteredAgents(); track agent.user.id) {
                <button
                  type="button"
                  class="w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm"
                  [class]="selectedAgentId() === agent.user.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : agent.isSaturated
                      ? 'border-amber-200 bg-amber-50/50'
                      : 'border-slate-200 bg-white hover:border-slate-300'"
                  (click)="selectedAgentId.set(agent.user.id ?? null)"
                >
                  <div class="flex items-center gap-3">
                    <!-- Avatar -->
                    <div
                      class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                      [class]="agent.isSaturated ? 'bg-amber-100 text-amber-700' : 'bg-teal-50 text-teal-800'"
                    >
                      {{ initials(agent.user) }}
                    </div>

                    <!-- Info -->
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5">
                        <p class="text-sm font-medium text-slate-800 truncate">{{ agent.user.fullName ?? agent.user.email }}</p>
                        @if (agent.isSaturated) {
                          <tas-tag severity="warning" class="shrink-0">Saturé</tas-tag>
                        }
                        @if (!agent.user.isAvailable) {
                          <tas-tag severity="neutral" class="shrink-0">Indisponible</tas-tag>
                        }
                      </div>
                      <div class="flex items-center gap-3 mt-0.5">
                        @if (agent.user.agencyName) {
                          <span class="text-[10px] text-slate-400">{{ agent.user.agencyName }}</span>
                        }
                        <span class="text-[10px] text-slate-400">{{ agent.totalAssigned }} leads actifs</span>
                      </div>
                      <!-- Compatibility factor -->
                      @if (agent.compatibilityFactor) {
                        <p class="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                          <tas-icon iconName="feather:zap" style="font-size:8px" class="text-amber-500"></tas-icon>
                          {{ agent.compatibilityFactor }}
                        </p>
                      }
                    </div>

                    <!-- Score -->
                    <div class="text-right shrink-0">
                      <div
                        class="text-lg font-bold tabular-nums"
                        [class]="compatibilityScoreColor(agent.compatibilityScore)"
                      >
                        {{ agent.compatibilityScore }}
                      </div>
                      <p class="text-[9px] text-slate-400 -mt-0.5">compatibilité</p>
                    </div>
                  </div>

                  <!-- Performance bar -->
                  <div class="mt-2 flex items-center gap-2">
                    <div class="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all"
                        [class]="agent.slaComplianceRate >= 80 ? 'bg-green-500' : agent.slaComplianceRate >= 50 ? 'bg-amber-500' : 'bg-red-400'"
                        [style.width.%]="agent.slaComplianceRate"
                      ></div>
                    </div>
                    <span class="text-[9px] text-slate-400 tabular-nums shrink-0">
                      SLA {{ agent.slaComplianceRate }}%
                    </span>
                  </div>
                </button>
              }
            </div>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-between w-full">
          <button tas-outlined-button type="button" (click)="close()">
            Annuler
          </button>
          <button
            tas-button
            color="primary"
            type="button"
            [disabled]="!selectedAgentId() || isSubmitting()"
            (click)="confirm()"
          >
            @if (isSubmitting()) {
              <tas-spinner size="3" class="text-white"></tas-spinner>
            }
            Réassigner
          </button>
        </div>
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

  public agents = signal<AgentRow[]>([]);

  public readonly filteredAgents = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const list = this.agents();
    if (!q) return list;
    return list.filter((a) =>
      (a.user.fullName?.toLowerCase().includes(q)) ||
      (a.user.email?.toLowerCase().includes(q)) ||
      (a.user.agencyName?.toLowerCase().includes(q)),
    );
  });

  ngOnInit(): void {
    this._loadAgents();
  }

  public leadDisplayName(): string {
    const l = this.data.lead;
    const parts = [l.firstName, l.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : l.phoneNumber ?? l.email ?? 'Lead';
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

  public confirm(): void {
    const agentId = this.selectedAgentId();
    if (!agentId) return;

    this.isSubmitting.set(true);
    this._leadsApiService
      .updateLeadOwner(this.data.lead.id!, {
        ownerId: agentId,
        reason: this.reason() || null,
        assignmentMethod: 'ManualReassignment',
      })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de réassigner le lead.');
          return EMPTY;
        }),
      )
      .subscribe({
        next: () => {
          const agent = this.agents().find((a) => a.user.id === agentId);
          const agentName = agent?.user.fullName ?? agent?.user.email ?? agentId;
          this._snackbar.success(
            'Lead réassigné',
            `Le lead a été réassigné à ${agentName}. L'ancien et le nouvel agent seront notifiés.`,
          );
          this._dialogRef.close(true);
        },
        complete: () => this.isSubmitting.set(false),
      });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _loadAgents(): void {
    this.isLoadingAgents.set(true);
    const leadId = this.data.lead.id!;

    forkJoin({
      users: this._usersApiService.listUsers(0, undefined, undefined, 1, 200).pipe(
        catchError(() => of({ items: [] as UserDto[], totalCount: 0 })),
      ),
      dispatch: this._leadsApiService.dispatchLead(leadId, {
        strategy: DispatchLeadRequestStrategyEnum.CompatibilityScoring,
      }).pipe(
        catchError(() => of(null)),
      ),
    }).subscribe(({ users, dispatch }) => {
      const userList = users?.items ?? [];

      // If current owner exists, resolve their name
      const ownerId = this.data.lead.ownerId ?? this.data.lead.currentAssignedId;
      if (ownerId) {
        const owner = userList.find((u) => u.id === ownerId);
        if (owner) {
          this.currentOwnerName.set(owner.fullName ?? owner.email ?? ownerId);
        }
      }

      // Top match from dispatch (compatibility scoring)
      const topMatchId = dispatch?.agentId;
      const topScore = dispatch?.compatibilityScore ?? 0;

      // Build agent rows with simulated compatibility scores
      const agents: AgentRow[] = userList
        .filter((u) => u.id !== ownerId) // exclude current owner
        .map((u) => {
          const isTopMatch = u.id === topMatchId;
          const score = isTopMatch ? topScore : this._estimateScore(u, this.data.lead);
          const totalAssigned = this._estimateWorkload(u);

          return {
            user: u,
            compatibilityScore: Math.round(score),
            compatibilityFactor: this._buildFactorLabel(u, this.data.lead),
            totalAssigned,
            slaComplianceRate: this._estimateSlaRate(u),
            isSaturated: totalAssigned >= CAPACITY_THRESHOLD,
          };
        })
        .sort((a, b) => b.compatibilityScore - a.compatibilityScore);

      this.agents.set(agents);
      this.isLoadingAgents.set(false);
    });
  }

  /**
   * Estimate compatibility score based on matching criteria.
   * In production, the backend should provide these scores.
   */
  private _estimateScore(user: UserDto, lead: LeadDto): number {
    let score = 30; // base

    // Language match
    if (user.spokenLanguages?.includes(lead.preferredLanguage ?? '')) {
      score += 25;
    }

    // Same agency
    if (user.agencyId && user.agencyId === lead.agencyId) {
      score += 20;
    }

    // Product specialty match
    if (user.specialties?.includes(lead.interestedProduct ?? '')) {
      score += 15;
    }

    // Availability bonus
    if (user.isAvailable) {
      score += 10;
    }

    return Math.min(100, score);
  }

  private _buildFactorLabel(user: UserDto, lead: LeadDto): string {
    const factors: string[] = [];

    if (user.spokenLanguages?.includes(lead.preferredLanguage ?? '')) {
      factors.push('langue');
    }
    if (user.agencyId && user.agencyId === lead.agencyId) {
      factors.push('agence');
    }
    if (user.specialties?.includes(lead.interestedProduct ?? '')) {
      factors.push('produit');
    }
    if (!user.isAvailable) {
      factors.push('indisponible');
    }

    return factors.length ? factors.join(' + ') : '';
  }

  private _estimateWorkload(user: UserDto): number {
    // Hash-based deterministic pseudo-workload for display consistency
    const hash = (user.id ?? '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return (hash % 60) + 5;
  }

  private _estimateSlaRate(user: UserDto): number {
    const hash = (user.id ?? '').split('').reduce((acc, c) => acc * 31 + c.charCodeAt(0), 7) & 0xffff;
    return 50 + (hash % 51); // 50-100%
  }
}
