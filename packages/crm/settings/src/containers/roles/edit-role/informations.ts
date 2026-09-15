import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { RolesApiService, RoleDetailDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

@Component({
  selector: 'role-informations',
  imports: [TasCard, Button, TasIcon, TasFormField, TasLabel, TasInput, TasSpinner, TasTag],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (role()) {
      <div class="pb-6 flex flex-col gap-4">

        <!-- Read-only metadata strip -->
        <tas-card>
          <div class="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <p class="text-xs text-slate-400 mb-1">Nom technique</p>
              <p class="font-mono text-sm font-medium text-slate-800">{{ role()!.name }}</p>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Type</p>
              <tas-tag [severity]="role()!.isSystem ? 'neutral' : 'info'">
                {{ role()!.isSystem ? 'Système' : 'Personnalisé' }}
              </tas-tag>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Assignable aux utilisateurs</p>
              <tas-tag [severity]="role()!.isAssignable ? 'success' : 'neutral'">
                {{ role()!.isAssignable ? 'Oui' : 'Non' }}
              </tas-tag>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Permissions accordées</p>
              <p class="text-sm font-medium text-slate-800">{{ role()!.permissions?.length ?? 0 }}</p>
            </div>
          </div>
        </tas-card>

        <!-- Edit label (custom roles only) -->
        @if (!isSystem()) {
          <tas-card>
            <div class="p-4 flex flex-col gap-3">
              <p class="text-sm font-semibold text-slate-700">Modifier le libellé</p>
              <div class="flex gap-3 items-start">
                <div class="flex-1">
                  <tas-form-field>
                    <tas-label>Libellé affiché aux utilisateurs</tas-label>
                    <input
                      tasInput
                      type="text"
                      placeholder="ex: Responsable commercial"
                      [value]="editedLabel()"
                      (input)="editedLabel.set($any($event.target).value)"
                    />
                  </tas-form-field>
                </div>
                <button
                  tas-raised-button
                  color="primary"
                  type="button"
                  [disabled]="!editedLabel().trim() || isSavingLabel()"
                  [isLoading]="isSavingLabel()"
                  (click)="saveLabel()"
                  class="mt-6 shrink-0"
                >
                  <tas-icon iconName="feather:save" iconSize="sm"></tas-icon>
                  Enregistrer
                </button>
              </div>
            </div>
          </tas-card>
        }
      </div>
    }
  `,
})
export class RoleInformationsPage {
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isSavingLabel = signal(false);
  public role = signal<RoleDetailDto | null>(null);
  public editedLabel = signal('');

  public isSystem = computed(() => this.role()?.isSystem === true);

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._rolesApiService.getRole(this.id()).subscribe({
        next: (role) => {
          this.role.set(role);
          this.editedLabel.set(role.label ?? '');
          this.isLoading.set(false);
        },
        error: () => {
          this._snackbarService.error('Erreur', 'Impossible de charger le rôle.');
          this.isLoading.set(false);
        },
      });
    });
  }

  public saveLabel(): void {
    const label = this.editedLabel().trim();
    if (!label) return;
    this.isSavingLabel.set(true);
    this._rolesApiService
      .updateRole(this.id(), { label })
      .pipe(
        catchError(() => {
          this._snackbarService.error('Erreur', 'Impossible de mettre à jour le libellé.');
          this.isSavingLabel.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbarService.success('Succès', 'Libellé mis à jour.');
        this.role.update((r) => (r ? { ...r, label } : r));
        this.isSavingLabel.set(false);
      });
  }
}

export default RoleInformationsPage;
