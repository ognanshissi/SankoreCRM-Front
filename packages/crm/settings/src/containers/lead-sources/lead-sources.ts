import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, Observable } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import {
  LeadSourcesApiService,
  LeadSourceListDto,
} from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService } from '@sankore/crm/common';
import { LeadSourcesService } from './lead-sources.service';
import { LeadSourceMetadataService } from './lead-source-metadata.service';
import {
  channelLabel, modeLabel, statusLabel, statusSeverity,
  healthIcon, healthColor, healthTooltip, channelIcon,
  channelTypeToNumeric, modeToNumeric, statusToNumeric,
} from './lead-source.types';
import { TimeagoPipe } from '@talisoft/ui/timeago';

@Component({
  selector: 'lead-sources-config',
  imports: [
    FormsModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    TimeagoPipe,
    DecimalPipe,
    Menu, MenuItem, TasMenuTrigger,
  ],
  template: `
    <ng-container>
      @if (isLoading()) {
        <div class="flex justify-center py-24">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      } @else {
        <div class="pb-6">
          <!-- Header -->
          <div class="flex items-start justify-between mb-6">
            <div>
              <h1 class="text-lg font-semibold text-slate-800">
                Sources & Campagnes
              </h1>
              <p class="text-sm text-slate-500 mt-0.5">
                Gérez les sources d'acquisition et campagnes de leads.
              </p>
            </div>
              <button
                tas-outlined-button
                type="button"
                (click)="navigateToQuality()"
              >
                <tas-icon
                  iconName="feather:bar-chart-2"
                  style="font-size:14px"
                ></tas-icon>
                Qualité
              </button>
              <button
                tas-raised-button
                color="primary"
                type="button"
                (click)="navigateToCreate()"
              >
                <tas-icon
                  iconName="feather:plus"
                  style="font-size:14px"
                ></tas-icon>
                Ajouter une source
              </button>
          </div>

          <!-- Filters -->
          <tas-card class="mb-4 block">
            <div class="p-4">
              <div class="grid grid-cols-4 gap-3">
                <tas-form-field>
                  <tas-label>Rechercher</tas-label>
                  <input
                    tasInput
                    type="text"
                    placeholder="Nom ou code..."
                    [ngModel]="filterQuery()"
                    (ngModelChange)="onFilterChange('q', $event)"
                  />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Canal</tas-label>
                  <tas-select
                    [options]="metadataService.channelOptions()"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Tous les canaux"
                    [ngModel]="filterChannel()"
                    (ngModelChange)="onFilterChange('channel', $event)"
                  ></tas-select>
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Mode</tas-label>
                  <tas-select
                    [options]="metadataService.modeOptions()"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Tous les modes"
                    [ngModel]="filterMode()"
                    (ngModelChange)="onFilterChange('mode', $event)"
                  ></tas-select>
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Statut</tas-label>
                  <tas-select
                    [options]="metadataService.statusOptions()"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Tous les statuts"
                    [ngModel]="filterStatus()"
                    (ngModelChange)="onFilterChange('status', $event)"
                  ></tas-select>
                </tas-form-field>
              </div>
            </div>
          </tas-card>

          <!-- Sources list -->
          <tas-card class="block">
            <div
              class="p-4 border-b border-slate-100 flex items-center justify-between"
            >
              <p class="text-sm font-semibold text-slate-700">
                Sources existantes
              </p>
              <span class="text-xs text-slate-400"
                >{{ totalCount() }} source(s)</span
              >
            </div>

            @if (sources().length === 0) {
              <div
                class="flex flex-col items-center justify-center py-16 text-center"
              >
                <tas-icon
                  iconName="feather:globe"
                  class="text-slate-300 mb-3"
                  style="font-size:32px"
                ></tas-icon>
                <p class="text-sm font-medium text-slate-500 mb-1">
                  Aucune source configurée
                </p>
                <p class="text-xs text-slate-400 mb-4">
                  Ajoutez votre première source pour commencer à capturer des
                  leads.
                </p>
                @if (canWrite()) {
                  <button
                    tas-button
                    color="primary"
                    type="button"
                    (click)="navigateToCreate()"
                  >
                    <tas-icon
                      iconName="feather:plus"
                      style="font-size:14px"
                    ></tas-icon>
                    Ajouter une source
                  </button>
                }
              </div>
            } @else {
              <!-- Table header -->
              <div class="flex items-center px-4 py-2 bg-slate-50 text-xs font-medium text-slate-500 border-b border-slate-100">
                <div class="w-[22%]">Source</div>
                <div class="w-[13%]">Canal</div>
                <div class="w-[13%]">Mode</div>
                <div class="w-[10%] text-center">Statut</div>
                <div class="w-[6%] text-center">Santé</div>
                <div class="w-[6%] text-right">7j</div>
                <div class="w-[10%] text-right">Coût/lead</div>
                <div class="w-[10%] text-right">Dernier lead</div>
                <div class="w-[10%] text-right">Actions</div>
              </div>

              <!-- Rows -->
              <div class="divide-y divide-slate-100">
                @for (src of sources(); track src.id) {
                  <div class="flex items-center px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                       [class.opacity-50]="src.status === 'Archived'"
                       (click)="openSource(src.id!)">
                    <!-- Name + code + badges -->
                    <div class="w-[22%] min-w-0">
                      <div class="flex items-center gap-2">
                        <tas-icon [iconName]="getChannelIcon(src.channelType)"
                                  class="text-slate-400 shrink-0" style="font-size:14px"></tas-icon>
                        <p class="text-sm font-medium text-slate-800 truncate">{{ src.label }}</p>
                      </div>
                      <div class="flex items-center gap-1.5 mt-0.5">
                        <span class="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded">
                          {{ src.code }}
                        </span>
                        @if (src.isSystem) {
                          <tas-tag severity="neutral">Système</tas-tag>
                        }
                      </div>
                    </div>

                    <!-- Channel -->
                    <div class="w-[13%]">
                      <span class="text-xs text-slate-600">{{ getChannelLabel(src.channelType) }}</span>
                    </div>

                    <!-- Mode -->
                    <div class="w-[13%]">
                      <span class="text-xs text-slate-600">{{ getModeLabel(src.mode) }}</span>
                    </div>

                    <!-- Status -->
                    <div class="w-[10%] text-center">
                      <tas-tag [severity]="getStatusSeverity(src.status)">
                        {{ getStatusLabel(src.status) }}
                      </tas-tag>
                    </div>

                    <!-- Health -->
                    <div class="w-[6%] text-center" [title]="getHealthTooltip(src.health)">
                      <tas-icon [iconName]="getHealthIcon(src.health)"
                                [class]="getHealthColor(src.health)"
                                style="font-size:14px"></tas-icon>
                    </div>

                    <!-- Volume 7d -->
                    <div class="w-[6%] text-right">
                      <span class="text-xs text-slate-700 font-medium">{{ src.volume7Days ?? 0 }}</span>
                    </div>

                    <!-- Cost per lead -->
                    <div class="w-[10%] text-right">
                      @if (src.costPerLead?.amount) {
                        <span class="text-xs text-slate-700">
                          {{ (src.costPerLead?.amount ?? 0) | number: '1.0-0' }}
                          {{ src.costPerLead?.currency ?? 'XOF' }}
                        </span>
                      } @else {
                        <span class="text-xs text-slate-400">—</span>
                      }
                    </div>

                    <!-- Last received -->
                    <div class="w-[10%] text-right">
                      @if (src.lastReceivedAt) {
                        <span class="text-xs text-slate-500">{{ src.lastReceivedAt | dateTimeAgo }}</span>
                      } @else {
                        <span class="text-xs text-slate-400">—</span>
                      }
                    </div>

                    <!-- Actions (FE-09) -->
                    <div class="w-[10%] flex justify-end" (click)="$event.stopPropagation()">
                      @if (!src.isSystem && canWrite()) {
                        @if (actionInProgress() === src.id) {
                          <tas-spinner size="3"></tas-spinner>
                        } @else {
                          <button tas-button iconButton TasMenuTrigger [panel]="actionMenu">
                            <tas-icon iconName="feather:more-vertical" style="font-size:14px"></tas-icon>
                          </button>
                          <ng-template #actionMenu>
                            <tas-menu>
                              @if (src.status === 'Draft' || src.status === 'Testing' || src.status === 'Paused') {
                                <tas-menu-item (click)="activateSource(src)">
                                  <tas-icon iconName="feather:play" style="font-size:12px" class="text-green-500"></tas-icon>
                                  Activer
                                </tas-menu-item>
                              }
                              @if (src.status === 'Active') {
                                <tas-menu-item (click)="pauseSource(src)">
                                  <tas-icon iconName="feather:pause" style="font-size:12px" class="text-amber-500"></tas-icon>
                                  Mettre en pause
                                </tas-menu-item>
                              }
                              @if (src.status === 'Error') {
                                <tas-menu-item (click)="activateSource(src)">
                                  <tas-icon iconName="feather:refresh-cw" style="font-size:12px" class="text-blue-500"></tas-icon>
                                  Réessayer
                                </tas-menu-item>
                              }
                              @if (src.status !== 'Archived') {
                                <tas-menu-item (click)="archiveSource(src)">
                                  <tas-icon iconName="feather:archive" style="font-size:12px" class="text-slate-400"></tas-icon>
                                  Archiver
                                </tas-menu-item>
                              }
                            </tas-menu>
                          </ng-template>
                        }
                      }
                    </div>
                  </div>
                }
              </div>

              <!-- Pagination -->
              @if (hasMore()) {
                <div class="p-4 border-t border-slate-100 flex justify-center">
                  <button
                    tas-outlined-button
                    type="button"
                    (click)="loadMore()"
                  >
                    Charger plus
                  </button>
                </div>
              }
            }
          </tas-card>
        </div>
      }
    </ng-container>
  `,
})
export class LeadSourcesConfig implements OnInit {
  private readonly _api = inject(LeadSourcesApiService);
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  public readonly metadataService = inject(LeadSourceMetadataService);

