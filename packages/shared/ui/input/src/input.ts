import { CommonModule } from '@angular/common';
import { Component, ElementRef, inject } from '@angular/core';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { AbstractFormFieldControl } from '@talisoft/ui/form-field';

/**
 * Default inputs - Native Input Controls
 * ==========================================
 *
 * color
 * date
 * datetime-local
 * email
 * month
 * number
 * password
 * search
 * tel
 * text
 * time
 * url
 * week
 * -----------------------------------------------------
 */
@Component({
  selector: `
  input[tasInput][type=text],
  input[tasInput][type=number],
  input[tasInput][type=email],
  input[tasInput][type=password],
  input[tasInput][type=search],
  input[tasInput][type=tel],
  input[tasInput][type=time],
  input[tasInput][type=url],
  input[tasInput][type=color],
  input[tasInput][type=date],
  input[tasInput][type=week],
  input[tasInput][type=month],
  textarea[tasInput]`,
  standalone: true,
  template: ``,
  styleUrls: ['./input.scss'],
  imports: [CommonModule],
  exportAs: 'TasInput',
  providers: [
    {
      provide: AbstractFormFieldControl,
      useExisting: TasInput,
    },
  ],
})
export class TasInput extends AbstractFormFieldControl {
  private readonly _elementRef = inject(ElementRef);

  constructor() {
    super();
    this._elementRef.nativeElement.classList.add('form-input');
  }
}
