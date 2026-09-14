import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { RolesApiService, RoleDetailDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';

@Component({
  selector: 'role-danger',
  imports: [TasCard, Button, TasIcon, TasSpinner],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6">
        <tas-card>
          <div class="p-4">
            @if (isSystem()) {
              <div class="flex gap-3 p-4 rounded-lg bg-slate-50 border border-slate-200">
                <tas-icon iconName="feather:info" class="text-slate-400 shrink-0 mt-0.5"></tas-icon>
                <p class="text-sm text-slate-600">Les rôles système ne peuvent pas être supprimés.</p>
              </div>
            } @else {
              <div class="flex items-start justify-between gap-4 p-4 rounded-lg border border-functional-error/20 bg-functional-error/5">
                <div>
                  <p class="font-medium text-warn">Supprimer le rôle</p>
                  <p class="text-sm text-slate-500 mt-1">
                    Supprime définitivement ce rôle. Impossible si des utilisateurs y sont encore assignés.
                  </p>
                </div>
                <button
                  tas-outlined-button
                  color="warn"
                  type="button"
                  [disabled]="isDeleting()"
                  [isLoading]="isDeleting()"
                  (click)="confirmDelete()"
                  class="shrink-0"
                >
                  <tas-icon iconName="feather:trash-2" iconSize="sm"></tas-icon>
                  Supprimer
                </button>
              </div>
            }
          </div>
        </tas-card>
      </div>
    }
  `,
})
export class RoleDangerPage {
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isDeleting = signal(false);
  public role = signal<RoleDetailDto | null>(null);

  public isSystem = computed(() => this.role()?.isSystem === true);

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._rolesApiService.getRole(this.id()).subscribe({
        next: (role) => {
          this.role.set(role);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
    });
  }

  public confirmDelete(): void {
    this._confirmDialogService.confirm({
      title: 'Supprimer le rôle',
      message: `Supprimer le rôle "${this.role()?.label ?? this.role()?.name}" ? Cette action est irréversible et impossible si des utilisateurs ont ce rôle.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isDeleting.set(true);
        this._rolesApiService
          .deleteRole(this.id())
          .pipe(catchError(() => {
            this._snackbarService.error('Erreur', 'Impossible de supprimer le rôle.');
            this.isDeleting.set(false);
            return EMPTY;
          }))
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Rôle supprimé.');
            this._router.navigate(['/settings/roles']);
          });
      },
    });
  }
}

export default RoleDangerPage;
