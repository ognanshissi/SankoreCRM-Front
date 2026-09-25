import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SecretHintDto } from '@sankore/crm-api';
import { LeadSourcesService } from '../lead-sources.service';

/**
 * FE-18 / FE-19 — Saisie et remplacement des secrets d'une source.
 *
 * Jusqu'ici le formulaire de secret vivait dans `webhook-connection` et ne
 * savait que REMPLACER un secret existant : une source `ScheduledPull` ne
 * pouvait donc jamais recevoir sa premiere cle API. Ce composant expose des
 * « emplacements » (`slots`) attendus par le mode, qu'ils soient deja
 * configures ou non, et liste en plus les secrets inattendus.
 */
export interface SecretSlot {
  /** Nom technique, tel qu'attendu par l'API (`setLeadSourceSecret`). */
  name: string;
  label: string;
  description?: string;
  /** Propose un bouton « Générer » (FE-18 AC2). */
  generatable?: boolean;
}

interface SecretRow {
  slot: SecretSlot;
  hint: SecretHintDto | null;
}

@Component({
  selector: 'source-secrets',
  standalone: true,
  imports: [
    FormsModule, TasCard, TasIcon, Button,
    TasFormField, TasLabel, TasInput, TasInputPassword,
  ],
  template: `
    <tas-card class="block">
      <div class="p-4 border-b border-slate-100">
        <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <tas-icon iconName="feather:lock" class="text-slate-400" style="font-size:14px"></tas-icon>
          {{ title() }}
        </p>
        @if (subtitle()) {
          <p class="text-xs text-slate-400 mt-0.5">{{ subtitle() }}</p>
        }
      </div>

      <div class="p-4 flex flex-col gap-3">
        @if (rows().length === 0) {
          <p class="text-xs text-slate-400">Aucun secret requis pour cette configuration.</p>
        }

        @for (row of rows(); track row.slot.name) {
          <div class="p-3 bg-slate-50 rounded-lg flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-medium text-slate-700">{{ row.slot.label }}</p>
              @if (row.slot.description) {
                <p class="text-[10px] text-slate-400 mt-0.5">{{ row.slot.description }}</p>
              }
              @if (row.hint) {
                <p class="text-xs text-slate-500 font-mono mt-1">{{ row.hint.hint }}</p>
                @if (row.hint.expiresAt) {
                  <p class="text-[10px] text-amber-500 mt-0.5">Expire : {{ row.hint.expiresAt }}</p>
                }
              } @else {
                <p class="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                  <tas-icon iconName="feather:alert-triangle" style="font-size:10px"></tas-icon>
                  Non configuré
                </p>
              }
            </div>
            @if (canManage() && !readonly()) {
              <button tas-outlined-button type="button" class="text-xs shrink-0"
                      (click)="startEditing(row.slot)">
                <tas-icon [iconName]="row.hint ? 'feather:edit-2' : 'feather:plus'" style="font-size:10px"></tas-icon>
                {{ row.hint ? 'Remplacer' : 'Définir' }}
              </button>
            }
          </div>
        }

        <!-- Formulaire de saisie (FE-18 AC2 : valeur + expiration + confirmation) -->
        @if (editingSlot(); as slot) {
          <div class="p-3 border border-slate-200 rounded-lg flex flex-col gap-3">
            <p class="text-xs font-medium text-slate-700">
              {{ hintFor(slot.name) ? 'Remplacer' : 'Définir' }} « {{ slot.label }} »
            </p>

            <tas-input-password placeholder="Valeur du secret" [(value)]="secretValue">
              Valeur
            </tas-input-password>

            @if (slot.generatable) {
              <div>
                <button tas-outlined-button type="button" class="text-xs" (click)="generate()">
                  <tas-icon iconName="feather:refresh-cw" style="font-size:10px"></tas-icon>
                  Générer une valeur
                </button>
              </div>
            }

            <tas-input-password placeholder="Ressaisissez la valeur" [(value)]="secretConfirm">
              Confirmation
            </tas-input-password>
            @if (mismatch()) {
              <p class="text-xs text-red-500">Les deux valeurs ne correspondent pas.</p>
            }

            <tas-form-field>
              <tas-label>Expiration (optionnel)</tas-label>
              <input tasInput type="datetime-local"
                     [ngModel]="secretExpiry()" (ngModelChange)="secretExpiry.set($event)" />
            </tas-form-field>

            <div class="flex justify-end gap-2">
              <button tas-outlined-button type="button" (click)="cancel()">Annuler</button>
              <button tas-raised-button color="primary" type="button"
                      [disabled]="!canSubmit()"
                      [isLoading]="isSaving()"
                      (click)="save()">
                Enregistrer
              </button>
            </div>
          </div>
        }
      </div>
    </tas-card>
  `,
})
export class SourceSecrets {
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly sourceId = input.required<string>();
  /** Secrets deja configures, tels que renvoyes par le detail. */
  public readonly secrets = input<SecretHintDto[]>([]);
  /** Emplacements attendus par le mode courant. */
  public readonly slots = input<SecretSlot[]>([]);
  /** Noms a ignorer (ex. `hmac`, gere par son propre bloc de rotation). */
  public readonly ignore = input<string[]>([]);
  public readonly canManage = input(true);
  public readonly readonly = input(false);
  public readonly title = input('Secrets');
  public readonly subtitle = input('');

