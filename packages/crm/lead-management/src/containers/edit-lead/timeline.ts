import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { Button } from '@talisoft/ui/button';
import { LeadsApiService, TimelineEvent, TimelineEventKindEnum, AssignmentDto, OwnerAssignmentDto } from '@sankore/crm-api';

const PAGE_SIZE = 20;

interface KindMeta {
  icon: string;
  color: string;
  label: string;
}

const KIND_META: Record<string, KindMeta> = {
  [TimelineEventKindEnum.Activity]:           { icon: 'feather:message-circle', color: 'bg-blue-100 text-blue-600',    label: 'Activité' },
  [TimelineEventKindEnum.ScoreChange]:        { icon: 'feather:trending-up',    color: 'bg-purple-100 text-purple-600', label: 'Score' },
  [TimelineEventKindEnum.Assignment]:         { icon: 'feather:user-check',     color: 'bg-teal-100 text-teal-600',    label: 'Assignation' },
  [TimelineEventKindEnum.Reminder]:           { icon: 'feather:bell',           color: 'bg-amber-100 text-amber-600',  label: 'Rappel' },
  [TimelineEventKindEnum.Merge]:              { icon: 'feather:git-merge',      color: 'bg-indigo-100 text-indigo-600', label: 'Fusion' },
  [TimelineEventKindEnum.DuplicateDismissed]: { icon: 'feather:x-circle',       color: 'bg-slate-100 text-slate-600',  label: 'Doublon écarté' },
  [TimelineEventKindEnum.Consent]:            { icon: 'feather:shield',         color: 'bg-green-100 text-green-600',  label: 'Consentement' },
  [TimelineEventKindEnum.Qualification]:      { icon: 'feather:clipboard',      color: 'bg-orange-100 text-orange-600', label: 'Qualification' },
};

const DEFAULT_META: KindMeta = { icon: 'feather:circle', color: 'bg-slate-100 text-slate-500', label: 'Événement' };

function getKindMeta(kind: TimelineEventKindEnum | string | undefined): KindMeta {
  if (!kind) return DEFAULT_META;
  return KIND_META[kind] ?? DEFAULT_META;
}

/** All filter options shown to the user */
const FILTER_OPTIONS: { kind: TimelineEventKindEnum; label: string }[] = [
  { kind: TimelineEventKindEnum.Activity,           label: 'Activités' },
  { kind: TimelineEventKindEnum.ScoreChange,        label: 'Score' },
  { kind: TimelineEventKindEnum.Assignment,         label: 'Assignations' },
  { kind: TimelineEventKindEnum.Reminder,           label: 'Rappels' },
  { kind: TimelineEventKindEnum.Qualification,      label: 'Qualification' },
  { kind: TimelineEventKindEnum.Consent,            label: 'Consentement' },
  { kind: TimelineEventKindEnum.Merge,              label: 'Fusions' },
  { kind: TimelineEventKindEnum.DuplicateDismissed, label: 'Doublons écartés' },
];

