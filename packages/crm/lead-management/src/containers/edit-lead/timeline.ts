import { Component, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { LeadsApiService, TimelineEvent, TimelineEventKindEnum } from '@sankore/crm-api';

function kindMeta(kind: TimelineEventKindEnum | undefined): { icon: string; color: string; label: string } {
  switch (kind) {
    case TimelineEventKindEnum.Activity:           return { icon: 'feather:message-circle', color: 'bg-blue-100 text-blue-600',   label: 'Activité' };
    case TimelineEventKindEnum.ScoreChange:        return { icon: 'feather:trending-up',    color: 'bg-purple-100 text-purple-600', label: 'Score' };
    case TimelineEventKindEnum.Assignment:         return { icon: 'feather:user-check',     color: 'bg-teal-100 text-teal-600',    label: 'Assignation' };
    case TimelineEventKindEnum.Reminder:           return { icon: 'feather:bell',           color: 'bg-amber-100 text-amber-600',  label: 'Rappel' };
    case TimelineEventKindEnum.Merge:              return { icon: 'feather:git-merge',      color: 'bg-indigo-100 text-indigo-600', label: 'Fusion' };
    case TimelineEventKindEnum.DuplicateDismissed: return { icon: 'feather:x-circle',       color: 'bg-slate-100 text-slate-600',  label: 'Doublon écarté' };
    case TimelineEventKindEnum.Consent:            return { icon: 'feather:shield',         color: 'bg-green-100 text-green-600',  label: 'Consentement' };
    case TimelineEventKindEnum.Qualification:      return { icon: 'feather:clipboard',      color: 'bg-orange-100 text-orange-600', label: 'Qualification' };
    default:                                       return { icon: 'feather:circle',         color: 'bg-slate-100 text-slate-500',  label: 'Événement' };
  }
}

@Component({
  selector: 'lead-timeline',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, TimeagoPipe],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6">
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="font-semibold text-slate-800">Timeline</p>
            <p class="text-sm text-slate-500 mt-0.5">Historique chronologique de toutes les actions sur ce lead</p>
          </div>

          @if (events().length === 0) {
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <tas-icon iconName="feather:clock" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
              <p class="text-sm text-slate-400">Aucun événement enregistré</p>
            </div>
          } @else {
            <div class="p-4">
              <div class="relative">
                <!-- Vertical line -->
                <div class="absolute left-4 top-0 bottom-0 w-px bg-slate-200"></div>

                <div class="flex flex-col gap-0">
                  @for (event of events(); track $index) {
                    <div class="relative flex gap-3 py-3">
                      <!-- Dot -->
                      <div
                        class="relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        [class]="kindMeta(event.kind).color"
                      >
                        <tas-icon [iconName]="kindMeta(event.kind).icon" style="font-size:12px"></tas-icon>
                      </div>
                      <!-- Content -->
                      <div class="flex-1 min-w-0 pt-1">
                        <div class="flex items-center gap-2 mb-0.5">
                          <p class="text-sm font-medium text-slate-800 truncate">{{ event.title ?? kindMeta(event.kind).label }}</p>
                          <tas-tag severity="neutral" class="shrink-0">{{ kindMeta(event.kind).label }}</tas-tag>
                        </div>
                        @if (event.detail) {
                          <p class="text-xs text-slate-500 mt-0.5">{{ event.detail }}</p>
                        }
                        @if (event.occurredAt) {
                          <p class="text-xs text-slate-400 mt-1">{{ event.occurredAt | dateTimeAgo }}</p>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>
          }
        </tas-card>
      </div>
    }
  `,
})
export class LeadTimelinePage {
  private readonly _leadsApiService = inject(LeadsApiService);

  public readonly id = input.required<string>();
  public readonly kindMeta = kindMeta;

  public isLoading = signal(true);
  public events = signal<TimelineEvent[]>([]);

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._leadsApiService.getLeadTimeline(this.id()).pipe(
        catchError(() => {
          this.isLoading.set(false);
          return EMPTY;
        }),
      ).subscribe((events) => {
        this.events.set(events ?? []);
        this.isLoading.set(false);
      });
    });
  }
}

export default LeadTimelinePage;
