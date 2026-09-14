import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { UsersApiService, ProductsApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';

const LANGUAGE_OPTIONS = [
  { label: 'Français', value: 'fr' },
  { label: 'English', value: 'en' }
];

@Component({
  selector: 'user-parametrage',
  imports: [FormsModule, TasCard, Button, TasFormField, TasLabel, TasMultiSelect, TasSpinner],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">

        <tas-card>
          <div class="p-4 flex flex-col gap-5">
            <p class="text-sm font-semibold text-slate-700">Langue & Spécialités</p>

            <tas-form-field>
              <tas-label>Langues parlées</tas-label>
              <tas-multi-select
                [options]="languageOptions"
                placeholder="Sélectionnez des langues"
                [ngModel]="spokenLanguages()"
                (ngModelChange)="spokenLanguages.set($event)"
              ></tas-multi-select>
            </tas-form-field>

            <tas-form-field>
              <tas-label>Spécialités</tas-label>
              <tas-multi-select
                [options]="specialtyOptions()"
                placeholder="Sélectionnez des spécialités"
                [ngModel]="specialties()"
                (ngModelChange)="specialties.set($event)"
              ></tas-multi-select>
            </tas-form-field>

            <div class="flex justify-end">
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="isSaving()"
                [isLoading]="isSaving()"
                (click)="save()">
                Enregistrer
              </button>
            </div>
          </div>
        </tas-card>

        <!-- Notifications -->
        <tas-card>
          <div class="p-4 flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-semibold text-slate-700">Notifications</p>
              <p class="text-xs text-slate-500 mt-1">Activer les notifications pour cet utilisateur.</p>
            </div>
            <button
              type="button"
              class="relative flex-shrink-0 w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
              [class.bg-primary]="enableNotifications()"
              [class.bg-slate-200]="!enableNotifications()"
              (click)="toggleNotifications()"
              [disabled]="isSavingNotifications()"
            >
              <span
                class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform"
                [class.translate-x-6]="enableNotifications()"
              ></span>
            </button>
          </div>
        </tas-card>

      </div>
    }
  `,
})
export class UserParametragePage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly id = input.required<string>();

  public readonly languageOptions = LANGUAGE_OPTIONS;

  public isLoading = signal(true);
  public isSaving = signal(false);
  public isSavingNotifications = signal(false);

  public spokenLanguages = signal<string[]>([]);
  public specialties = signal<string[]>([]);
  public enableNotifications = signal(false);
  public specialtyOptions = signal<{ label: string; value: string }[]>([]);

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      forkJoin({
        user: this._usersApiService.getUser(this.id()),
        products: this._productsApiService.listProducts(),
      }).subscribe({
        next: ({ user, products }) => {
          this.spokenLanguages.set(user.spokenLanguages ?? []);
          this.specialties.set(user.specialties ?? []);
          this.enableNotifications.set(user.enableNotifications ?? false);
          this.specialtyOptions.set(
            (products ?? []).map((p) => ({ label: p.name ?? p.code ?? '', value: p.code ?? '' }))
          );
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
    });
  }

  public save(): void {
    this.isSaving.set(true);
    this._usersApiService
      .updateUser(this.id(), {
        spokenLanguages: this.spokenLanguages(),
        specialties: this.specialties(),
      })
      .pipe(catchError(() => {
        this._snackbarService.error('Erreur', 'Impossible de mettre à jour les paramètres.');
        this.isSaving.set(false);
        return EMPTY;
      }))
      .subscribe(() => {
        this._snackbarService.success('Succès', 'Paramètres mis à jour.');
        this.isSaving.set(false);
      });
  }

  public toggleNotifications(): void {
    const next = !this.enableNotifications();
    this.isSavingNotifications.set(true);
    this._usersApiService
      .updateUser(this.id(), { enableNotifications: next })
      .pipe(catchError(() => {
        this._snackbarService.error('Erreur', 'Impossible de mettre à jour les notifications.');
        this.isSavingNotifications.set(false);
        return EMPTY;
      }))
      .subscribe(() => {
        this.enableNotifications.set(next);
        this.isSavingNotifications.set(false);
      });
  }
}

export default UserParametragePage;
