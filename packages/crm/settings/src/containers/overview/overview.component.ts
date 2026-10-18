import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { SettingsEntry, SettingsGroup, visibleCatalog } from '../../settings-catalog';
import { EntryStatus, SettingsOverviewStatus, SettingsStatusService } from './settings-status.service';

/** Masquer la mise en service est un choix de la personne, gardé dans ce navigateur seulement. */
const SETUP_HIDDEN_KEY = 'SANKORE_SETTINGS_SETUP_HIDDEN';

const TONE_STYLE: Record<EntryStatus['tone'], { dot: string; text: string }> = {
  ok: { dot: 'bg-green-700', text: 'text-slate-700' },
  warn: { dot: 'bg-[#e0a35a]', text: 'text-[#7a4a12]' },
  neutral: { dot: 'bg-slate-300', text: 'text-slate-600' },
};

interface EntryView extends SettingsEntry {
  status: EntryStatus | null;
  dot: string;
  statusText: string;
}

interface GroupView extends Omit<SettingsGroup, 'entries'> {
  entries: EntryView[];
  alerts: number;
}

/**
 * L'accueil du paramétrage : une rubrique à la fois, avec l'état réel de chaque réglage, et la
 * mise en service en tête tant qu'elle n'est pas terminée.
 *
 * La liste des rubriques est `settings-catalog`, la même que partout ailleurs ; les états viennent
 * de `SettingsStatusService`, qui ne lit que ce que l'utilisateur a le droit de voir.
 */
@Component({
  selector: 'settings-overview',
  templateUrl: './overview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Button, TasIcon],
})
export class OverviewComponent implements OnInit {
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _statusService = inject(SettingsStatusService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);

  public query = signal('');
  public selectedId = signal<string | null>(null);
  public status = signal<SettingsOverviewStatus | null>(null);
  public setupHidden = signal(this._readSetupHidden());

  public readonly groups = computed<GroupView[]>(() => {
    const entries = this.status()?.entries ?? {};
    return visibleCatalog(this._permissions.granted()).map((g) => {
      const views = g.entries.map((e) => {
        const status = entries[e.id] ?? null;
        const tone = TONE_STYLE[status?.tone ?? 'neutral'];
        return { ...e, status, dot: tone.dot, statusText: tone.text };
      });
      return { ...g, entries: views, alerts: views.filter((e) => e.status?.tone === 'warn').length };
    });
  });

  /** Sans recherche, la rubrique choisie (la première par défaut) ; avec, toutes celles qui ont un résultat. */
  public readonly shown = computed<GroupView[]>(() => {
    const q = this._normalize(this.query());
    const groups = this.groups();
    if (!q) {
      const selected = groups.find((g) => g.id === this.selectedId()) ?? groups[0];
      return selected ? [selected] : [];
    }
    return groups
      .map((g) => ({
        ...g,
        entries: g.entries.filter((e) => this._normalize(`${e.title} ${e.description} ${g.title}`).includes(q)),
      }))
      .filter((g) => g.entries.length > 0);
  });

  public readonly activeGroupId = computed(() =>
    this.query().trim() ? null : (this.shown()[0]?.id ?? null),
  );

  public readonly setup = computed(() => this.status()?.setup ?? []);
  public readonly setupDone = computed(() => this.setup().filter((s) => s.done).length);
  public readonly setupPercent = computed(() =>
    this.setup().length ? Math.round((this.setupDone() / this.setup().length) * 100) : 0,
  );
  /** Disparaît seule une fois tout fait : elle n'a plus rien à dire. */
  public readonly showSetup = computed(
    () => !this.setupHidden() && !this.query().trim() && this.setup().length > 0 && this.setupDone() < this.setup().length,
  );

  public ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Paramétrage' }]);
    this.selectedId.set(this._route.snapshot.queryParamMap.get('rubrique'));
    this._statusService
      .load()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((s) => this.status.set(s));
  }

  /** Dans l'URL, pour que le retour depuis un réglage rouvre la même rubrique. */
  public pickGroup(id: string): void {
    this.query.set('');
    this.selectedId.set(id);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { rubrique: id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public hideSetup(): void {
    this.setupHidden.set(true);
    try {
      localStorage.setItem(SETUP_HIDDEN_KEY, '1');
    } catch {
      // Stockage indisponible (navigation privée) : masquée pour cette visite seulement.
    }
  }

  private _readSetupHidden(): boolean {
    try {
      return localStorage.getItem(SETUP_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  private _normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }
}

export default OverviewComponent;
