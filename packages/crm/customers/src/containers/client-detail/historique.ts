import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, map, of, Subject, switchMap } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  ClientTimelineEntryDto,
  ClientTimelineSegmentsApiService,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { ClientDetailStore } from '../../models/client-detail.store';

const PAGE_SIZE = 20;

/** Un module qui alimente la timeline, tel que la fiche sait le présenter. */
interface ModuleMeta {
  label: string;
  icon: string;
  /** Classes de la pastille d'icône. */
  color: string;
  /** Le module a-t-il un écran dans cette application ? */
  available: boolean;
}

/**
 * `GET /clients/{id}/timeline` agrège « Customers (lifecycle, transfers, merges, segment
 * changes, group memberships) et Leads (the commercial history imported at conversion) »,
 * les modules M02/M03/M04/M08 s'ajoutant « as soon as they publish ». Seuls Customers et
 * Leads ont un écran ici : les autres sont déclarés indisponibles pour que le lien soit
 * désactivé avec une explication, au lieu de mener sur une route inexistante.
 */
const MODULE_META: Record<string, ModuleMeta> = {
  customers: { label: 'Client', icon: 'feather:user', color: 'bg-blue-100 text-blue-600', available: true },
  leads: { label: 'Lead', icon: 'feather:target', color: 'bg-purple-100 text-purple-600', available: true },
  savings: { label: 'Épargne', icon: 'feather:pie-chart', color: 'bg-slate-100 text-slate-500', available: false },
  credit: { label: 'Crédit', icon: 'feather:credit-card', color: 'bg-slate-100 text-slate-500', available: false },
  loans: { label: 'Prêts', icon: 'feather:credit-card', color: 'bg-slate-100 text-slate-500', available: false },
  loan: { label: 'Prêts', icon: 'feather:credit-card', color: 'bg-slate-100 text-slate-500', available: false },
  insurance: { label: 'Assurance', icon: 'feather:shield', color: 'bg-slate-100 text-slate-500', available: false },
  tontine: { label: 'Tontine', icon: 'feather:users', color: 'bg-slate-100 text-slate-500', available: false },
};

const UNKNOWN_MODULE: ModuleMeta = {
  label: 'Autre',
  icon: 'feather:circle',
  color: 'bg-slate-100 text-slate-500',
  available: false,
};

/** Modules toujours proposés au filtre, même si la page chargée n'en contient aucune entrée. */
const BASE_MODULES = ['Customers', 'Leads'];

/**
 * Le contrat n'énumère aucune valeur d'`entryType` — il en cite une seule en exemple.
 * Traduire des codes jamais vus reviendrait à inventer des libellés, donc tout code
 * inconnu est simplement rendu lisible (`CLIENT_STATUS_CHANGED` -> « Client status
 * changed ») : le sens précis est porté par `summary`, écrit par le serveur.
 */
const ENTRY_TYPE_LABELS: Record<string, string> = {
  CLIENT_ACTIVATED: 'Client activé',
};

const PERIOD_OPTIONS = [
  { label: 'Toutes les périodes', value: '' },
  { label: '7 derniers jours', value: '7' },
  { label: '30 derniers jours', value: '30' },
  { label: '3 derniers mois', value: '90' },
  { label: '12 derniers mois', value: '365' },
];

const ABSOLUTE_DATE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
});

function normalizeKey(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function moduleMeta(raw: string | null | undefined): ModuleMeta {
  return MODULE_META[normalizeKey(raw)] ?? (raw ? { ...UNKNOWN_MODULE, label: raw } : UNKNOWN_MODULE);
}

function entryTypeLabel(raw: string | null | undefined): string {
  if (!raw) return 'Évènement';
  const known = ENTRY_TYPE_LABELS[raw];
  if (known) return known;
  const words = raw.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Évènement';
}

/** Ligne prête à afficher : tout ce qui dépend des permissions est déjà résolu. */
interface TimelineRow {
  key: string;
  icon: string;
  color: string;
  moduleLabel: string;
  typeLabel: string;
  summary: string;
  occurredAt: string | null;
  absoluteDate: string;
  beforeConversion: boolean;
  /** Renseignée quand l'élément source est atteignable. */
  route: string[] | null;
  /** Renseignée quand la référence existe mais reste hors d'atteinte. */
  blockedReason: string | null;
}

interface TimelineRequest {
  page: number;
  append: boolean;
}

@Component({
  selector: 'client-historique',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TasCard,
    TasIcon,
    TasSpinner,
    TasTag,
    TasFormField,
    TasLabel,
    TasSelect,
    TimeagoPipe,
  ],
  templateUrl: './historique.html',
})
export class ClientTimelinePage {
  private readonly _timelineApi = inject(ClientTimelineSegmentsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);

  protected readonly store = inject(ClientDetailStore);

  private readonly _canReadLead = this._permissions.can('lead:read');
  private readonly _canReadOpportunity = this._permissions.can('lead:opportunity:read');
  private readonly _canReadCustomers = this._permissions.can('customers:read');
  private readonly _canMergeCustomers = this._permissions.can('customers:merge');

