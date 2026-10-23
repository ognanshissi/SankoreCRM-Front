import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { evaluatePasswordStrength, PASSWORD_CRITERIA } from '../models/password-policy';

const STRENGTH_LEVELS = [
  { label: '', bar: '', text: '' },
  { label: 'Faible', bar: 'bg-functional-error', text: 'text-functional-error' },
  { label: 'Moyen', bar: 'bg-functional-warning', text: 'text-functional-warning' },
  { label: 'Acceptable', bar: 'bg-functional-success', text: 'text-functional-success' },
  { label: 'Fort', bar: 'bg-functional-success', text: 'text-functional-success' },
];

@Component({
  selector: 'PasswordStrength',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    <div class="mt-3 flex flex-col gap-3" aria-live="polite">
      <div class="flex items-center gap-3">
        <div class="grid flex-1 grid-cols-4 gap-1.5">
          @for (segment of segments; track segment) {
            <span
              class="h-1.5 rounded-full transition-colors"
              [class]="segment <= strength() ? level().bar : 'bg-slate-200'"
            ></span>
          }
        </div>
        <span class="w-20 text-right text-xs font-medium" [class]="level().text || 'text-slate-400'">
          {{ level().label || 'Force' }}
        </span>
      </div>

      <ul class="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
        @for (criterion of criteria(); track criterion.key) {
          <li class="flex items-center gap-2" [class]="criterion.met ? 'text-functional-success' : password() ? 'text-slate-600' : 'text-slate-500'">
            <tas-icon
              [iconName]="criterion.met ? 'feather:check-circle' : 'feather:circle'"
              style="font-size: 14px"
            ></tas-icon>
            <span>{{ criterion.label }}</span>
            <span class="sr-only">{{ criterion.met ? '(respecté)' : '(manquant)' }}</span>
          </li>
        }
      </ul>

      @if (strength() === 3) {
        <p class="text-xs text-slate-500">Astuce : 12 caractères ou plus rendent votre mot de passe plus robuste.</p>
      }
    </div>
  `,
})
export class PasswordStrength {
  public password = input<string>('');

  public readonly segments = [1, 2, 3, 4];

  public readonly criteria = computed(() =>
    PASSWORD_CRITERIA.map((c) => ({ key: c.key, label: c.label, met: c.test(this.password() ?? '') })),
  );

  public readonly strength = computed(() => evaluatePasswordStrength(this.password() ?? ''));

  public readonly level = computed(() => STRENGTH_LEVELS[this.strength()]);
}
