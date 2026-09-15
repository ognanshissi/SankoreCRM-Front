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
      <div class="pb-6 flex flex-col gap-4">
        <h1 class="text-lg font-semibold text-slate-800">Zone de danger</h1>

        @if (isSystem()) {
          <tas-card>
            <div class="flex items-start gap-3 p-4">
              <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                <tas-icon iconName="feather:lock" class="text-slate-400" style="font-size:14px"></tas-icon>
              </div>
              <div>
                <p class="text-sm font-medium text-slate-700">Rôle système protégé</p>
                <p class="text-sm text-slate-500 mt-0.5">
                  Ce rôle fait partie des rôles système de la plateforme et ne peut pas être supprimé.
                </p>
              </div>
            </div>
          </tas-card>
        } @else {
          <tas-card>
            <div class="p-4 flex items-start justify-between gap-4">
              <div>
                <p class="text-sm font-semibold text-red-600">Supprimer ce rôle</p>
                <p class="text-sm text-slate-500 mt-1">
                  Suppression définitive et irréversible. Impossible tant que des utilisateurs ont ce rôle.
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
          </tas-card>
        }
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
