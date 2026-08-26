import {
  Component,
  EventEmitter,
  inject,
  ViewEncapsulation,
} from '@angular/core';
import { ConfirmationDialogProps } from './confirm-dialog.service';
import { ButtonModule } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { DialogRef } from '@angular/cdk/dialog';
import { TasTitle } from '@talisoft/ui/title';

@Component({
  selector: 'tas-confirmation-dialog',
  template: `
    <div
      class="flex justify-between items-center py-2 border-b border-gray-300"
    >
      <tas-title>{{ config.title }}</tas-title>
      @if (config.closable) {
        <button tas-button iconButton (click)="close(); reject.emit()">
          <tas-icon iconName="close"></tas-icon>
        </button>
      }
    </div>

    <div class="py-8 flex space-x-2 ">
      <div>
        <tas-icon iconName="question" iconClass="text-red-600"></tas-icon>
      </div>
      <div>{{ config.message }}</div>
    </div>

    <div class="flex space-x-3 justify-end border-t border-gray-300 pt-4">
      @if (config.showCancelButton) {
        <button
          tas-outlined-button
          [color]="config?.rejectButtonProps?.theme ?? 'neutral'"
          (click)="close(); reject.emit()"
        >
          <tas-icon
            [iconName]="config?.rejectButtonProps?.icon ?? 'close'"
          ></tas-icon>
          &nbsp;
          {{ config.rejectButtonProps?.label ?? 'Annuler' }}
        </button>
      }

      <button
        tas-raised-button
        [color]="config?.acceptButtonProps?.theme ?? 'warn'"
        (click)="accept.emit(); close()"
      >
        <tas-icon
          [iconName]="config.acceptButtonProps?.icon ?? 'check'"
        ></tas-icon>
        &nbsp;
        {{ config.acceptButtonProps?.label ?? 'Oui, Supprimer' }}
      </button>
    </div>
  `,
  standalone: true,
  imports: [ButtonModule, TasIcon, TasTitle, TasTitle],
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
})
export class TasConfirmationDialog {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef<boolean>);
  public config!: ConfirmationDialogProps;
  public accept: EventEmitter<string> = new EventEmitter<string>();
  public reject: EventEmitter<string> = new EventEmitter<string>();

  public close() {
    this._dialogRef.close(false);
  }
}
