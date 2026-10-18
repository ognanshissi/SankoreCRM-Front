import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { SelectionModel } from '@angular/cdk/collections';
import { PageEvent } from '@angular/material/paginator';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, concatMap, debounceTime, EMPTY, from, map, of, Subject, toArray } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  AgenciesApiService,
  AgencyDto,
  UsersApiService,
  UserDto,
  UserStatusStatsDto,
} from '@sankore/crm-api';
import { BreadcrumbService, InitialsPipe, PermissionsService } from '@sankore/crm/common';
import { CreateUserComponent } from '../create-user/create-user';
import {
  BULK_ASSIGN_MAX_USERS,
  BulkAssignDrawer,
  BulkAssignDrawerData,
  BulkAssignMode,
} from './bulk-assign-drawer';

// Les noms du contrat, qui exposait ces valeurs en entier tant que le filtre était optionnel.
type UserStatus = 'PendingActivation' | 'Active' | 'Disabled' | 'Locked';

/** État affiché : le statut serveur, plus ce que l'écran sait de l'invitation. */
type MemberState = 'active' | 'sent' | 'expired' | 'resent' | 'disabled' | 'locked';

const STATE_STYLE: Record<MemberState, { label: string; tone: string; dot: string }> = {
  active: { label: 'Actif', tone: 'text-green-800', dot: 'bg-green-700' },
  sent: { label: 'Invitation envoyée', tone: 'text-blue-800', dot: 'bg-blue-400' },
  expired: { label: 'Invitation expirée', tone: 'text-orange-800', dot: 'bg-orange-300' },
  resent: { label: 'Invitation renvoyée', tone: 'text-blue-800', dot: 'bg-blue-400' },
  disabled: { label: 'Désactivé', tone: 'text-slate-600', dot: 'bg-slate-400' },
  locked: { label: 'Suspendu', tone: 'text-red-800', dot: 'bg-red-400' },
};

const STATUS_FACET: ReadonlyArray<{ value: UserStatus; state: MemberState; stat: keyof UserStatusStatsDto }> = [
  { value: 'Active', state: 'active', stat: 'active' },
  { value: 'PendingActivation', state: 'sent', stat: 'pendingActivation' },
  { value: 'Disabled', state: 'disabled', stat: 'disabled' },
  { value: 'Locked', state: 'locked', stat: 'locked' },
];

const AGENCIES_SHOWN = 6;
const PENDING_SCAN_SIZE = 200;

export interface MemberRow {
  id: string;
  user: UserDto;
  initials: string;
  name: string;
  email: string;
  role: string;
  rolesTitle: string;
  agency: string;
  isAdmin: boolean;
  isDuplicate: boolean;
  isTestAddress: boolean;
  state: MemberState;
  stateLabel: string;
  stateTone: string;
  stateDot: string;
  isPending: boolean;
  isResent: boolean;
  avatar: string;
}

@Component({
  templateUrl: './users-homepage.html',
  imports: [DatePipe, NgTemplateOutlet, FormsModule, Button, TasIcon, TasTable, TimeagoPipe, InitialsPipe],
})
export class UsersHomePage implements OnInit {
  private readonly _permissions = inject(PermissionsService);
  public readonly canCreate = this._permissions.can('user:create');
  public readonly canUpdate = this._permissions.can('user:update');
  public readonly canAssignAgency = this._permissions.can('user:assign-agency');
  public readonly canAssignRole = this._permissions.can('user:assign-role');
  private readonly _canReadAgencies = this._permissions.can('agency:read');

