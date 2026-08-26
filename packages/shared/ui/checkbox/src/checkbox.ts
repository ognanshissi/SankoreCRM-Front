import {
  Component,
  forwardRef,
  input,
  OnChanges,
  OnInit,
  output,
  SimpleChanges,
} from '@angular/core';
import {
  FormControl,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';

@Component({
  selector: 'tas-checkbox, Checkbox',
  template: `
    @if (labelPosition() === 'left') {
    <label [for]="componentId">
      <ng-content></ng-content>
    </label>
    } &nbsp;
    <input
      [id]="componentId"
      type="checkbox"
      class="form-checkbox"
      [checked]="checked()"
      (change)="handleChange($any($event.target).checked)"
      [formControl]="control"
    />
    &nbsp; @if (labelPosition() === 'right') {
    <label [for]="componentId">
      <ng-content></ng-content>
    </label>
    }
  `,
  standalone: true,
  imports: [ReactiveFormsModule],
  styleUrl: 'checkbox.scss',
  exportAs: 'tasCheckbox',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TasCheckbox),
      multi: true,
    },
  ],
})
export class TasCheckbox
  extends AbstractControlValueAccessor<boolean>
  implements OnInit, OnChanges
{
  public control = new FormControl(false);

  public checked = input<boolean>(false);

  public valueChange = output<boolean>();

  public labelPosition = input<'left' | 'right'>('right');

  componentId = 'tas-checkbox-id-' + Date.now();

  public handleChange(event: boolean) {
    this.valueChange.emit(event);
  }

  public ngOnChanges(changes: SimpleChanges) {
    if (changes['checked']) {
      // this.onTouched();
      // this.onChange(changes['checked'].currentValue);
      this.control.patchValue(changes['checked'].currentValue);
    }
  }

  public ngOnInit(): void {
    this.control.valueChanges.subscribe((value) => {
      this.onTouched();
      this.onChange(value ?? false);
    });
  }

  override writeValue(obj: boolean) {
    super.writeValue(obj);
    this.control.patchValue(obj);
  }

  override setDisabledState(isDisabled: boolean) {
    super.setDisabledState(isDisabled);
    isDisabled ? this.control.disable() : this.control.enable();
  }
}