  protected readonly periodOptions = PERIOD_OPTIONS;

  /** Filtres acceptés par le contrat : appliqués côté serveur. */
  protected readonly filterModule = signal('');
  protected readonly filterType = signal('');
  /** Le contrat n'accepte aucune borne de date : filtre appliqué aux entrées chargées. */
  protected readonly filterPeriod = signal('');

  protected readonly isLoading = signal(true);
  protected readonly isLoadingMore = signal(false);
  protected readonly totalCount = signal(0);
  protected readonly hasNextPage = signal(false);

  private readonly _entries = signal<ClientTimelineEntryDto[]>([]);
  private readonly _page = signal(1);

  /**
   * Catalogues cumulés depuis les réponses reçues. Ils ne sont jamais vidés : filtrer sur
   * un type réduit la réponse à ce seul type, et une liste d'options reconstruite à chaque
   * réponse enfermerait l'utilisateur dans le filtre qu'il vient de poser.
   */
  private readonly _seenModules = signal<string[]>([]);
  private readonly _seenTypes = signal<string[]>([]);

  private readonly _request$ = new Subject<TimelineRequest>();

  protected readonly moduleOptions = computed(() => {
    const seen = new Set([...BASE_MODULES, ...this._seenModules()]);
    const options = [...seen].map((code) => ({ label: moduleMeta(code).label, value: code }));
    options.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    return [{ label: 'Tous les modules', value: '' }, ...options];
  });

  protected readonly typeOptions = computed(() => {
    const options = this._seenTypes().map((code) => ({ label: entryTypeLabel(code), value: code }));
    options.sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    return [{ label: 'Tous les types', value: '' }, ...options];
  });

  /** Borne basse de la période demandée, en millisecondes. */
  private readonly _periodFrom = computed(() => {
    const days = Number(this.filterPeriod());
    return Number.isFinite(days) && days > 0 ? Date.now() - days * 86_400_000 : null;
  });

  private readonly _sortedEntries = computed(() => {
    // Le serveur répond déjà « most recent fact first ». Le tri reste une garantie locale :
    // la concaténation des pages ne doit jamais pouvoir désordonner la colonne.
    return [...this._entries()].sort((a, b) => {
      const ta = a.occurredAt ? Date.parse(a.occurredAt) : 0;
      const tb = b.occurredAt ? Date.parse(b.occurredAt) : 0;
      return tb - ta;
    });
  });

  protected readonly rows = computed<TimelineRow[]>(() => {
    const from = this._periodFrom();
    const client = this.store.client();
    // Un client qui ne vient pas d'une conversion n'a pas d'« avant conversion » à marquer.
    const conversionAt = client?.sourceLeadId && client.createdAt ? Date.parse(client.createdAt) : null;

    return this._sortedEntries()
      .filter((entry) => {
        if (from === null) return true;
        const at = entry.occurredAt ? Date.parse(entry.occurredAt) : NaN;
        return Number.isNaN(at) ? false : at >= from;
      })
      .map((entry, index) => {
        const meta = moduleMeta(entry.sourceModule);
        const target = this._resolveReference(entry, meta, client?.sourceLeadId ?? null);
        const at = entry.occurredAt ? Date.parse(entry.occurredAt) : NaN;

        return {
          key: entry.id ?? `${entry.occurredAt ?? ''}-${index}`,
          icon: meta.icon,
          color: meta.color,
          moduleLabel: meta.label,
          typeLabel: entryTypeLabel(entry.entryType),
          summary: entry.summary?.trim() || entryTypeLabel(entry.entryType),
          occurredAt: entry.occurredAt ?? null,
          absoluteDate: Number.isNaN(at) ? 'Date inconnue' : ABSOLUTE_DATE.format(at),
          beforeConversion: this._isBeforeConversion(entry, conversionAt),
          route: target.route,
          blockedReason: target.blockedReason,
        };
      });
  });

  protected readonly visibleCount = computed(() => this.rows().length);

  /** La période est posée après coup : le total serveur ne la reflète pas. */
  protected readonly isPeriodFilterPartial = computed(
    () => this._periodFrom() !== null && this.hasNextPage(),
  );

  protected readonly hasActiveFilter = computed(
    () => !!this.filterModule() || !!this.filterType() || !!this.filterPeriod(),
  );