  private readonly _usersApiService = inject(UsersApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _search$ = new Subject<void>();

  public isLoading = signal(false);
  public users = signal<UserDto[]>([]);
  public searchQuery = signal('');
  public statusFilter = signal<UserStatus | undefined>(undefined);
  public agencyFilter = signal<string | undefined>(undefined);
  public agencies = signal<AgencyDto[]>([]);
  public showAllAgencies = signal(false);

  /** Invitations en attente, chargées à part pour compter celles qui ont expiré, toutes pages confondues. */
  public pendingUsers = signal<UserDto[]>([]);
  /** Invitations renvoyées depuis l'ouverture de l'écran : la ligne l'affiche sans attendre un rechargement. */
  public resentIds = signal<ReadonlySet<string>>(new Set());
  public resendingIds = signal<ReadonlySet<string>>(new Set());
  public isResendingExpired = signal(false);

  public userStatusStats = signal<UserStatusStatsDto>({
    total: 0,
    active: 0,
    disabled: 0,
    locked: 0,
    pendingActivation: 0,
  });

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  /**
   * Sélection multiple de la liste, portée par le `SelectionModel` du CDK comme
   * dans le design system (`table.ts`, `multi-select.ts`). Le comparateur sur
   * l'id est indispensable : chaque rechargement renvoie de nouveaux objets
   * `UserDto`, et l'égalité par référence perdrait la sélection.
   *
   * On conserve les DTO entiers, pas seulement les identifiants, parce que
   * `BulkUserOutcome` ne renvoie qu'un `userId` : nommer les utilisateurs
   * ignorés dans le compte rendu n'est possible qu'avec ce qui est affiché.
   */
  public readonly selection = new SelectionModel<UserDto>(true, [], true, (a, b) => a.id === b.id);

  /** Miroir en signal : `SelectionModel` n'est pas réactif. */
  public selectedUsers = signal<UserDto[]>([]);
  public readonly selectedCount = computed(() => this.selectedUsers().length);
  public readonly selectedIds = computed(() => new Set(this.selectedUsers().map((user) => user.id)));
  public readonly canBulkAssign = computed(() => this.canAssignAgency() || this.canAssignRole());

  /**
   * « Tout sélectionner » ne porte que sur la page affichée : la liste est
   * paginée côté serveur, le front n'a jamais les autres pages en mémoire et
   * les endpoints en masse veulent des identifiants explicites (200 au plus).
   */
  public readonly allOnPageSelected = computed(() => {
    const users = this.users();
    const selected = this.selectedIds();
    return users.length > 0 && users.every((user) => selected.has(user.id));
  });
  public readonly someOnPageSelected = computed(() => this.selectedCount() > 0 && !this.allOnPageSelected());

  public readonly rows = computed<MemberRow[]>(() => {
    const users = this.users();
    const resent = this.resentIds();
    // « Doublon possible » ne compare que la page affichée : le serveur ne signale pas les homonymes.
    const nameCount = new Map<string, number>();
    for (const u of users) {
      const key = this._normalize(u.fullName);
      if (key) nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
    }
    return users.map((u) => {
      const state = this._stateOf(u, resent);
      const style = STATE_STYLE[state];
      const roles = u.roleLabels?.length ? u.roleLabels : (u.roles ?? []);
      const email = u.email ?? '';
      const isDuplicate = (nameCount.get(this._normalize(u.fullName)) ?? 0) > 1;
      const isPending = u.status === 'PendingActivation';
      return {
        id: u.id ?? '',
        user: u,
        initials: u.fullName ?? email,
        name: u.fullName || email || '—',
        email,
        role: roles.length > 1 ? `${roles[0]}, +${roles.length - 1}` : (roles[0] ?? 'Aucun rôle'),
        rolesTitle: roles.join(', '),
        agency: u.agencyName ?? 'Sans agence',
        isAdmin: roles.some((r) => /admin/i.test(r)),
        isDuplicate,
        isTestAddress: !isDuplicate && email.split('@')[0].includes('+'),
        state,
        stateLabel: style.label,
        stateTone: style.tone,
        stateDot: style.dot,
        isPending,
        isResent: resent.has(u.id ?? ''),
        avatar: u.status === 'Active' ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-600',
      };
    });
  });

  public readonly statusOptions = computed(() => {
    const stats = this.userStatusStats();
    const current = this.statusFilter();
    return STATUS_FACET.map((o) => ({
      value: o.value,
      label: o.value === 'PendingActivation' ? 'Invitation en attente' : STATE_STYLE[o.state].label,
      dot: STATE_STYLE[o.state].dot,
      count: stats[o.stat] ?? 0,
      isSelected: current === o.value,
    }));
  });

  public readonly agencyOptions = computed(() => {
    const current = this.agencyFilter();
    const all = this.agencies().map((a) => ({
      value: a.id ?? '',
      label: a.isActive === false ? `${a.name ?? '—'} (désactivée)` : (a.name ?? '—'),
      isSelected: current === a.id,
    }));
    if (this.showAllAgencies() || all.length <= AGENCIES_SHOWN) return all;
    // L'agence filtrée reste visible même repliée, sinon on ne voit plus quoi décocher.
    const shown = all.slice(0, AGENCIES_SHOWN);
    const picked = all.find((a) => a.isSelected);
    return picked && !shown.includes(picked) ? [...shown, picked] : shown;
  });
  public readonly hiddenAgencyCount = computed(() =>
    this.showAllAgencies() ? 0 : Math.max(0, this.agencies().length - AGENCIES_SHOWN),
  );

  public readonly hasFilters = computed(() => !!this.statusFilter() || !!this.agencyFilter() || !!this.searchQuery().trim());

  public readonly summary = computed(() => {
    const stats = this.userStatusStats();
    const total = stats.total ?? 0;
    const shown = this.tableConfig().pagination.totalElements ?? 0;
    const actives = `${stats.active ?? 0} actif${(stats.active ?? 0) > 1 ? 's' : ''}`;
    if (!this.hasFilters()) return `${total} membre${total > 1 ? 's' : ''} · ${actives}`;
    return `${shown} membre${shown > 1 ? 's' : ''} affiché${shown > 1 ? 's' : ''} sur ${total} · ${actives}`;
  });

  public readonly pendingCount = computed(() => {
    const resent = this.resentIds();
    return this.pendingUsers().filter((u) => !resent.has(u.id ?? '')).length;
  });
  public readonly expiredUsers = computed(() => {
    const resent = this.resentIds();
    return this.pendingUsers().filter((u) => this._stateOf(u, resent) === 'expired');
  });

  constructor() {
    this.selection.changed
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.selectedUsers.set([...this.selection.selected]));
  }

