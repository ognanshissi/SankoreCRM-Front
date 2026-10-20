import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TasIcon } from '@talisoft/ui/icon';

/** Compteur « − valeur + » des garde-fous, branchable en `[formField]`. */
@Component({
  selector: 'number-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    <span
      class="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 h-9"
      [class.opacity-50]="disabled()"
    >
      <button
        type="button"
        class="w-8 h-full flex items-center justify-center text-slate-500 hover:text-slate-800 disabled:opacity-30"
        [attr.aria-label]="'Diminuer ' + ariaLabel()"
        [disabled]="disabled() || value() <= lower()"
        (click)="change(-step())"
      >
        <tas-icon iconName="feather:minus" style="font-size:12px"></tas-icon>
      </button>
      <span
        class="min-w-14 px-1 text-center text-sm font-semibold text-slate-800 tabular-nums"
        role="spinbutton"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-valuenow]="value()"
        [attr.aria-valuemin]="lower()"
        [attr.aria-valuetext]="display()"
        tabindex="0"
        (keydown.arrowup)="$event.preventDefault(); change(step())"
        (keydown.arrowdown)="$event.preventDefault(); change(-step())"
      >{{ display() }}</span>
      <button
        type="button"
        class="w-8 h-full flex items-center justify-center text-slate-500 hover:text-slate-800 disabled:opacity-30"
        [attr.aria-label]="'Augmenter ' + ariaLabel()"
        [disabled]="disabled() || value() >= upper()"
        (click)="change(step())"
      >
        <tas-icon iconName="feather:plus" style="font-size:12px"></tas-icon>
      </button>
    </span>
  `,
})
export class NumberStepper implements FormValueControl<number> {
  public readonly value = model(0);
  public readonly touched = model(false);
  public readonly disabled = input(false);

  /** Bornes reçues des validateurs `min()` / `max()` du schéma via `[formField]`. */
  public readonly min = input<number | undefined>(undefined);
  public readonly max = input<number | undefined>(undefined);
  public readonly lower = computed(() => this.min() ?? 0);
  public readonly upper = computed(() => this.max() ?? Number.MAX_SAFE_INTEGER);
  public readonly step = input(1);
  public readonly ariaLabel = input('');
  /** Rendu de la valeur (unité, « illimité »…). */
  public readonly format = input<(value: number) => string>((v) => String(v));

  public readonly display = computed(() => this.format()(this.value()));

  public change(delta: number): void {
    if (this.disabled()) return;
    // Une valeur hors pas (24 h 30 avec un pas d'une heure) se recale sur le pas au premier clic.
    const step = this.step();
    const current = this.value();
    const snapped = delta > 0 ? Math.floor(current / step) * step + step : Math.ceil(current / step) * step - step;
    this.value.set(Math.min(this.upper(), Math.max(this.lower(), snapped)));
    this.touched.set(true);
  }
}