  constructor() {
    // Un seul flux de requêtes : `switchMap` annule la précédente, sinon deux changements
    // de filtre rapprochés peuvent laisser la réponse du filtre abandonné arriver en
    // dernier et remplir la liste avec des entrées que plus rien n'a demandées.
    this._request$
      .pipe(
        switchMap((request) => {
          const clientId = this.store.clientId();
          if (!clientId) return EMPTY;
          return this._timelineApi
            .getClientTimeline(
              clientId,
              request.page,
              PAGE_SIZE,
              this.filterModule() || undefined,
              this.filterType() || undefined,
            )
            .pipe(
              map((result) => ({ result, request })),
              catchError(() => {
                this._snackbar.error('Erreur', "L'historique de ce client n'a pas pu être chargé.");
                return of(null);
              }),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((payload) => {
        this.isLoading.set(false);
        this.isLoadingMore.set(false);
        if (!payload) return;

        const items = payload.result.items ?? [];
        this._entries.update((previous) => (payload.request.append ? [...previous, ...items] : items));
        this.totalCount.set(payload.result.totalCount ?? 0);
        this.hasNextPage.set(payload.result.hasNextPage ?? false);
        this._page.set(payload.request.page);
        this._rememberCatalogues(items);
      });

    effect(() => {
      // Les deux filtres que le contrat accepte repartent de la première page.
      this.store.clientId();
      this.filterModule();
      this.filterType();

      this.isLoading.set(true);
      this._entries.set([]);
      this._request$.next({ page: 1, append: false });
    });
  }

  protected onModuleChange(value: string | null): void {
    this.filterModule.set(value ?? '');
  }

  protected onTypeChange(value: string | null): void {
    this.filterType.set(value ?? '');
  }

  protected onPeriodChange(value: string | null): void {
    this.filterPeriod.set(value ?? '');
  }

  protected clearFilters(): void {
    this.filterPeriod.set('');
    this.filterModule.set('');
    this.filterType.set('');
  }

  protected loadMore(): void {
    if (this.isLoadingMore() || !this.hasNextPage()) return;
    this.isLoadingMore.set(true);
    this._request$.next({ page: this._page() + 1, append: true });
  }

  private _rememberCatalogues(items: ClientTimelineEntryDto[]): void {
    const modules = new Set(this._seenModules());
    const types = new Set(this._seenTypes());
    for (const item of items) {
      if (item.sourceModule) modules.add(item.sourceModule);
      if (item.entryType) types.add(item.entryType);
    }
    this._seenModules.set([...modules]);
    this._seenTypes.set([...types]);
  }

  /**
   * `ClientTimelineEntryDto` ne porte aucun indicateur de conversion. Le contrat dit que le
   * module Leads apporte « the commercial history imported at conversion » : une entrée de ce
   * module est donc antérieure à la conversion par construction. Pour les autres modules on
   * retombe sur la date de création de la fiche, qui est celle de la conversion quand le
   * client vient d'un lead. À confirmer côté API : le jour où une entrée portera le
   * renseignement, cette déduction doit disparaître.
   */
  private _isBeforeConversion(entry: ClientTimelineEntryDto, conversionAt: number | null): boolean {
    if (conversionAt === null) return false;
    if (normalizeKey(entry.sourceModule) === 'leads') return true;
    const at = entry.occurredAt ? Date.parse(entry.occurredAt) : NaN;
    return !Number.isNaN(at) && at < conversionAt;
  }

  /**
   * Le contrat n'énumère pas les `referenceType`. Seules les cibles qui ont réellement une
   * route dans l'application sont ouvertes ; tout le reste reste visible mais désactivé,
   * avec la raison en info-bulle.
   */
  private _resolveReference(
    entry: ClientTimelineEntryDto,
    meta: ModuleMeta,
    sourceLeadId: string | null,
  ): { route: string[] | null; blockedReason: string | null } {
    const reference = entry.referenceId?.trim();
    if (!reference || !entry.referenceType) return { route: null, blockedReason: null };

    if (!meta.available) {
      return {
        route: null,
        blockedReason: `Le module ${meta.label} n'est pas encore disponible.`,
      };
    }

    switch (normalizeKey(entry.referenceType)) {
      case 'lead':
        return this._canReadLead()
          ? { route: ['/leads', reference], blockedReason: null }
          : { route: null, blockedReason: "Vous n'avez pas la permission de consulter les leads." };

      case 'opportunity':
        // L'application n'expose pas d'écran par opportunité : le seul chemin existant est
        // l'onglet Opportunités du lead d'origine, connu par `ClientDetailDto.sourceLeadId`.
        if (!sourceLeadId) {
          return { route: null, blockedReason: "Le lead d'origine de ce client n'est pas connu." };
        }
        return this._canReadOpportunity()
          ? { route: ['/leads', sourceLeadId, 'opportunites'], blockedReason: null }
          : {
              route: null,
              blockedReason: "Vous n'avez pas la permission de consulter les opportunités.",
            };

      case 'client':
        return this._canReadCustomers()
          ? { route: ['/customers', reference], blockedReason: null }
          : { route: null, blockedReason: "Vous n'avez pas la permission de consulter les clients." };

      case 'clientgroup':
      case 'group':
        return this._canReadCustomers()
          ? { route: ['/customers', 'groupes', reference], blockedReason: null }
          : { route: null, blockedReason: "Vous n'avez pas la permission de consulter les groupes." };

      case 'mergerequest':
      case 'clientmergerequest':
        return this._canMergeCustomers()
          ? { route: ['/customers', 'fusions', reference], blockedReason: null }
          : {
              route: null,
              blockedReason: "Vous n'avez pas la permission de consulter les fusions.",
            };

      default:
        return {
          route: null,
          blockedReason: "Cette référence n'a pas encore d'écran dédié dans l'application.",
        };
    }
  }
}

export default ClientTimelinePage;
