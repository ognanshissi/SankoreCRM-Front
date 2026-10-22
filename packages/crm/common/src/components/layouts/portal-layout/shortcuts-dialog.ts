import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';

export interface ShortcutsDialogData {
  /** « ⌘ » sur Mac, « Ctrl » ailleurs : la touche que l'utilisateur a sous les doigts. */
  modifier: string;
}

/** « Aide et raccourcis » : les raccourcis clavier du portail. */
@Component({
  selector: 'common-shortcuts-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    <div class="w-[440px] max-w-[calc(100vw-32px)] rounded-2xl bg-white p-6 shadow-2xl">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-slate-900">Aide et raccourcis</h2>
        <button type="button" class="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Fermer" (click)="close()">
          <tas-icon iconName="feather:x" style="font-size:18px"></tas-icon>
        </button>
      </div>

      <dl class="flex flex-col divide-y divide-slate-100 text-sm">
        @for (s of shortcuts; track s.label) {
          <div class="flex items-center justify-between gap-4 py-2.5">
            <dt class="text-slate-700">{{ s.label }}</dt>
            <dd class="flex gap-1">
              @for (k of s.keys; track k) {
                <kbd class="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">{{ k }}</kbd>
              }
            </dd>
          </div>
        }
      </dl>

      <p class="mt-4 text-xs text-slate-500">
        Une question sur un écran ? Votre administrateur ou votre chef d'agence est le premier interlocuteur.
      </p>
    </div>
  `,
})
export class ShortcutsDialog {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _data = inject<ShortcutsDialogData>(DIALOG_DATA);

  public readonly shortcuts = [
    { label: 'Rechercher une page, un lead, un client', keys: [this._data.modifier, 'K'] },
    { label: 'Ouvrir cette aide', keys: ['?'] },
    { label: 'Fermer une fenêtre ou un panneau', keys: ['Échap'] },
  ];

  public close(): void {
    this._dialogRef.close();
  }
}