  public readonly secretSaved = output<string>();

  public editingSlot = signal<SecretSlot | null>(null);
  public secretValue = signal('');
  public secretConfirm = signal('');
  public secretExpiry = signal('');
  public isSaving = signal(false);

  /**
   * Les emplacements attendus, plus les secrets presents mais non declares —
   * on ne masque jamais un secret existant simplement parce que le mode ne le
   * prevoit pas (cas d'un changement de configuration).
   */
  public readonly rows = computed((): SecretRow[] => {
    const ignored = new Set(this.ignore());
    const declared = this.slots().filter((s) => !ignored.has(s.name));
    const declaredNames = new Set(declared.map((s) => s.name));

    const extras = this.secrets()
      .filter((s) => !!s.name && !ignored.has(s.name) && !declaredNames.has(s.name))
      .map((s): SecretSlot => ({ name: s.name!, label: s.name! }));

    return [...declared, ...extras].map((slot) => ({
      slot,
      hint: this.hintFor(slot.name),
    }));
  });

  public readonly mismatch = computed(
    () => !!this.secretConfirm() && this.secretValue() !== this.secretConfirm(),
  );

  public readonly canSubmit = computed(
    () => !this.isSaving() && !!this.secretValue() && this.secretValue() === this.secretConfirm(),
  );

  public hintFor(name: string): SecretHintDto | null {
    return this.secrets().find((s) => s.name === name) ?? null;
  }

  public startEditing(slot: SecretSlot): void {
    this.editingSlot.set(slot);
    this.secretValue.set('');
    this.secretConfirm.set('');
    this.secretExpiry.set('');
  }

  public cancel(): void {
    this.editingSlot.set(null);
  }

  /** FE-18 AC2 — valeur aleatoire pour les secrets que nous emettons. */
  public generate(): void {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const value = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    this.secretValue.set(value);
    this.secretConfirm.set(value);
  }

  public save(): void {
    const slot = this.editingSlot();
    if (!slot || !this.canSubmit()) return;

    this.isSaving.set(true);
    this._sourcesService.setSecret(this.sourceId(), slot.name, {
      value: this.secretValue(),
      expiresAt: this.secretExpiry() || null,
    }).pipe(
      catchError(() => {
        this.isSaving.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Secret enregistré', `« ${slot.label} » a été enregistré.`);
      this.isSaving.set(false);
      this.editingSlot.set(null);
      this.secretValue.set('');
      this.secretConfirm.set('');
      this.secretSaved.emit(slot.name);
    });
  }
}

export default SourceSecrets;
