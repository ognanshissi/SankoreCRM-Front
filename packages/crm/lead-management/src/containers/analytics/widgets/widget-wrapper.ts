import { Component, input, output } from '@angular/core';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';

/**
 * Standalone widget wrapper with isolated loading/error states.
 * Each dashboard widget uses this to ensure one widget's error
 * never cascades to the rest of the dashboard.
 */
@Component({
  selector: 'widget-wrapper',
  standalone: true,
  imports: [TasCard, TasSpinner, TasIcon, Button],
  template: `
    <tas-card class="block h-full">
      <div class="p-4 border-b border-slate-100 flex items-center justify-between">
        <div class="flex items-center gap-2">
          @if (icon()) {
            <tas-icon [iconName]="icon()" class="text-slate-400" style="font-size:14px"></tas-icon>
          }
          <p class="text-sm font-semibold text-slate-700">{{ title() }}</p>
        </div>
        @if (hasError()) {
          <button
            type="button"
            class="text-xs text-primary hover:underline flex items-center gap-1"
            (click)="retry.emit()"
          >
            <tas-icon iconName="feather:refresh-cw" style="font-size:10px"></tas-icon>
            Réessayer
          </button>
        }
      </div>
      @if (isLoading()) {
        <div class="flex justify-center py-12">
          <tas-spinner size="6" class="text-primary"></tas-spinner>
        </div>
      } @else if (hasError()) {
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <tas-icon iconName="feather:alert-circle" class="text-red-300 mb-2" style="font-size:24px"></tas-icon>
          <p class="text-xs text-red-400">Erreur de chargement</p>
          <button
            type="button"
            class="text-xs text-primary hover:underline mt-2"
            (click)="retry.emit()"
          >
            Réessayer
          </button>
        </div>
      } @else {
        <ng-content></ng-content>
      }
    </tas-card>
  `,
})
export class WidgetWrapper {
  public title = input('');
  public icon = input('');
  public isLoading = input(false);
  public hasError = input(false);
  public retry = output<void>();
}