@Component({
  selector: 'lead-timeline',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, TimeagoPipe, Button],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6">
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <div class="flex items-center justify-between mb-1">
              <p class="font-semibold text-slate-800">Timeline</p>
              <span class="text-xs text-slate-400 tabular-nums">
                {{ filteredEvents().length }} événement{{ filteredEvents().length > 1 ? 's' : '' }}
              </span>
            </div>
            <p class="text-sm text-slate-500">Historique chronologique de toutes les actions sur ce lead</p>

            <!-- Filters -->
            <div class="flex items-center gap-1.5 mt-3 flex-wrap">
              <button
                type="button"
                class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                [class]="activeFilters().size === 0
                  ? 'bg-primary/15 text-primary'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                (click)="clearFilters()"
              >
                Tous
              </button>
              @for (opt of filterOptions; track opt.kind) {
                <button
                  type="button"
                  class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1"
                  [class]="activeFilters().has(opt.kind)
                    ? 'bg-primary/15 text-primary'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
                  (click)="toggleFilter(opt.kind)"
                >
                  <span
                    class="w-1.5 h-1.5 rounded-full shrink-0"
                    [class]="getKindMeta(opt.kind).color.split(' ')[0]"
                  ></span>
                  {{ opt.label }}
                </button>
              }
            </div>
          </div>

          @if (filteredEvents().length === 0) {
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <tas-icon iconName="feather:clock" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
              @if (allEvents().length > 0) {
                <p class="text-sm text-slate-400">Aucun événement ne correspond aux filtres sélectionnés</p>
                <button
                  type="button"
                  class="text-xs text-primary mt-2 hover:underline"
                  (click)="clearFilters()"
                >
                  Effacer les filtres
                </button>
              } @else {
                <p class="text-sm text-slate-400">Aucun événement enregistré</p>
              }
            </div>
          } @else {
            <div class="p-4">
              <div class="relative">
                <!-- Vertical line -->
                <div class="absolute left-4 top-0 bottom-0 w-px bg-slate-200"></div>

                <div class="flex flex-col gap-0">
                  @for (event of visibleEvents(); track trackEvent($index, event)) {
                    <div class="relative flex gap-3 py-3">
                      <!-- Dot -->
                      <div
                        class="relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        [class]="getKindMeta(event.kind).color"
                      >
                        <tas-icon [iconName]="getKindMeta(event.kind).icon" style="font-size:12px"></tas-icon>
                      </div>
                      <!-- Content — polymorphic rendering by kind -->
                      <div class="flex-1 min-w-0 pt-1">
                        <div class="flex items-center gap-2 mb-0.5">
                          <p class="text-sm font-medium text-slate-800 truncate">
                            {{ event.title ?? getKindMeta(event.kind).label }}
                          </p>
                          <tas-tag severity="neutral" class="shrink-0">
                            {{ getKindMeta(event.kind).label }}
                          </tas-tag>
                        </div>
                        <!-- Detail: shown only if present (restricted entities have null detail) -->
                        @if (event.detail) {
                          <p class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ event.detail }}</p>
                        } @else if (!event.title) {
                          <p class="text-xs text-slate-400 italic mt-0.5">Détail non disponible</p>
                        }
                        <!-- Kind-specific rendering -->
                        @switch (event.kind) {
                          @case ('ScoreChange') {
                            @if (event.detail) {
                              @let parts = parseScoreDelta(event.detail);
                              @if (parts) {
                                <div class="flex items-center gap-2 mt-1">
                                  <span
                                    class="text-xs font-semibold tabular-nums"
                                    [class]="parts.delta >= 0 ? 'text-green-600' : 'text-red-600'"
                                  >
                                    {{ parts.delta >= 0 ? '+' : '' }}{{ parts.delta }}
                                  </span>
                                  <span class="text-xs text-slate-400">→ {{ parts.newScore }}</span>
                                </div>
                              }
                            }
                          }
                          @case ('Assignment') {
                            @if (event.actorId) {
                              <p class="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                <tas-icon iconName="feather:user" style="font-size:10px"></tas-icon>
                                Par {{ event.actorId }}
                              </p>
                            }
                          }
                          @default {}
                        }
                        @if (event.occurredAt) {
                          <p class="text-xs text-slate-400 mt-1">{{ event.occurredAt | dateTimeAgo }}</p>
                        }
                      </div>
                    </div>
                  }
                </div>

                <!-- Infinite scroll sentinel -->
                @if (hasMore()) {
                  <div #scrollSentinel class="flex justify-center py-4">
                    @if (isLoadingMore()) {
                      <tas-spinner size="5" class="text-primary"></tas-spinner>
                    } @else {
                      <button
                        type="button"
                        class="text-xs text-primary hover:underline"
                        (click)="loadMore()"
                      >
                        Charger plus d'événements
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
          }
        </tas-card>

        <!-- Assignment & Owner History -->
        @if (assignments().length > 0 || ownerHistory().length > 0) {
          <div class="mt-4">
            <button type="button" class="text-xs text-primary hover:underline mb-2 flex items-center gap-1"
              (click)="showHistory.set(!showHistory())">
              <tas-icon [iconName]="showHistory() ? 'feather:chevron-up' : 'feather:chevron-down'" style="font-size:12px"></tas-icon>
              {{ showHistory() ? 'Masquer' : 'Afficher' }} l'historique d'assignation ({{ assignments().length + ownerHistory().length }})
            </button>
            @if (showHistory()) {
              @if (ownerHistory().length > 0) {
                <tas-card class="block mb-3">
                  <div class="p-3 border-b border-slate-100">
                    <p class="text-xs font-semibold text-slate-600">Changements de propriétaire</p>
                  </div>
                  <div class="divide-y divide-slate-100">
                    @for (o of ownerHistory(); track o.id) {
                      <div class="px-3 py-2 flex items-center gap-2 text-xs">
                        <tas-icon iconName="feather:arrow-right" class="text-slate-400" style="font-size:10px"></tas-icon>
                        <span class="text-slate-500">{{ o.previousOwnerId ?? '—' }}</span>
                        <tas-icon iconName="feather:arrow-right" class="text-slate-300" style="font-size:8px"></tas-icon>
                        <span class="font-medium text-slate-800">{{ o.newOwnerId }}</span>
                        @if (o.assignmentMethod) { <tas-tag severity="neutral">{{ o.assignmentMethod }}</tas-tag> }
                        @if (o.reason) { <span class="text-slate-400">— {{ o.reason }}</span> }
                        @if (o.assignedAt) { <span class="text-slate-400 ml-auto">{{ o.assignedAt | dateTimeAgo }}</span> }
                      </div>
                    }
                  </div>
                </tas-card>
              }
              @if (assignments().length > 0) {
                <tas-card class="block">
                  <div class="p-3 border-b border-slate-100">
                    <p class="text-xs font-semibold text-slate-600">Historique d'assignation</p>
                  </div>
                  <div class="divide-y divide-slate-100">
                    @for (a of assignments(); track a.id) {
                      <div class="px-3 py-2 flex items-center gap-3 text-xs">
                        <span class="font-medium text-slate-800">{{ a.agentId }}</span>
                        <tas-tag severity="info">{{ a.strategy }}</tas-tag>
                        @if (a.compatibilityScore) { <span class="tabular-nums text-slate-500">Score {{ a.compatibilityScore }}</span> }
                        @if (a.slaBreached) { <tas-tag severity="error">SLA dépassé</tas-tag> }
                        @if (a.wasManualOverride) { <tas-tag severity="warning">Manuel</tas-tag> }
                        @if (a.createdAt) { <span class="text-slate-400 ml-auto">{{ a.createdAt | dateTimeAgo }}</span> }
                      </div>
                    }
                  </div>
                </tas-card>
              }
            }
          </div>
        }
      </div>
    }
  `,
})
export class LeadTimelinePage implements AfterViewInit, OnDestroy {
  private readonly _leadsApiService = inject(LeadsApiService);

  public readonly id = input.required<string>();
  public readonly filterOptions = FILTER_OPTIONS;
  public readonly getKindMeta = getKindMeta;

  public isLoading = signal(true);
  public isLoadingMore = signal(false);

  /** All events fetched from API */
  public allEvents = signal<TimelineEvent[]>([]);
  public assignments = signal<AssignmentDto[]>([]);
  public ownerHistory = signal<OwnerAssignmentDto[]>([]);
  public showHistory = signal(false);

  /** Active kind filters — empty = show all */
  public activeFilters = signal<Set<TimelineEventKindEnum>>(new Set());

  /** Cursor: how many filtered events to show */
  public cursor = signal(PAGE_SIZE);

  private _observer: IntersectionObserver | null = null;
  private readonly _scrollSentinel = viewChild<ElementRef>('scrollSentinel');

  /** Events filtered by active kinds, sorted newest-first */
  public readonly filteredEvents = computed(() => {
    const all = this.allEvents();
    const filters = this.activeFilters();

    const filtered = filters.size === 0
      ? all
      : all.filter((e) => e.kind && filters.has(e.kind));

    return filtered.sort((a, b) => {
      const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
      return tb - ta;
    });
  });

  /** Slice of filtered events up to cursor */
  public readonly visibleEvents = computed(() =>
    this.filteredEvents().slice(0, this.cursor()),
  );

  public readonly hasMore = computed(() =>
    this.cursor() < this.filteredEvents().length,
  );

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this.cursor.set(PAGE_SIZE);
      this._leadsApiService.getLeadTimeline(this.id()).pipe(
        catchError(() => {
          this.isLoading.set(false);
          return EMPTY;
        }),
      ).subscribe((events) => {
        this.allEvents.set(events ?? []);
        this.isLoading.set(false);
      });
      // Load assignment & owner history
      this._leadsApiService.getLeadAssignmentHistory(this.id()).pipe(catchError(() => EMPTY))
        .subscribe((a) => this.assignments.set(a ?? []));
      this._leadsApiService.getLeadOwnerHistory(this.id()).pipe(catchError(() => EMPTY))
        .subscribe((o) => this.ownerHistory.set(o ?? []));
    });

    // Re-observe sentinel when it appears/disappears
    effect(() => {
      const sentinel = this._scrollSentinel();
      this._destroyObserver();
      if (sentinel) {
        this._setupObserver(sentinel.nativeElement);
      }
    });
  }

  ngAfterViewInit(): void {
    const sentinel = this._scrollSentinel();
    if (sentinel) {
      this._setupObserver(sentinel.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this._destroyObserver();
  }

  public toggleFilter(kind: TimelineEventKindEnum): void {
    this.activeFilters.update((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
    // Reset cursor when filters change
    this.cursor.set(PAGE_SIZE);
  }

  public clearFilters(): void {
    this.activeFilters.set(new Set());
    this.cursor.set(PAGE_SIZE);
  }

  public loadMore(): void {
    this.isLoadingMore.set(true);
    // Small delay to show loading state
    setTimeout(() => {
      this.cursor.update((c) => c + PAGE_SIZE);
      this.isLoadingMore.set(false);
    }, 150);
  }

  public trackEvent(index: number, event: TimelineEvent): string {
    return (event.occurredAt ?? '') + (event.kind ?? '') + index;
  }

  /**
   * Parse score delta from detail text like "Score: 42 → 58 (+16)"
   * Returns null if format doesn't match.
   */
  public parseScoreDelta(detail: string): { delta: number; newScore: number } | null {
    const match = detail.match(/(\d+)\s*→\s*(\d+)/);
    if (!match) return null;
    const oldScore = parseInt(match[1], 10);
    const newScore = parseInt(match[2], 10);
    return { delta: newScore - oldScore, newScore };
  }

  private _setupObserver(el: HTMLElement): void {
    this._observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && this.hasMore() && !this.isLoadingMore()) {
          this.loadMore();
        }
      },
      { rootMargin: '200px' },
    );
    this._observer.observe(el);
  }

  private _destroyObserver(): void {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }
}

export default LeadTimelinePage;
