import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasFormField } from '@talisoft/ui/form-field';

export interface DeleteAgencyDialogData {
  agencyName: string;
}

@Component({
  selector: 'delete-agency-dialog',
  standalone: true,
  imports: [Button, TasIcon, TasInput, TasFormField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.Emulated,
  styles: [
    `
      :host {
        display: block;
        background: #fff;
        border-radius: 12px;
        padding: 8px 16px 16px;
      }
    `,
  ],
  template: `
    <div
      class="flex justify-between items-center py-2 border-b border-gray-300 mb-6"
    >
      <h2 class="text-base font-semibold text-slate-900">Supprimer l'agence</h2>
      <button tas-button iconButton (click)="cancel()">
        <tas-icon iconName="feather:x"></tas-icon>
      </button>
    </div>

    <div class="flex flex-col gap-4 pb-2">
      <div class="flex gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
        <tas-icon
          iconName="feather:alert-triangle"
          class="text-functional-error shrink-0 mt-0.5"
        ></tas-icon>
        <p class="text-sm text-slate-700">
          Cette action est <span class="font-semibold">irréversible</span>.
          L'agence sera supprimée définitivement. Elle ne peut pas être
          supprimée si des utilisateurs y sont encore assignés.
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        <p class="text-sm text-slate-600">
          Pour confirmer, saisissez le nom de l'agence :
        </p>
        <p class="font-semibold text-slate-900 text-sm select-all">
          {{ data.agencyName }}
        </p>
        <tas-form-field>
          <input
            tasInput
            type="text"
            [placeholder]="data.agencyName"
            [value]="typedName()"
            (input)="typedName.set($any($event.target).value)"
          />
        </tas-form-field>
      </div>
    </div>

    <div class="flex gap-3 justify-end border-t border-gray-300 pt-4 mt-4">
      <button tas-outlined-button type="button" (click)="cancel()">
        Annuler
      </button>
      <button
        tas-raised-button
        color="warn"
        type="button"
        [disabled]="!canConfirm()"
        (click)="confirm()"
      >
        <tas-icon iconName="feather:trash-2" iconSize="sm"></tas-icon>
        &nbsp;Supprimer définitivement
      </button>
    </div>
  `,
})
export class DeleteAgencyDialog {
  public readonly data = inject<DeleteAgencyDialogData>(DIALOG_DATA);
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef<boolean>);

  public typedName = signal('');
  public canConfirm = computed(() => this.typedName() === this.data.agencyName);

  public confirm(): void {
    if (!this.canConfirm()) return;
    this._dialogRef.close(true);
  }

  public cancel(): void {
    this._dialogRef.close(false);
  }
}
