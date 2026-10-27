import { Component, computed, DestroyRef, inject, Injectable, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { MyProfileDto, UsersApiService } from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService, PermissionsService } from '@sankore/crm/common';

export type AgentAvailabilityCode = 'Available' | 'Paused' | 'Absent';

/**
 * État partagé entre l'en-tête « Mon compte » et ses onglets. Les onglets y poussent ce qu'ils
 * viennent d'enregistrer (statut, nom, photo) pour que l'en-tête ne contredise pas la sauvegarde.
 * Fourni par la coque, donc propre à cette page.
 */
@Injectable()
export class AccountHeaderState {
  public readonly availability = signal<AgentAvailabilityCode | null>(null);
  public readonly profile = signal<MyProfileDto | null>(null);
}

const AVAILABILITY_PILL: Record<AgentAvailabilityCode, { label: string; classes: string; dot: string }> = {
  Available: { label: 'Disponible', classes: 'bg-green-50 text-green-700', dot: 'bg-green-600' },
  Paused: { label: 'En pause', classes: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  Absent: { label: 'Absent', classes: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
};

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  providers: [AccountHeaderState],
  template: `
    <div class="flex flex-col gap-5 pb-6">
      <!-- En-tête : qui, rôle, agence, statut -->
      <div class="flex flex-wrap items-center gap-4 p-6 rounded-2xl bg-white shadow-sm border border-slate-100">
        @if (avatarUrl(); as url) {
          <img [src]="url" alt="" class="w-14 h-14 rounded-full object-cover shrink-0" />
        } @else {
          <div class="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-lg font-bold text-primary shrink-0">
            {{ initials() }}
          </div>
        }
        <div class="min-w-0 flex-1">
          <p class="text-lg font-semibold text-slate-900 truncate">{{ userName() }}</p>
          <p class="text-sm text-slate-500 truncate">{{ subtitle() }}</p>
        </div>
        @if (pill(); as p) {
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" [class]="p.classes">
            <span class="w-1.5 h-1.5 rounded-full" [class]="p.dot"></span>
            {{ p.label }}
          </span>
        }
      </div>

      <!-- Onglets -->
      <nav class="flex gap-1 border-b border-slate-200 overflow-x-auto" aria-label="Sections du compte">
        @for (tab of tabs(); track tab.route) {
          <a
            [routerLink]="tab.route"
            routerLinkActive="!text-primary !border-primary font-semibold"
            class="px-4 py-3 text-sm text-slate-600 border-b-2 border-transparent -mb-px whitespace-nowrap hover:text-slate-900"
          >
            {{ tab.label }}
          </a>
        }
      </nav>

      <router-outlet></router-outlet>
    </div>
  `,
})
export class AccountNavigation implements OnInit {
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _breadcrumbOwner = inject(DestroyRef);
  private readonly _auth = inject(AuthenticationService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _state = inject(AccountHeaderState);

  private readonly _canConnectAccounts = inject(PermissionsService).can('ConnectedAccounts.Use');

  public readonly tabs = computed(() => [
    { label: 'Informations', route: 'profil' },
    { label: 'Sécurité', route: 'securite' },
    { label: 'Paramétrage agent', route: 'agent' },
    { label: 'Performance', route: 'performance' },
    ...(this._canConnectAccounts() ? [{ label: 'Agendas et messagerie', route: 'agendas' }] : []),
  ]);

  public readonly userName = computed(() => {
    const profile = this._state.profile();
    const connected = this._auth.connectedUser();
    const fromProfile = [profile?.firstName, profile?.lastName].filter((v) => !!v).join(' ');
    return fromProfile || connected?.fullName || connected?.email || 'Utilisateur';
  });

  public readonly avatarUrl = computed(() => this._state.profile()?.avatarDataUrl ?? null);

  public readonly initials = computed(() => {
    const parts = this.userName().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  });

  public readonly subtitle = computed(() =>
    [
      this._state.profile()?.roleLabel,
      this._state.profile()?.agencyName,
      this._state.profile()?.email ?? this._auth.connectedUser()?.email,
    ]
      .filter((v) => !!v)
      .join(' · '),
  );

  public readonly pill = computed(() => {
    const status = this._state.availability();
    return status ? AVAILABILITY_PILL[status] : null;
  });

  ngOnInit(): void {
    this._breadcrumbService.setForTabs([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Mon compte' },
    ], this._breadcrumbOwner);

    // Ce qui vient de « me » plutôt que de GET users/{id} et GET roles : un agent n'a pas
    // forcément le droit de lire les utilisateurs ou les rôles, mais doit voir son propre en-tête.
    forkJoin({
      profile: this._usersApi.getMyProfile().pipe(catchError(() => of(null))),
      settings: this._usersApi.getMyAgentSettings().pipe(catchError(() => of(null))),
    }).subscribe(({ profile, settings }) => {
      // Ne pas écraser ce que l'onglet aurait déjà publié entre-temps.
      if (profile && !this._state.profile()) this._state.profile.set(profile);
      if (settings?.availability && !this._state.availability()) {
        this._state.availability.set(settings.availability as AgentAvailabilityCode);
      }
    });
  }
}

export default AccountNavigation;
