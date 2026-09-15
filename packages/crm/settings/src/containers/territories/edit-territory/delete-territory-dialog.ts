import { Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';

@Component({
  selector: 'delete-territory-dialog',
  imports: [Button, TasIcon],
  template: `
    <div class="p-6 flex flex-col gap-4 bg-white rounded-xl shadow-xl">
      <div>
        <p class="text-base font-semibold text-slate-800">Désactiver le territoire</p>
        <p class="text-sm text-slate-500 mt-1">
          Vous êtes sur le point de désactiver
          <strong>{{ data.territoryName }}</strong>.
          Ce territoire n'apparaîtra plus dans les listes actives.
        </p>
      </div>
      <div class="flex justify-end gap-3">
        <button tas-outlined-button color="primary" type="button" (click)="cancel()">
          <tas-icon iconName="feather:x" iconSize="sm"></tas-icon>
          Annuler
        </button>
        <button tas-raised-button color="warn" type="button" (click)="confirm()">
          <tas-icon iconName="feather:trash-2" iconSize="sm"></tas-icon>
          Désactiver
        </button>
      </div>
    </div>
  `,
})
export class DeleteTerritoryDialog {
  private readonly _dialogRef = inject(DialogRef<boolean>);
  public readonly data: { territoryName: string } = inject(DIALOG_DATA);

  public cancel(): void {
    this._dialogRef.close(false);
  }

  public confirm(): void {
    this._dialogRef.close(true);
  }
}
