import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { ConnectionHealthDto, ConnectionListDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { catchError, EMPTY, finalize, Subject, switchMap } from 'rxjs';
import {
  integrationErrorMessage,
  IntegrationFacadeService,
} from '../../data-access/integration-facade.service';
import {
  CONNECTION_FAMILIES,
  CONNECTION_FAMILY_LABELS,
  CONNECTION_KIND_LABELS,
  CONNECTION_MODE_LABELS,
  ConnectionFamily,
  ConnectionKind,
  ConnectionMode,
} from '../../data-access/integration-referential';
import {
  CreateConnectionDrawer,
  CreateConnectionDrawerData,
  CreateConnectionDrawerResult,
} from './create-connection-drawer';

/**
 * Au-delà, un test réussi est montré comme « ancien ». Le serveur n'impose aucun délai —
 * un test passé débloque l'activation quel que soit son âge — c'est un repère d'écran :
 * un système qui répondait il y a des mois n'est pas un système qui répond.
 */
const TEST_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Les trois tuiles d'état, qui sont aussi des filtres. */
export type ConnectionView = 'live' | 'fix' | 'totest';

type TestState = 'running' | 'fresh' | 'recent' | 'old' | 'never' | 'failed';

const TEST_STATE: Record<TestState, { label: string; tone: string; dot: string }> = {
  running: { label: 'Test en cours…', tone: 'text-blue-800', dot: 'bg-blue-400 animate-pulse' },
  fresh: { label: 'Test réussi', tone: 'text-green-800', dot: 'bg-green-700' },
  recent: { label: 'Test réussi', tone: 'text-green-800', dot: 'bg-green-700' },
  old: { label: 'Test réussi, mais ancien', tone: 'text-amber-800', dot: 'bg-amber-400' },
  never: { label: 'Jamais testée', tone: 'text-slate-600', dot: 'bg-slate-300' },
  failed: { label: 'Test échoué', tone: 'text-functional-error', dot: 'bg-functional-error' },
};

const FAMILY_TILE: Record<ConnectionFamily, string> = {
  CoreBanking: 'bg-primary/10 text-primary',
  Insurance: 'bg-blue-50 text-blue-800',
  Telephony: 'bg-amber-50 text-amber-800',
};

export interface ConnectionRow {
  type: 'row';
  key: string;
  connection: ConnectionListDto;
  name: string;
  initials: string;
  tile: string;
  system: string;
  mode: string;
  isTest: boolean;
  isFirst: boolean;
  test: TestState;
  testLabel: string;
  testTone: string;
  testDot: string;
  testNote: string;
  actionLabel: string;
  isActionPrimary: boolean;
  errorDetail: string | null;
}

export interface ConnectionGroupHeader {
  type: 'group';
  key: string;
  title: string;
  summary: string;
}

/**
 * Liste des connexions, montée deux fois : sans famille pour l'écran « Connexions », et
 * avec `family: 'Insurance'` (par les `data` de route) pour l'écran « Assurance ». Un seul
 * écran parce que les deux listes répondent à la même question — laquelle est active, et
 * laquelle est en panne — et que les dupliquer les aurait fait diverger.
 *
 * La liste est chargée ENTIÈRE (`listAllConnections`) puis filtrée ici : les tuiles
 * comptent sur toutes les connexions, quel que soit le filtre, et une page serveur n'en
 * donnerait qu'une partie. Un tenant en déclare quelques-unes, jamais des centaines.
 */
@Component({
  templateUrl: './connections-page.html',
  imports: [Button, TasIcon, TasTable, TimeagoPipe],
})
export class ConnectionsPage implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);

  private readonly _permissions = inject(PermissionsService);
  public readonly canManage = this._permissions.can('Integration.Connection.Manage');

  /** Famille imposée par la route. Absente, l'écran laisse choisir la famille en onglet. */
  public readonly family = input<ConnectionFamily | undefined>(undefined);

  public readonly isLoading = signal(true);
  public readonly connections = signal<ConnectionListDto[]>([]);

  public readonly filterFamily = signal<ConnectionFamily | null>(null);
  public readonly filterView = signal<ConnectionView | null>(null);

  /** Tests lancés depuis cet écran, en cours ou rendus, par id de connexion. */
  public readonly runningTests = signal<ReadonlySet<string>>(new Set());
  public readonly testResults = signal<ReadonlyMap<string, ConnectionHealthDto>>(new Map());

  public readonly tableConfig = signal<TableConfig>({
    property: 'key',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 100,
      pageSizeOptions: [100],
    },
  });

  public readonly isInsurance = computed(() => this.family() === 'Insurance');

  public readonly pageTitle = computed(() =>
    this.isInsurance() ? 'Connexions assurance' : 'Connexions',
  );

  public readonly pageIntent = computed(() =>
    this.isInsurance()
      ? 'Les back-offices des assureurs dont vous distribuez les produits.'
      : 'Les systèmes externes avec lesquels vous échangez : core banking, assurance, téléphonie.',
  );

  public readonly showFamilyTabs = computed(() => this.family() === undefined);

  public readonly hasFilter = computed(
    () => this.filterView() !== null || this.filterFamily() !== null,
  );

  private readonly _testStates = computed(() => {
    const running = this.runningTests();
    const results = this.testResults();
    const now = Date.now();
    const states = new Map<string, TestState>();
    for (const c of this.connections()) {
      const id = c.id ?? '';
      const result = results.get(id);
      let state: TestState;
      if (running.has(id)) state = 'running';
      else if (result) state = result.isHealthy ? 'fresh' : 'failed';
      else if (c.lastHealthStatus === false) state = 'failed';
      else if (c.lastHealthStatus !== true) state = 'never';
      else {
        const at = Date.parse(c.lastHealthAt ?? '');
        state = Number.isFinite(at) && now - at > TEST_STALE_AFTER_MS ? 'old' : 'recent';
      }
      states.set(id, state);
    }
    return states;
  });

  private _view(c: ConnectionListDto): ConnectionView | null {
    const state = this._testStates().get(c.id ?? '');
    if (state === 'failed') return 'fix';
    if (state === 'never') return 'totest';
    return c.isActive ? 'live' : null;
  }

  public readonly tiles = computed(() => {
    const all = this.connections();
    const live = all.filter((c) => this._view(c) === 'live');
    const fix = all.filter((c) => this._view(c) === 'fix').length;
    const totest = all.filter((c) => this._view(c) === 'totest').length;
    const liveTest = live.filter((c) => c.kind === 'Fake').length;

    let liveNote = `${live.length} sur ${all.length}`;
    if (live.length > 0 && liveTest === live.length) liveNote += ', toutes en recette';
    else if (liveTest > 0) liveNote += `, dont ${liveTest} en recette`;

    return [
      { view: 'live' as const, value: live.length, label: 'En service', note: liveNote, tone: 'bg-green-100 text-green-800' },
      { view: 'fix' as const, value: fix, label: 'À corriger', note: fix ? 'Dernier test en échec' : 'Rien à corriger', tone: 'bg-red-100 text-red-800' },
      { view: 'totest' as const, value: totest, label: 'À tester', note: totest ? 'Jamais testées, donc inactives' : 'Tout a été testé', tone: 'bg-amber-100 text-amber-800' },
    ];
  });

  /**
   * Des connexions actives, mais toutes sur des simulateurs : rien de réel n'est échangé,
   * et rien dans la liste ne le dit autrement qu'une colonne « Recette » à lire ligne à ligne.
   */
  public readonly onlyTestIsActive = computed(() => {
    const active = this.connections().filter((c) => c.isActive);
    return active.length > 0 && active.every((c) => c.kind === 'Fake');
  });

  public readonly activeCount = computed(
    () => this.connections().filter((c) => c.isActive).length,
  );

  public readonly tabs = computed(() => {
    const all = this.connections();
    return [
      { value: null, label: 'Toutes', count: all.length },
      ...CONNECTION_FAMILIES.map((f) => ({
        value: f.value,
        label: f.label,
        count: all.filter((c) => c.family === f.value).length,
      })),
    ];
  });

  private readonly _visible = computed(() =>
    this.connections().filter(
      (c) =>
        (this.filterFamily() === null || c.family === this.filterFamily()) &&
        (this.filterView() === null || this._view(c) === this.filterView()),
    ),
  );

  public readonly shownLabel = computed(() => {
    const shown = this._visible().length;
    return `${shown} sur ${this.connections().length} affichée${shown > 1 ? 's' : ''}`;
  });

  /**
   * Les lignes de la table, avec une ligne d'en-tête par famille : `tas-table` rend une
   * liste plate, et le regroupement de la maquette tient dans cette liste plutôt que
   * dans trois tables, qui auraient chacune leur pagination et leur état vide.
   */
  public readonly entries = computed<Array<ConnectionGroupHeader | ConnectionRow>>(() => {
    const visible = this._visible();
    const entries: Array<ConnectionGroupHeader | ConnectionRow> = [];
    for (const family of CONNECTION_FAMILIES) {
      const rows = visible.filter((c) => c.family === family.value);
      if (rows.length === 0) continue;
      const actives = rows.filter((c) => c.isActive).length;
      entries.push({
        type: 'group',
        key: `group-${family.value}`,
        title: family.label,
        summary: `${rows.length} connexion${rows.length > 1 ? 's' : ''} · ${actives} active${actives > 1 ? 's' : ''}`,
      });
      rows.forEach((c, i) => entries.push(this._row(c, i === 0)));
    }
    return entries;
  });

  private readonly _reload$ = new Subject<void>();

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations/connections'] },
      { label: this.isInsurance() ? 'Assurance' : 'Connexions' },
    ]);

    this._reload$
      .pipe(
        switchMap(() => {
          this.isLoading.set(true);
          return this._facade.listAllConnections(this.family()).pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                integrationErrorMessage(err, 'Impossible de charger les connexions.'),
              );
              this.isLoading.set(false);
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((items) => {
        this.connections.set(items);
        this.isLoading.set(false);
      });

    const params = this._route.snapshot.queryParams;
    const famille = params['famille'];
    if (CONNECTION_FAMILIES.some((f) => f.value === famille)) this.filterFamily.set(famille);
    const vue = params['vue'];
    if (vue === 'live' || vue === 'fix' || vue === 'totest') this.filterView.set(vue);

    this._reload$.next();
  }

  public pickTab(family: ConnectionFamily | null): void {
    this.filterFamily.set(family);
    this._applyFilters();
  }

  /** Une tuile déjà choisie se désélectionne au second clic, comme dans la maquette. */
  public pickView(view: ConnectionView): void {
    this.filterView.update((current) => (current === view ? null : view));
    this._applyFilters();
  }

  public clearFilters(): void {
    this.filterFamily.set(null);
    this.filterView.set(null);
    this._applyFilters();
  }

  public refresh(): void {
    this._reload$.next();
  }

  public open(connection: ConnectionListDto): void {
    if (!connection.id) return;
    this._router.navigate(['/settings/integrations/connections', connection.id]);
  }

  /**
   * Le test est ENREGISTRÉ par le serveur (date, résultat, détail) : on recharge la liste
   * après coup pour afficher son état réel, et on garde la réponse pour son détail, que
   * la liste ne porte pas.
   */
  public runTest(connection: ConnectionListDto): void {
    const id = connection.id;
    if (!id || this.runningTests().has(id)) return;

    this.runningTests.update((set) => new Set(set).add(id));
    this._facade
      .checkConnectionHealth(id)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, 'Impossible de lancer le test.'),
          );
          return EMPTY;
        }),
        finalize(() =>
          this.runningTests.update((set) => {
            const next = new Set(set);
            next.delete(id);
            return next;
          }),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((result) => {
        this.testResults.update((map) => new Map(map).set(id, result));
        this._reload$.next();
      });
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open<
      CreateConnectionDrawerResult,
      CreateConnectionDrawerData,
      CreateConnectionDrawer
    >(CreateConnectionDrawer, {
      data: { family: this.family() ?? null },
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    // La connexion existe dès l'écran de succès du drawer : fermé par « Retour à la
    // liste », il rend quand même son id pour que la liste la montre.
    ref.closed.subscribe((result) => {
      if (!result) return;
      if (result.openDetail) {
        this._router.navigate(['/settings/integrations/connections', result.connectionId]);
      } else {
        this._reload$.next();
      }
    });
  }

  private _row(c: ConnectionListDto, isFirst: boolean): ConnectionRow {
    const id = c.id ?? '';
    const kind = c.kind as ConnectionKind | undefined;
    const family = (c.family ?? 'CoreBanking') as ConnectionFamily;
    const test = this._testStates().get(id) ?? 'never';
    const result = this.testResults().get(id);
    const system = kind ? CONNECTION_KIND_LABELS[kind] : '—';
    const words = (kind === 'Fake' ? CONNECTION_FAMILY_LABELS[family] : system)
      .replace('®Suite', '')
      .split(/\s+/)
      .filter(Boolean);
    const lastAt = c.lastHealthAt ? DATE_FORMAT.format(new Date(c.lastHealthAt)) : '';

    const notes: Record<TestState, string> = {
      running: 'Connexion au système…',
      fresh: 'À l’instant',
      recent: lastAt ? `Le ${lastAt}` : '',
      old: `Le ${lastAt} · ${c.isActive ? 'à refaire' : 'à refaire avant la mise en service'}`,
      never: '',
      failed: result ? 'À l’instant' : lastAt ? `Le ${lastAt}` : '',
    };

    return {
      type: 'row',
      key: id,
      connection: c,
      name: c.name || system,
      initials: words.map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
      tile: FAMILY_TILE[family],
      system: kind === 'Fake' ? `Simulateur ${CONNECTION_FAMILY_LABELS[family].toLowerCase()}` : system,
      mode: c.mode ? CONNECTION_MODE_LABELS[c.mode as ConnectionMode] : '—',
      isTest: kind === 'Fake',
      isFirst,
      test,
      testLabel: TEST_STATE[test].label,
      testTone: TEST_STATE[test].tone,
      testDot: TEST_STATE[test].dot,
      testNote: notes[test],
      actionLabel:
        test === 'never' ? 'Lancer le premier test' : test === 'failed' ? 'Relancer le test' : 'Tester',
      isActionPrimary: test === 'never' || test === 'failed',
      errorDetail:
        test === 'failed'
          ? result?.detail ||
            'Le système n’a pas répondu comme attendu. Vérifiez l’adresse du service et les identifiants, puis relancez le test.'
          : null,
    };
  }

  private _applyFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        famille: this.family() ? null : this.filterFamily(),
        vue: this.filterView(),
        // Les anciens paramètres de l'écran précédent ne filtrent plus rien.
        actif: null,
        page: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

export default ConnectionsPage;
