import { Component, inject, ViewEncapsulation } from '@angular/core';
import {
  MAT_SNACK_BAR_DATA,
  MatSnackBarRef,
} from '@angular/material/snack-bar';
import { ButtonModule } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarPrimitiveData } from './snackbar.service';

@Component({
  selector: 'tas-snackbar',
  standalone: true,
  imports: [ButtonModule, TasIcon],
  template: ` <div class="snackbar__container w-full">
    <div class="flex items-center space-x-4 w-full">
      <div>
        <tas-icon
          [iconName]="iconName"
          [iconSize]="'lg'"
          [iconClass]="textColor"
        ></tas-icon>
      </div>
      <div class="ml-6 w-full">
        <div class="flex justify-between items-center">
          <div class="font-semibold text-lg">{{ data.header }}</div>

          <button tas-button iconButton (click)="dismiss()">
            <tas-icon iconName="close" [iconClass]="textColor"></tas-icon>
          </button>
        </div>
        <div class="mt-1">
          {{ data.message }}
        </div>
      </div>
    </div>
  </div>`,
  encapsulation: ViewEncapsulation.None,
  styles: [
    `
      @reference "../../tailwind-ref.css";
      .tas-snackbar--success,
      .tas-snackbar--error,
      .tas-snackbar--info {
        @apply rounded border border-gray-200 border-t-4 bg-white;

        /* Material 3 peint le fond sur une surface INTÉRIEURE (.mat-mdc-snackbar-surface), aux
           couleurs « inverse-surface » du thème — quasi noire, texte clair. Le bg-white ci-dessus
           n'atteint que le conteneur, que cette surface recouvre : le snackbar s'affichait sur
           fond noir. Ce sont ses jetons qu'il faut fixer. */
        --mat-snack-bar-container-color: #ffffff;
        --mat-snack-bar-supporting-text-color: #1e293b; /* slate-800 */
        --mat-snack-bar-container-shape: 0.25rem;
        /* Le thème Material impose Roboto, que l'application ne charge pas : le texte tombait
           sur la police à empattements du navigateur. */
        --mat-snack-bar-supporting-text-font: var(--tas-font-family, sans-serif);
      }

      .tas-snackbar--success {
        @apply border-t-functional-success;

        tas-icon {
          @apply text-functional-success;
        }
      }

      .tas-snackbar--error {
        @apply border-t-functional-error;

        tas-icon {
          @apply text-functional-error;
        }
      }

      .tas-snackbar--info {
        @apply border-t-functional-info;

        tas-icon {
          @apply text-functional-info;
        }
      }
    `,
  ],
})
export class TasSnackbar {
  public readonly data: SnackbarPrimitiveData = inject(MAT_SNACK_BAR_DATA);
  private readonly _snackbarRef = inject(MatSnackBarRef);

  public get textColor(): string {
    return `text-functional-${this.data.type}`;
  }

  public get iconName(): string {
    switch (this.data.type) {
      case 'success':
        return 'feather:check-circle';
      case 'error':
        return 'feather:alert-triangle';
      case 'info':
        return 'feather:info';
      default:
        return 'feather:info';
    }
  }

  public dismiss() {
    this._snackbarRef.dismiss();
  }
}
