import {
  Component,
  ElementRef,
  HostBinding,
  output,
  signal,
} from '@angular/core';

import { TasCheckbox } from '@talisoft/ui/checkbox';

@Component({
  selector: '[rowSelectionItem]',
  standalone: true,
  imports: [TasCheckbox],
  template: ` <tas-checkbox
    [checked]="isChecked()"
    (valueChange)="handleChangeEvent($event)"
  ></tas-checkbox>`,
  styles: [],
})
export class RowSelectionItem {
  public isChecked = signal(false);

  public valueChange = output<boolean>();

  public toggle() {
    this.isChecked.set(!this.isChecked());
  }

  constructor(private readonly _elementRef: ElementRef<any>) {}

  @HostBinding('class')
  public get classes() {
    return { 'is-row-selected': this.isChecked() };
  }

  public handleChangeEvent(event: boolean) {
    this.valueChange.emit(event);
  }
}
