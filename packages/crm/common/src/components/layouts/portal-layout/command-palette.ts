import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, forkJoin, map, Observable, of, Subject, switchMap, tap } from 'rxjs';
import { ClientsApiService, LeadsApiService } from '@sankore/crm-api';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { PERMISSIONS } from '../../../models/permissions';
import { PermissionsService } from '../../../services/permissions.service';
import { PORTAL_NAVIGATION, SETTINGS_NAV_ITEM } from './portal-navigation';

interface PaletteResult {
  key: string;
  section: 'Pages' | 'Leads' | 'Clients';
  label: string;
  detail: string;
  icon: string;
  route: string[];
}

const RESULTS_PER_SECTION = 5;

/** Sans accents ni casse : « reglage » trouve « Paramétrage » comme on l'écrit au clavier. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * La recherche globale (Ctrl K / ⌘ K) : les pages du menu, puis les leads et les clients par les
 * recherches qui servent déjà leurs listes — `GET leads?search=` et `GET clients` — avec le même
 * périmètre que ces listes, sans endpoint nouveau. Cinq résultats par section : c'est un raccourci
 * vers une fiche, pas une liste ; pour plus, la page de la liste.
 *
 * Un chiffre cherche le téléphone d'un client plutôt que son nom.
 */
@Component({
  selector: 'common-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, TasSpinner],
  template: `
    <div class="overflow-hidden rounded-2xl bg-white shadow-2xl" (keydown)="onKeydown($event)">
      <div class="flex items-center gap-3 border-b border-slate-100 px-4">
        <tas-icon iconName="feather:search" class="text-slate-400" style="font-size:18px"></tas-icon>
        <input
          type="search"
          class="h-14 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
          placeholder="Rechercher une page, un lead, un client…"
          aria-label="Rechercher"
          autocomplete="off"
          [value]="query()"
          (input)="onInput($any($event.target).value)"
          cdkFocusInitial
        />
        @if (loading()) {
          <tas-spinner size="5" class="text-primary"></tas-spinner>
        }
        <kbd class="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500">Échap</kbd>
      </div>

      <div class="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Résultats">
        @for (r of results(); track r.key; let i = $index) {
          @if (i === 0 || results()[i - 1].section !== r.section) {
            <p class="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{{ r.section }}</p>
          }
          <button
            type="button"
            role="option"
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left"
            [class]="i === active() ? 'bg-primary/10' : 'hover:bg-slate-50'"
            [attr.aria-selected]="i === active()"
            (mouseenter)="active.set(i)"
            (click)="open(r)"
          >
            <tas-icon [iconName]="r.icon" class="shrink-0 text-slate-500" style="font-size:16px"></tas-icon>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-slate-900">{{ r.label }}</span>
              @if (r.detail) {
                <span class="block truncate text-xs text-slate-500">{{ r.detail }}</span>
              }
            </span>
            @if (i === active()) {
              <tas-icon iconName="feather:corner-down-left" class="text-slate-400" style="font-size:14px"></tas-icon>
            }
          </button>
        } @empty {
          <p class="px-3 py-8 text-center text-sm text-slate-500">
            {{ query().trim().length < 2 ? 'Tapez au moins deux caractères pour chercher un lead ou un client.' : 'Aucun résultat.' }}
          </p>
        }
      </div>

      <div class="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
        <span><kbd class="font-sans">↑ ↓</kbd> pour choisir</span>
        <span><kbd class="font-sans">Entrée</kbd> pour ouvrir</span>
      </div>
    </div>
  `,
})
export class CommandPalette {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _router = inject(Router);
  private readonly _leads = inject(LeadsApiService);
  private readonly _clients = inject(ClientsApiService);
  private readonly _permissions = inject(PermissionsService);

  public readonly query = signal('');
  public readonly active = signal(0);
  public readonly loading = signal(false);
  private readonly _records = signal<PaletteResult[]>([]);
  private readonly _search$ = new Subject<string>();

  private readonly _pages = computed<PaletteResult[]>(() => {
    const granted = this._permissions.granted();
    return [...PORTAL_NAVIGATION.flatMap((g) => g.items.map((item) => ({ item, group: g.label }))), { item: SETTINGS_NAV_ITEM, group: '' }]
      .filter(({ item }) => !item.anyOf || item.anyOf.some((p) => granted.has(p)))
      .map(({ item, group }) => ({
        key: `p-${item.id}`,
        section: 'Pages' as const,
        label: item.label,
        detail: group,
        icon: item.icon,
        route: [item.link],
      }));
  });

  public readonly results = computed(() => {
    const q = fold(this.query().trim());
    const pages = this._pages().filter((p) => !q || fold(p.label).includes(q) || fold(p.detail).includes(q));
    return [...pages.slice(0, q ? RESULTS_PER_SECTION : pages.length), ...this._records()];
  });

  constructor() {
    this._search$
      .pipe(
        map((q) => q.trim()),
        debounceTime(250),
        distinctUntilChanged(),
        tap((q) => this.loading.set(q.length >= 2)),
        switchMap((q) => (q.length >= 2 ? this._searchRecords(q) : of([]))),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((records) => {
        this._records.set(records);
        this.loading.set(false);
        this.active.set(0);
      });
  }

  public onInput(value: string): void {
    this.query.set(value);
    this.active.set(0);
    this._search$.next(value);
  }

  public onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      this.active.update((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.active.update((i) => (i - 1 + count) % count);
    } else if (event.key === 'Enter') {
      const target = this.results()[this.active()];
      if (target) {
        event.preventDefault();
        this.open(target);
      }
    }
  }

  public open(result: PaletteResult): void {
    this._dialogRef.close();
    this._router.navigate(result.route);
  }

  private _searchRecords(q: string): Observable<PaletteResult[]> {
    const isPhone = /^[+\d\s.-]{4,}$/.test(q);
    const leads$ = this._permissions.has(PERMISSIONS.LEAD_READ)
      ? this._leads.listLeads(1, RESULTS_PER_SECTION, undefined, undefined, undefined, undefined, undefined, q).pipe(
          map((page) =>
            (page.items ?? []).map<PaletteResult>((l) => ({
              key: `l-${l.id}`,
              section: 'Leads',
              label: l.fullName?.trim() || [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Lead sans nom',
              detail: l.interestedProduct && l.interestedProduct !== 'Unknown' ? l.interestedProduct : '',
              icon: 'feather:target',
              route: ['/leads', l.id ?? ''],
            })),
          ),
          catchError(() => of([])),
        )
      : of([]);
    const clients$ = this._permissions.has(PERMISSIONS.CUSTOMERS_READ)
      ? this._clients
          .searchClients(undefined, isPhone ? q : undefined, undefined, isPhone ? undefined : q, undefined, undefined, undefined, undefined, undefined, 1, RESULTS_PER_SECTION)
          .pipe(
            map((page) =>
              (page.items ?? []).map<PaletteResult>((c) => ({
                key: `c-${c.id}`,
                section: 'Clients',
                label: c.displayName?.trim() || 'Client',
                detail: [c.clientNumber, c.agencyName].filter(Boolean).join(' · '),
                icon: 'feather:users',
                route: ['/customers', c.id ?? ''],
              })),
            ),
            catchError(() => of([])),
          )
      : of([]);

    return forkJoin([leads$, clients$]).pipe(map(([leads, clients]) => [...leads, ...clients]));
  }
}
