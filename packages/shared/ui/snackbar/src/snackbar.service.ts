import { inject, Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { TasSnackbar } from './snackbar';

export type SnackbarNotificationType = 'success' | 'error' | 'info';

export interface SnackbarPrimitiveData {
  type?: SnackbarNotificationType;
  header: string;
  message: string;

  [key: string]: any;
}

@Injectable({ providedIn: 'root' })
export class SnackbarService {
  private readonly _snackbar = inject(MatSnackBar);

  private open<D extends SnackbarPrimitiveData>(config?: MatSnackBarConfig<D>) {
    return this._snackbar.openFromComponent(TasSnackbar, {
      ...config,
      duration: config?.duration ?? 5000,
      horizontalPosition: config?.horizontalPosition ?? 'right',
      verticalPosition: config?.verticalPosition ?? 'bottom',
      panelClass: `tas-snackbar--${config?.data?.type}`,
    });
  }

  public success(header: string, message: string) {
    return this.open({
      data: {
        type: 'success',
        header,
        message,
      },
    });
  }

  public error(header: string, message: string) {
    return this.open({
      data: {
        type: 'error',
        header,
        message,
      },
    });
  }

  public info(header: string, message: string) {
    return this.open({
      data: {
        type: 'info',
        header,
        message,
      },
    });
  }
}
