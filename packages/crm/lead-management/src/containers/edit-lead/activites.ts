import { Component, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { Button } from '@talisoft/ui/button';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { LeadsApiService, ActivityDto, ActivityDtoTypeEnum } from '@sankore/crm-api';
import { LogActivityDrawer } from './log-activity-drawer';

function activityTypeMeta(type: ActivityDtoTypeEnum | undefined): { icon: string; label: string; severity: Severity } {
  switch (type) {
    case ActivityDtoTypeEnum.Call:     return { icon: 'feather:phone',        label: 'Appel',     severity: 'info' };
    case ActivityDtoTypeEnum.Meeting:  return { icon: 'feather:users',        label: 'Réunion',   severity: 'warning' };
    case ActivityDtoTypeEnum.Email:    return { icon: 'feather:mail',         label: 'E-mail',    severity: 'info' };
    case ActivityDtoTypeEnum.Visit:    return { icon: 'feather:map-pin',      label: 'Visite',    severity: 'success' };
    case ActivityDtoTypeEnum.Note:     return { icon: 'feather:file-text',    label: 'Note',      severity: 'neutral' };
    case ActivityDtoTypeEnum.Sms:      return { icon: 'feather:message-square', label: 'SMS',     severity: 'info' };
    case ActivityDtoTypeEnum.WhatsApp: return { icon: 'feather:message-circle', label: 'WhatsApp', severity: 'success' };
    case ActivityDtoTypeEnum.Task:     return { icon: 'feather:check-square', label: 'Tâche',     severity: 'warning' };
    default:                           return { icon: 'feather:circle',       label: 'Autre',     severity: 'neutral' };
  }
}

@Component({
  selector: 'lead-activites',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, TimeagoPipe, Button],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6">
        <tas-card>
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p class="font-semibold text-slate-800">Activités</p>
              <p class="text-sm text-slate-500 mt-0.5">Interactions enregistrées avec ce lead</p>
            </div>
            <div class="flex items-center gap-2">
              @if (activities().length > 0) {
                <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium tabular-nums">
                  {{ activities().length }}
                </span>
              }
              <button
                tas-raised-button
                color="primary"
                type="button"
                class="text-xs"
                (click)="openLogActivityDrawer()"
              >
                <tas-icon iconName="feather:plus" style="font-size:12px"></tas-icon>
                Enregistrer
              </button>
            </div>
          </div>

          @if (activities().length === 0) {
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <tas-icon iconName="feather:activity" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
              <p class="text-sm text-slate-400">Aucune activité enregistrée</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (activity of activities(); track activity.id) {
                <div class="p-4 hover:bg-slate-50 transition-colors">
                  <div class="flex items-start gap-3">
                    <div
                      class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      [class]="typeColor(activity.type)"
                    >
                      <tas-icon [iconName]="typeMeta(activity.type).icon" style="font-size:14px"></tas-icon>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-0.5">
                        @if (activity.subject) {
                          <p class="text-sm font-medium text-slate-800 truncate">{{ activity.subject }}</p>
                        }
                        <tas-tag [severity]="typeMeta(activity.type).severity">
                          {{ typeMeta(activity.type).label }}
                        </tas-tag>
                      </div>
                      @if (activity.notes) {
                        <p class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ activity.notes }}</p>
                      }
                      <div class="flex items-center gap-3 mt-2">
                        @if (activity.performedAt) {
                          <span class="text-xs text-slate-400">{{ activity.performedAt | dateTimeAgo }}</span>
                        }
                        @if (activity.durationMinutes) {
                          <span class="text-xs text-slate-400 flex items-center gap-1">
                            <tas-icon iconName="feather:clock" style="font-size:10px"></tas-icon>
                            {{ activity.durationMinutes }} min
                          </span>
                        }
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>

            @if (hasMore()) {
              <div class="p-3 border-t border-slate-100 text-center">
                <button
                  tas-text-button
                  type="button"
                  (click)="loadMore()"
                  [disabled]="isLoadingMore()"
                >
                  @if (isLoadingMore()) {
                    <tas-spinner size="3" class="text-primary"></tas-spinner>
                  }
                  Charger plus
                </button>
              </div>
            }
          }
        </tas-card>
      </div>
    }
  `,
})
export class LeadActivitesPage {
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _sideDrawer = inject(SideDrawerService);

  public readonly id = input.required<string>();
  public readonly typeMeta = activityTypeMeta;

  public isLoading = signal(true);
  public isLoadingMore = signal(false);
  public activities = signal<ActivityDto[]>([]);
  public hasMore = signal(false);
  private _skip = 0;
  private readonly _limit = 20;

  constructor() {
    effect(() => {
      this._skip = 0;
      this.isLoading.set(true);
      this._leadsApiService.listLeadActivities(this.id(), 0, this._limit).pipe(
        catchError(() => {
          this.isLoading.set(false);
          return EMPTY;
        }),
      ).subscribe((activities) => {
        this.activities.set(activities ?? []);
        this._skip = (activities ?? []).length;
        this.hasMore.set((activities ?? []).length >= this._limit);
        this.isLoading.set(false);
      });
    });
  }

  public openLogActivityDrawer(): void {
    const ref = this._sideDrawer.open(LogActivityDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { leadId: this.id(), leadName: 'Lead' },
    });

    ref.closed.subscribe((result: any) => {
      if (result && typeof result === 'object' && 'activity' in result) {
        // Optimistic insert at the top
        if (result.activity) {
          this.activities.update((list) => [result.activity, ...list]);

        }
      }
    });
  }

  public loadMore(): void {
    this.isLoadingMore.set(true);
    this._leadsApiService.listLeadActivities(this.id(), this._skip, this._limit).pipe(
      catchError(() => {
        this.isLoadingMore.set(false);
        return EMPTY;
      }),
    ).subscribe((more) => {
      const items = more ?? [];
      this.activities.update((prev) => [...prev, ...items]);
      this._skip += items.length;
      this.hasMore.set(items.length >= this._limit);
      this.isLoadingMore.set(false);
    });
  }

  public typeColor(type: ActivityDtoTypeEnum | undefined): string {
    switch (type) {
      case ActivityDtoTypeEnum.Call:     return 'bg-blue-100 text-blue-600';
      case ActivityDtoTypeEnum.Meeting:  return 'bg-amber-100 text-amber-600';
      case ActivityDtoTypeEnum.Email:    return 'bg-indigo-100 text-indigo-600';
      case ActivityDtoTypeEnum.Visit:    return 'bg-green-100 text-green-600';
      case ActivityDtoTypeEnum.Note:     return 'bg-slate-100 text-slate-600';
      case ActivityDtoTypeEnum.Sms:      return 'bg-cyan-100 text-cyan-600';
      case ActivityDtoTypeEnum.WhatsApp: return 'bg-emerald-100 text-emerald-600';
      case ActivityDtoTypeEnum.Task:     return 'bg-orange-100 text-orange-600';
      default:                           return 'bg-slate-100 text-slate-500';
    }
  }
}

export default LeadActivitesPage;
