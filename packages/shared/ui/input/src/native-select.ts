import { Component, ElementRef, inject } from '@angular/core';
import { AbstractFormFieldControl } from '@talisoft/ui/form-field';

@Component({
  selector: 'select[tasNativeSelect]',
  standalone: true,
  template: ``,
  providers: [
    {
      provide: AbstractFormFieldControl,
      useExisting: TasNativeSelect,
    },
  ],
})
export class TasNativeSelect extends AbstractFormFieldControl {
  private readonly _elementRef = inject(ElementRef);
  constructor() {
    super();
    this._elementRef.nativeElement.classList.add('form-select');
  }
}
