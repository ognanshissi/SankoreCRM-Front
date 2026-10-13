import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PageEvent } from '@angular/material/paginator';
import { catchError, of } from 'rxjs';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { AuditApiService, AuditEntryDto, UsersApiService } from '@sankore/crm-api';

/** Libellés des commandes auditées sur un utilisateur ; une commande inconnue garde son nom technique. */
const ACTIONS: Record<string, string | undefined> = {
  UpdateUserCommand: 'Informations modifiées',
  ResendInvitationCommand: 'Invitation renvoyée',
  AssignRoleCommand: 'Rôle attribué',
  RevokeRoleCommand: 'Rôle retiré',
  AssignScopedPermissionCommand: 'Permission attribuée',
  RevokeScopedPermissionCommand: 'Permission retirée',
  AssignManagerCommand: 'Responsable désigné',
  ClearManagerCommand: 'Responsable retiré',
  DeactivateUserCommand: 'Compte désactivé',
  ReactivateUserCommand: 'Compte réactivé',
  AdminResetPasswordCommand: 'Mot de passe réinitialisé',
  ImpersonateUserCommand: 'Usurpation d’identité',
  SetAgentCapacityCeilingCommand: 'Plafond de leads modifié',
};

const PAGE_SIZE = 20;

interface JournalRow {
  key: string;
  at: string | null;
  label: string;
  author: string;
  impersonator: string | null;
  failed: boolean;
  error: string | null;
}

/** Ce qui a été fait sur ce compte, d'après le journal d'audit (ressource « User »). */
@Component({
  selector: 'user-journal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TasTable],
  template: `
    <section class="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
      <h2 class="text-xl font-bold text-primary">Journal d'activité</h2>
      <p class="text-sm text-slate-600 mt-0.5">Les modifications faites sur ce compte, de la plus récente à la plus ancienne.</p>
      <div class="mt-4 overflow-x-auto">
        <tas-table [data]="rows()" identifierField="key" [config]="tableConfig()" [isLoading]="isLoading()" (pageEventChange)="onPage($event)">
          <ng-template #header>
            <tr class="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th class="py-2 pr-4 font-medium">Date</th>
              <th class="py-2 pr-4 font-medium">Action</th>
              <th class="py-2 pr-4 font-medium">Par</th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr class="text-sm align-top">
              <td class="py-2.5 pr-4 tabular-nums whitespace-nowrap text-slate-700">{{ row.at | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td class="py-2.5 pr-4">
                <span class="text-slate-900">{{ row.label }}</span>
                @if (row.failed) {
                  <span class="ml-2 px-2 py-0.5 rounded-full bg-red-50 text-functional-error text-xs" [attr.title]="row.error">Refusée</span>
                }
              </td>
              <td class="py-2.5 pr-4 text-slate-700">
                {{ row.author }}
                @if (row.impersonator) {
                  <span class="block text-xs text-amber-700">via {{ row.impersonator }} (usurpation)</span>
                }
              </td>
            </tr>
          </ng-template>
        </tas-table>
      </div>
    </section>
  `,
})
export class UserJournalPage {
  private readonly _auditApi = inject(AuditApiService);
  private readonly _usersApi = inject(UsersApiService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public entries = signal<AuditEntryDto[]>([]);
  public total = signal(0);
  public page = signal(1);
  private readonly _names = signal(new Map<string, string>());

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'key',
    pagination: { serverSide: true, pageIndex: this.page() - 1, pageSize: PAGE_SIZE, totalElements: this.total(), pageSizeOptions: [PAGE_SIZE] },
  }));

  public readonly rows = computed<JournalRow[]>(() => {
    const names = this._names();
    return this.entries().map((e, i) => ({
      key: e.id ?? String(i),
      at: e.timestamp ?? null,
      label: ACTIONS[e.action ?? ''] ?? e.action ?? 'Action',
      author: (e.userId && names.get(e.userId)) || 'Utilisateur inconnu',
      impersonator: e.impersonatorUserId ? names.get(e.impersonatorUserId) ?? 'un administrateur' : null,
      failed: e.outcome === 'FAILURE',
      error: e.errorDetail ?? null,
    }));
  });

  constructor() {
    // Les auteurs sont résolus sur la liste des utilisateurs, chargée une fois.
    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 500)
      .pipe(catchError(() => of({ items: [] })))
      .subscribe((page) =>
        this._names.set(new Map((page.items ?? []).filter((u) => !!u.id).map((u) => [u.id!, u.fullName ?? u.email ?? '']))),
      );

    effect(() => {
      this.id();
      this.page.set(1);
      this._load();
    });
  }

  public onPage(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this._load();
  }

  private _load(): void {
    this.isLoading.set(true);
    this._auditApi
      .getAuditEntries(undefined, undefined, 'User', this.id(), undefined, undefined, undefined, this.page(), PAGE_SIZE)
      .pipe(catchError(() => of(null)))
      .subscribe((page) => {
        this.entries.set(page?.items ?? []);
        this.total.set(page?.totalCount ?? 0);
        this.isLoading.set(false);
      });
  }
}

export default UserJournalPage;
