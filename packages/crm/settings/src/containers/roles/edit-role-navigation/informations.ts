import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { RolesApiService, RoleDetailDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

@Component({
  selector: 'role-informations',
  imports: [NgClass, TasCard, Button, TasFormField, TasLabel, TasInput, TasSpinner],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (role()) {
      <div class="py-6">
        <tas-card>
          <div class="p-4 flex flex-col gap-5">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Nom technique</p>
                <p class="font-medium text-slate-800">{{ role()!.name }}</p>
              </div>
              <div>
                <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Type</p>
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  [ngClass]="{
                    'bg-slate-100 text-slate-600': role()!.isSystem,
                    'bg-blue-100 text-blue-700': !role()!.isSystem
                  }"
                >
                  {{ role()!.isSystem ? 'Système' : 'Personnalisé' }}
                </span>
              </div>
              <div>
                <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Assignable</p>
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                  [ngClass]="{
                    'bg-green-100 text-green-700': role()!.isAssignable,
                    'bg-slate-100 text-slate-500': !role()!.isAssignable
                  }"
                >
                  {{ role()!.isAssignable ? 'Oui' : 'Non' }}
                </span>
              </div>
              <div>
                <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Permissions</p>
                <p class="font-medium text-slate-800">{{ role()!.permissions?.length ?? 0 }}</p>
              </div>
            </div>

            @if (!isSystem()) {
              <div class="border-t border-gray-200 pt-4">
                <p class="text-sm font-medium text-slate-700 mb-3">Modifier le libellé</p>
                <div class="flex gap-3 items-start">
                  <div class="flex-1">
                    <tas-form-field>
                      <tas-label>Libellé</tas-label>
                      <input
                        tasInput
                        type="text"
                        placeholder="Libellé affiché aux utilisateurs"
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
                    Enregistrer
                  </button>
                </div>
              </div>
            }
          </div>
        </tas-card>
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