  public ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'Utilisateurs' }]);

    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._applyFilters());

    const params = this._route.snapshot.queryParams;
    if (params['q']) this.searchQuery.set(params['q']);
    if (STATUS_FACET.some((o) => o.value === params['statut'])) this.statusFilter.set(params['statut']);
    if (params['agence']) this.agencyFilter.set(params['agence']);

    this.reloadCurrentPage();
    this._loadStats();
    this._loadPending();
    this._loadAgencies();
  }

  /**
   * La recherche texte passe par un debounce : sans lui, chaque frappe
   * déclenchait un appel HTTP. Les facettes restent immédiates.
   */
  public onSearchChange(query: string): void {
    this.searchQuery.set(query ?? '');
    this._search$.next();
  }

  /** Le serveur ne filtre que sur un statut et une agence à la fois : recliquer la valeur choisie la retire. */
  public pickStatus(status: UserStatus): void {
    this.statusFilter.set(this.statusFilter() === status ? undefined : status);
    this._applyFilters();
  }

  public pickAgency(agencyId: string): void {
    this.agencyFilter.set(this.agencyFilter() === agencyId ? undefined : agencyId);
    this._applyFilters();
  }

  public showPending(): void {
    this.statusFilter.set('PendingActivation');
    this._applyFilters();
  }

  public clearFilters(): void {
    this.searchQuery.set('');
    this.statusFilter.set(undefined);
    this.agencyFilter.set(undefined);
    this._applyFilters();
  }

  public refresh(): void {
    this.reloadCurrentPage();
    this._loadStats();
    this._loadPending();
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateUserComponent, {
      width: '100vw',
      panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((result) => {
      if (result) this.refresh();
    });
  }

  public resend(row: MemberRow): void {
    if (!row.id || this.resendingIds().has(row.id)) return;
    this.resendingIds.update((s) => new Set(s).add(row.id));
    this._usersApiService
      .resendUserInvitation(row.id)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbarService.error('Invitation non envoyée', err.error?.detail ?? 'Le lien n’a pas pu être renvoyé.');
          this._dropResending(row.id);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._dropResending(row.id);
        this.resentIds.update((s) => new Set(s).add(row.id));
        this._snackbarService.success('Invitation renvoyée', `${row.name} reçoit un nouveau lien. L’ancien ne fonctionne plus.`);
      });
  }

  /**
   * Il n'existe pas d'envoi groupé : les invitations partent une par une, en série,
   * pour ne pas saturer l'envoi de courriels, et le compte rendu dit combien ont échoué.
   */
  public resendExpired(): void {
    const targets = this.expiredUsers().filter((u) => !!u.id);
    if (targets.length === 0 || this.isResendingExpired()) return;
    this.isResendingExpired.set(true);
    from(targets)
      .pipe(
        concatMap((u) =>
          this._usersApiService.resendUserInvitation(u.id!).pipe(
            map(() => u.id!),
            catchError(() => of(null)),
          ),
        ),
        toArray(),
      )
      .subscribe((ids) => {
        const done = ids.filter((id): id is string => !!id);
        this.resentIds.update((s) => new Set([...s, ...done]));
        this.isResendingExpired.set(false);
        const failed = targets.length - done.length;
        if (failed === 0) {
          this._snackbarService.success('Invitations renvoyées', `${done.length} nouveau(x) lien(s) envoyé(s).`);
        } else {
          this._snackbarService.error('Envoi incomplet', `${done.length} renvoyée(s), ${failed} en échec. Réessayez depuis la ligne concernée.`);
        }
      });
  }

  public isResending(id: string): boolean {
    return this.resendingIds().has(id);
  }

  public toggleUser(user: UserDto): void {
    this.selection.toggle(user);
  }

  public toggleAllOnPage(): void {
    if (this.allOnPageSelected()) {
      this.selection.clear();
      return;
    }
    this.selection.select(...this.users());
  }

  public clearSelection(): void {
    this.selection.clear();
  }

  /**
   * Ouvre le drawer d'affectation en masse. Le mode décide de l'endpoint, du
   * référentiel chargé et de la permission exigée.
   */
  public openBulkAssignDrawer(mode: BulkAssignMode): void {
    const selected = this.selectedUsers();
    if (selected.length === 0) return;

    // La permission est retestée ici : masquer le bouton ne protège que
    // l'affichage, et cette méthode reste appelable.
    const requiredPermission = mode === 'agency' ? 'user:assign-agency' : 'user:assign-role';
    if (!this._permissions.has(requiredPermission)) return;

    // Le contrat plafonne les deux endpoints à 200 utilisateurs par envoi. La
    // plus grande page vaut 50, la garde est donc théorique — mais elle évite
    // un 400 muet si les tailles de page changent.
    if (selected.length > BULK_ASSIGN_MAX_USERS) {
      this._snackbarService.error(
        'Sélection trop large',
        `Le serveur traite au plus ${BULK_ASSIGN_MAX_USERS} utilisateurs par envoi.`,
      );
      return;
    }

    const data: BulkAssignDrawerData = {
      mode,
      users: selected.map((user) => ({
        id: user.id ?? '',
        fullName: user.fullName ?? '',
        email: user.email ?? '',
        agencyId: user.agencyId ?? null,
        roles: user.roles ?? [],
      })),
    };

    const ref = this._sideDrawerService.open(BulkAssignDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe(() => {
      // Rechargement inconditionnel : la croix du drawer (`closable-drawer`)
      // ferme avec `undefined`, la valeur de fermeture ne dit donc pas de façon
      // fiable si l'affectation a eu lieu. Un GET de trop coûte moins qu'une
      // colonne Agence ou Rôle périmée.
      this.reloadCurrentPage();
    });
  }

  public reloadCurrentPage(): void {
    this.loadUsers(this.tableConfig().pagination.pageIndex, this.tableConfig().pagination.pageSize);
  }

  public navigateToEdit(user: UserDto): void {
    this._router.navigate(['/settings/users', user.id]);
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize },
    }));
    this.loadUsers(event.pageIndex, event.pageSize);
  }

  public loadUsers(page: number, pageSize: number): void {
    // La sélection ne survit pas à un rechargement : elle ne porte que sur la
    // page affichée, et un changement de page, de filtre ou de recherche
    // remplace entièrement les lignes qui la composaient.
    this.selection.clear();
    this.isLoading.set(true);
    this._usersApiService
      .listUsers(this.statusFilter(), this.agencyFilter(), this.searchQuery().trim() || undefined, page + 1, pageSize)
      .subscribe({
        next: (result) => {
          this.users.set(result.items ?? []);
          this.tableConfig.update((c) => ({
            ...c,
            pagination: { ...c.pagination, totalElements: result.totalCount ?? 0 },
          }));
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  private _applyFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.searchQuery().trim() || null,
        statut: this.statusFilter() ?? null,
        agence: this.agencyFilter() ?? null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: 0 } }));
    this.loadUsers(0, this.tableConfig().pagination.pageSize);
  }

  private _loadStats(): void {
    this._usersApiService.getUserStatusStats().subscribe({
      next: (data) => this.userStatusStats.set(data),
    });
  }

  private _loadPending(): void {
    this._usersApiService
      .listUsers('PendingActivation', undefined, undefined, 1, PENDING_SCAN_SIZE)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => this.pendingUsers.set(result.items ?? []));
  }

  private _loadAgencies(): void {
    if (!this._canReadAgencies()) return;
    // Ordre du client généré : `listAgencies(includeDeleted, page, pageSize)` ; `pageSize = 0` renvoie tout.
    this._agenciesApiService
      .listAgencies(false, 1, 0)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => this.agencies.set(result.items ?? []));
  }

  private _dropResending(id: string): void {
    this.resendingIds.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  /**
   * `invitationExpiresAt` n'est aujourd'hui renseigné que par `GET /users/{id}` :
   * tant que la liste ne le renvoie pas, une invitation en attente s'affiche
   * « envoyée » et jamais « expirée ».
   */
  private _stateOf(u: UserDto, resent: ReadonlySet<string>): MemberState {
    switch (u.status) {
      case 'Active':
        return 'active';
      case 'Disabled':
        return 'disabled';
      case 'Locked':
        return 'locked';
    }
    if (resent.has(u.id ?? '')) return 'resent';
    const expiresAt = u.invitationExpiresAt ? new Date(u.invitationExpiresAt).getTime() : NaN;
    return expiresAt < Date.now() ? 'expired' : 'sent';
  }

  private _normalize(name: string | null | undefined): string {
    return (name ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  }
}

export default UsersHomePage;