  // Permissions (FE-03)
  public readonly canWrite = computed(() => {
    const perms = this._auth.connectedUser()?.permissions ?? [];
    return perms.includes('lead:source:manage');
  });

  // Lifecycle action in progress (FE-09)
  public actionInProgress = signal<string | null>(null);

  // State
  public isLoading = signal(true);
  public sources = signal<LeadSourceListDto[]>([]);
  public totalCount = signal(0);

  // Filters (preserved in URL)
  public filterQuery = signal('');
  public filterChannel = signal<string | null>(null);
  public filterMode = signal<string | null>(null);
  public filterStatus = signal<string | null>(null);

  // Pagination
  private _page = 1;
  private readonly _pageSize = 25;
  public hasMore = signal(false);

  // Label helpers bound to template
  public getChannelLabel = channelLabel;
  public getChannelIcon = channelIcon;
  public getModeLabel = modeLabel;
  public getStatusLabel = statusLabel;
  public getStatusSeverity = statusSeverity;
  public getHealthIcon = healthIcon;
  public getHealthColor = healthColor;
  public getHealthTooltip = healthTooltip;

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Sources & Campagnes' },
    ]);

    // Load metadata cache
    this.metadataService.load();

    // Restore filters from URL
    const params = this._route.snapshot.queryParams;
    if (params['q']) this.filterQuery.set(params['q']);
    if (params['channel']) this.filterChannel.set(params['channel']);
    if (params['mode']) this.filterMode.set(params['mode']);
    if (params['status']) this.filterStatus.set(params['status']);

    this._load(true);
  }

  public onFilterChange(key: string, value: string | null): void {
    switch (key) {
      case 'q':
        this.filterQuery.set(value ?? '');
        break;
      case 'channel':
        this.filterChannel.set(value);
        break;
      case 'mode':
        this.filterMode.set(value);
        break;
      case 'status':
        this.filterStatus.set(value);
        break;
    }

    // Persist filters in URL
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.filterQuery() || null,
        channel: this.filterChannel() || null,
        mode: this.filterMode() || null,
        status: this.filterStatus() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    this._page = 1;
    this._load(true);
  }

  public loadMore(): void {
    this._page++;
    this._load(false);
  }

  public navigateToCreate(): void {
    this._router.navigate(['/settings/lead-sources/create']);
  }

  public navigateToQuality(): void {
    this._router.navigate(['/settings/lead-sources/quality']);
  }

  public openSource(id: string): void {
    this._router.navigate(['/settings/lead-sources', id]);
  }

  private _load(reset: boolean): void {
    if (reset) this.isLoading.set(true);

    this._api
      .listLeadSources(
        channelTypeToNumeric(this.filterChannel()) as any,
        modeToNumeric(this.filterMode()) as any,
        statusToNumeric(this.filterStatus()) as any,
        this.filterQuery() || undefined,
        this._page,
        this._pageSize,
      )
      .pipe(
        catchError(() => {
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        const items = result.items ?? [];
        if (reset) {
          this.sources.set(items);
        } else {
          this.sources.update((prev) => [...prev, ...items]);
        }
        this.totalCount.set(result.totalCount ?? 0);
        this.hasMore.set(result.hasNextPage ?? false);
        this.isLoading.set(false);
      });
  }

  // ——— FE-09: Lifecycle actions ———

  public activateSource(src: LeadSourceListDto): void {
    this._confirm.confirm({
      title: 'Activer cette source ?',
      message: `La source « ${src.label} » commencera à recevoir et créer des leads réels.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Activer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._doAction(src.id!, this._sourcesService.activate(src.id!), 'Activée', 'Active'),
    });
  }

  public pauseSource(src: LeadSourceListDto): void {
    const modeEffects: Record<string, string> = {
      EmbeddedScript: 'Les soumissions du formulaire seront refusées.',
      ServerWebhook: 'Le fournisseur recevra une réponse 403.',
      ScheduledPull: 'Les exécutions planifiées seront arrêtées.',
    };
    const effect = modeEffects[src.mode ?? ''] ?? 'Aucun lead ne sera créé tant que la source est en pause.';

    this._confirm.confirm({
      title: 'Mettre en pause ?',
      message: `La source « ${src.label} » sera suspendue. ${effect}`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Mettre en pause', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._doAction(src.id!, this._sourcesService.pause(src.id!), 'En pause', 'Paused'),
    });
  }

  public archiveSource(src: LeadSourceListDto): void {
    this._confirm.confirm({
      title: 'Archiver cette source ?',
      message: `La source « ${src.label} » sera archivée. Les leads existants restent consultables. Cette action est irréversible.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Archiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._doAction(src.id!, this._sourcesService.archive(src.id!), 'Archivée', 'Archived'),
    });
  }

  private _doAction(id: string, obs: Observable<any>, successLabel: string, newStatus: string): void {
    this.actionInProgress.set(id);
    obs.pipe(
      catchError(() => {
        // Error already handled by LeadSourcesService (snackbar for 400/403/409/other)
        this.actionInProgress.set(null);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.sources.update((list) =>
        list.map((s) => s.id === id ? { ...s, status: newStatus as any } : s),
      );
      this._snackbar.success('Succès', `Source ${successLabel.toLowerCase()}.`);
      this.actionInProgress.set(null);
    });
  }
}

export default LeadSourcesConfig;
