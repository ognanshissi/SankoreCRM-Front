import { Component, HostBinding, input } from '@angular/core';

export type Severity =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'neutral';

@Component({
  selector: 'tas-tag, tasTag',
  template: ` <div>
    <ng-content></ng-content>
  </div>`,
  standalone: true,
})
export class TasTag {
  public severity = input<Severity>('info');

  @HostBinding('class')
  get severityClasses(): string {
    const baseClasses = 'rounded-full px-2 py-3 text-sm font-medium';
    const severityClasses: Record<Severity, string> = {
      info: 'bg-blue-100 text-blue-800',
      success: 'bg-green-100 text-green-800',
      warning: 'bg-yellow-100 text-yellow-800',
      error: 'bg-red-100 text-red-800',
      primary: 'bg-primary/10 text-primary',
      secondary: 'bg-secondary/10 text-secondary',
      accent: 'bg-accent/10 text-accent',
      neutral: 'bg-gray-200 text-gray-800',
    };
    return `${baseClasses} ${severityClasses[this.severity()]}`;
  }
}
