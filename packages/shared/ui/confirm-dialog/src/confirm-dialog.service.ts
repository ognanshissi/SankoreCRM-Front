import { inject, Injectable } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { TasConfirmationDialog } from './confirm-dialog';

export interface ConfirmationDialogProps {
  title: string;
  message: string;
  closable: boolean;
  closeOnEscape?: boolean;
  showCancelButton?: boolean;

  width?: string;

  icon?: string;

  rejectButtonProps?: {
    label: string;
    icon?: string;
    theme?: 'primary' | 'accent' | 'warn';
  };

  acceptButtonProps?: {
    label: string;
    icon?: string;
    theme?: 'primary' | 'accent' | 'warn';
  };

  accept?: () => void;
  reject?: () => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly _dialog = inject(Dialog);

  public confirm(config: ConfirmationDialogProps) {
    const confirmationDialog = this._dialog.open(TasConfirmationDialog, {
      width: config.width ?? '500px',
      disableClose: true,
    });

    if (confirmationDialog?.componentInstance) {
      confirmationDialog.componentInstance.config = config;
      confirmationDialog.componentInstance.accept.subscribe(() => {
        if (config.accept) {
          config?.accept();
        }
      });
      confirmationDialog.componentInstance.reject.subscribe(() => {
        if (config.reject) {
          config.reject();
        }
      });
    }
  }
}
