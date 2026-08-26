import {
  ChangeDetectionStrategy,
  Component,
  output,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { TasCheckbox } from '@talisoft/ui/checkbox';

@Component({
  selector: '[rowSelectionMaster]',
  standalone: true,
  template: `<tas-checkbox
    [checked]="isChecked()"
    (valueChange)="handleChangeEvent($event)"
  ></tas-checkbox>`,
  imports: [TasCheckbox],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RowSelectionMaster {
  public isChecked = signal(false);

  public valueChange = output<boolean>();

  public toggleMaster() {
    this.isChecked.set(!this.isChecked());
  }

  public handleChangeEvent(event: boolean) {
    this.valueChange.emit(event);
  }
}
