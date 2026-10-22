import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { catchError, EMPTY, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Button } from '@talisoft/ui/button';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { AuditApiService, InvitationSentDto, UsersApiService } from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { EditUserState } from './edit-user-state';
import { ImpersonateDialog, ImpersonateDialogData } from './impersonate-dialog';

type StatusCode = 'PendingActivation' | 'Active' | 'Disabled' | 'Locked';

const STATUS: Record<StatusCode, { label: string; classes: string; dot: string }> = {
  PendingActivation: { label: "En attente d'activation", classes: 'bg-blue-50 text-blue-700', dot: 'bg-blue-600' },
  Active: { label: 'Actif', classes: 'bg-green-50 text-green-700', dot: 'bg-green-600' },
  Disabled: { label: 'Désactivé', classes: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  Locked: { label: 'Verrouillé', classes: 'bg-red-50 text-red-700', dot: 'bg-red-600' },
};

const ACCOUNT_TYPES: Record<string, string | undefined> = {
  Standard: 'Profil Standard',
  System: 'Profil Système',
  Service: 'Compte de service',
};

const DAY_MS = 24 * 60 * 60 * 1000;

@Component({
  imports: [DatePipe, RouterLink, RouterLinkActive, RouterOutlet, TasIcon, TasSpinner, Button, Menu, MenuItem, TasMenuTrigger],
  providers: [EditUserState],
  template: `
    <div class="flex flex-col gap-5 pb-6">
      <a [routerLink]="['/settings/users']" class="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-primary w-fit">
        <tas-icon iconName="feather:chevron-left" style="font-size:14px"></tas-icon>
        <span class="font-medium text-primary">Utilisateurs</span> <span class="text-slate-400">/</span> Paramétrage
      </a>

      @if (state.isLoading() && !user()) {
        <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
      } @else if (user(); as u) {
        <!-- En-tête -->
        <section class="flex flex-wrap items-center gap-4 p-6 rounded-2xl bg-white shadow-sm border border-slate-100">
          @if (u.avatarDataUrl) {
            <img [src]="u.avatarDataUrl" alt="" class="w-16 h-16 rounded-full object-cover shrink-0" />
          } @else {
            <div class="w-16 h-16 rounded-full bg-slate-100 text-primary text-xl font-bold flex items-center justify-center shrink-0">{{ initials() }}</div>
          }
          <div class="flex-1 min-w-0">
            <p class="text-sm text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
              @if (status(); as s) {
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold" [class]="s.classes">
                  <span class="w-1.5 h-1.5 rounded-full" [class]="s.dot"></span>{{ s.label }}
                </span>
              }
              <span>{{ u.email }}</span>
              @if (roleAndAgency()) { <span>{{ roleAndAgency() }}</span> }
              <span>{{ accountType() }}</span>
            </p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            @if (isPending() && canUpdate()) {
              <button tas-raised-button color="primary" type="button" class="!rounded-full"
                [disabled]="isResending()" [isLoading]="isResending()" (click)="resendInvitation()">
                <tas-icon iconName="feather:send" style="font-size:14px"></tas-icon>
                {{ resent() ? 'Invitation renvoyée' : "Renvoyer l'invitation" }}
              </button>
            }
            @if (canImpersonate() && u.status === 'Active' && !isSelf() && !auth.impersonation()) {
              <button tas-outlined-button type="button" class="!rounded-full" (click)="impersonate()">Se faire passer pour</button>
            }
            <button tas-outlined-button iconButton type="button" class="!rounded-full" TasMenuTrigger [panel]="moreMenu" aria-label="Plus d'actions">
              <tas-icon iconName="feather:more-horizontal" style="font-size:16px"></tas-icon>
            </button>
            <ng-template #moreMenu>
              <tas-menu>
                <tas-menu-item>
                  <a [routerLink]="['connexions']" class="w-full flex items-center gap-2 text-sm text-slate-700">
                    <tas-icon iconName="feather:log-in" style="font-size:14px" class="text-slate-400"></tas-icon>
                    Voir les connexions
                  </a>
                </tas-menu-item>
                <tas-menu-item>
                  <a [routerLink]="['danger']" class="w-full flex items-center gap-2 text-sm text-slate-700">
                    <tas-icon iconName="feather:key" style="font-size:14px" class="text-slate-400"></tas-icon>
                    Réinitialiser le mot de passe
                  </a>
                </tas-menu-item>
                <tas-menu-item>
                  <a [routerLink]="['danger']" class="w-full flex items-center gap-2 text-sm text-red-600">
                    <tas-icon iconName="feather:slash" style="font-size:14px" class="text-red-400"></tas-icon>
                    Suspendre ou désactiver
                  </a>
                </tas-menu-item>
              </tas-menu>
            </ng-template>
          </div>
        </section>

        <!-- Bandeau d'activation -->
        @if (isPending()) {
          <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white border border-slate-100 border-t-4 border-t-cyan-400 text-sm text-slate-700" role="status">
            <p>
              <strong class="text-slate-900">Compte en attente d'activation.</strong>
              @if (u.invitationSentAt) {
                Invitation envoyée le {{ u.invitationSentAt | date: 'd MMM yyyy' }},
                @if (expiresInDays() !== null && expiresInDays()! > 0) {
                  le lien expire dans {{ expiresInDays() }} jour{{ expiresInDays()! > 1 ? 's' : '' }}.
                } @else {
                  <span class="text-functional-error font-medium">le lien a expiré.</span>
                }
              }
              {{ firstName() }} ne recevra aucun lead tant que son compte n'est pas activé.
            </p>
            @if (resent(); as r) {
              <p class="text-xs text-slate-500">Nouveau lien envoyé à l'instant, valable {{ validityHours(r) }} h.</p>
            }
          </div>
        }

        <div class="grid grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)] gap-5 items-start">
          <!-- Navigation -->
          <nav class="rounded-2xl bg-white shadow-sm border border-slate-100 p-2 flex flex-col gap-1" aria-label="Sections de la fiche">
            @for (item of sections(); track item.route) {
              <a [routerLink]="[item.route]" routerLinkActive="!bg-slate-100 !border-primary"
                class="block px-4 py-2.5 rounded-lg border-l-4 border-transparent hover:bg-slate-50">
                <span class="block text-sm font-semibold" [class.text-functional-error]="item.danger" [class.text-slate-900]="!item.danger">{{ item.label }}</span>
                <span class="block text-xs text-slate-500 mt-0.5">{{ item.hint }}</span>
              </a>
              @if (item.route === 'journal') {
                <div class="mx-3 my-1 border-t border-slate-100"></div>
              }
            }
          </nav>

          <div class="min-w-0">
            <router-outlet></router-outlet>
          </div>
        </div>
      } @else {
        <p class="text-sm text-slate-600 py-24 text-center">Cet utilisateur n'a pas pu être chargé.</p>
      }
    </div>
  `,
})
export class EditUserNavigation {
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auditApi = inject(AuditApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _breadcrumbOwner = inject(DestroyRef);
  private readonly _permissions = inject(PermissionsService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  public readonly auth = inject(AuthenticationService);
  public readonly state = inject(EditUserState);

  public readonly id = input.required<string>();

  public readonly canUpdate = this._permissions.can('user:update');
  public readonly canImpersonate = this._permissions.can('user:impersonate');
  public readonly canReadAudit = this._permissions.can('audit:read');

  public readonly user = this.state.user;
  public isResending = signal(false);
  public resent = signal<InvitationSentDto | null>(null);
  public auditCount = signal<number | null>(null);

  public readonly isPending = computed(() => this.user()?.status === 'PendingActivation');
  public readonly isSelf = computed(() => this.auth.connectedUser()?.id === this.user()?.id);
  public readonly status = computed(() => STATUS[(this.user()?.status ?? '') as StatusCode] ?? null);
  public readonly accountType = computed(() => ACCOUNT_TYPES[this.user()?.accountType ?? ''] ?? this.user()?.accountType ?? '');
  public readonly firstName = computed(() => this.user()?.firstName || this.user()?.fullName?.split(' ')[0] || 'Cet utilisateur');

  public readonly initials = computed(() => {
    const u = this.user();
    const name = [u?.firstName, u?.lastName].filter((v) => !!v).join(' ') || u?.fullName || u?.email || '';
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  });

  public readonly roleAndAgency = computed(() =>
    [this.user()?.roleLabels?.[0], this.user()?.agencyName].filter((v) => !!v).join(' · '),
  );

  public readonly expiresInDays = computed(() => {
    const at = this.resent()?.expiresAt ?? this.user()?.invitationExpiresAt;
    if (!at) return null;
    return Math.ceil((new Date(at).getTime() - Date.now()) / DAY_MS);
  });

  public readonly sections = computed(() => {
    const u = this.user();
    const role = u?.roleLabels?.[0] ?? 'Aucun rôle';
    const attributions = u?.activeAttributionsCount ?? 0;
    const items = [
      { route: 'informations', label: 'Informations', hint: 'Identité, agence, hiérarchie', danger: false },
      {
        route: 'roles',
        label: 'Rôles et permissions',
        hint: attributions ? `${role} · ${attributions} attribution${attributions > 1 ? 's' : ''}` : role,
        danger: false,
      },
      { route: 'parametrage', label: 'Paramétrage agent', hint: 'Produits, plafond de leads', danger: false },
      {
        route: 'connexions',
        label: 'Connexions et sécurité',
        hint: u?.lastLoginAt ? `Dernière le ${new Date(u.lastLoginAt).toLocaleDateString('fr-FR')}` : 'Aucune connexion',
        danger: false,
      },
    ];
    if (this.canReadAudit()) {
      const count = this.auditCount();
      items.push({
        route: 'journal',
        label: "Journal d'activité",
        hint: count === null ? 'Modifications du compte' : `${count} modification${count > 1 ? 's' : ''}`,
        danger: false,
      });
    }
    items.push({ route: 'danger', label: 'Zone de danger', hint: 'Suspendre, désactiver', danger: true });
    return items;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.state.load(id);
      this.resent.set(null);
      if (this.canReadAudit()) {
        this._auditApi
          .getAuditEntries(undefined, undefined, 'User', id, undefined, undefined, undefined, 1, 1)
          .pipe(catchError(() => of(null)))
          .subscribe((page) => this.auditCount.set(page?.totalCount ?? null));
      }
    });

    effect(() => {
      const u = this.user();
      if (!u) return;
      this._breadcrumb.setForTabs([
        { label: 'Paramétrage', link: ['/settings'] },
        { label: 'Utilisateurs', link: ['/settings/users'] },
        { label: u.fullName ?? u.email ?? 'Utilisateur' },
      ], this._breadcrumbOwner);
    });
  }

  public validityHours(sent: InvitationSentDto): number {
    return Math.round((new Date(sent.expiresAt ?? 0).getTime() - new Date(sent.sentAt ?? 0).getTime()) / 3_600_000);
  }

  public resendInvitation(): void {
    const id = this.user()?.id;
    if (!id) return;
    this.isResending.set(true);
    this._usersApi
      .resendUserInvitation(id)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Invitation non envoyée', err.error?.detail ?? 'Le lien n’a pas pu être renvoyé.');
          this.isResending.set(false);
          return EMPTY;
        }),
      )
      .subscribe((sent) => {
        this.isResending.set(false);
        this.resent.set(sent);
        this._snackbar.success('Invitation renvoyée', 'Les liens envoyés précédemment ne fonctionnent plus.');
        this.state.reload();
      });
  }

  public impersonate(): void {
    const u = this.user();
    if (!u?.id) return;
    this._drawer.open<boolean, ImpersonateDialogData, ImpersonateDialog>(ImpersonateDialog, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { userId: u.id, userName: u.fullName ?? u.email ?? 'cet utilisateur' },
    });
  }
}

export default EditUserNavigation;
