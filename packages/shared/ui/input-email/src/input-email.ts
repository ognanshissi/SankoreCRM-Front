import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  forwardRef,
  input,
  OnInit,
  ViewEncapsulation,
} from '@angular/core';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';
import { FormField, TasLabel, TasPrefix } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import {
  AbstractControl,
  FormControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { TasIcon } from '@talisoft/ui/icon';
import { NgClass } from '@angular/common';

@Component({
  selector: 'tas-input-email, InputEmail',
  template: `
    <tas-form-field>
      <tas-label [ngClass]="{ 'sr-only': labelScreenOnly() }">
        <ng-content></ng-content>
      </tas-label>
      <tas-icon tasPrefix iconName="feather:at-sign" iconSize="md"></tas-icon>
      <input
        type="email"
        tasInput
        [placeholder]="placeholder()"
        [formControl]="emailControl"
      />
    </tas-form-field>
  `,
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    TasInput,
    ReactiveFormsModule,
    TasLabel,
    TasIcon,
    TasPrefix,
    NgClass,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TasInputEmail),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => TasInputEmail),
      multi: true,
    },
  ],
})
export class TasInputEmail
  extends AbstractControlValueAccessor<string>
  implements OnInit
{
  public emailControl = new FormControl('', [Validators.email]);

  public placeholder = input<string>('');

  public labelScreenOnly = input(false, { transform: booleanAttribute });

  ngOnInit() {
    this.emailControl.valueChanges.subscribe((value) => {
      this.onTouched();
      this.onChange(value ?? '');
    });
  }

  override writeValue(obj: string) {
    super.writeValue(obj);
    this.emailControl.patchValue(obj);
  }

  override setDisabledState(isDisabled: boolean) {
    super.setDisabledState(isDisabled);
    isDisabled ? this.emailControl.disable() : this.emailControl.enable();
  }

  override validate(control: AbstractControl): ValidationErrors | null {
    return super.validate(control);
  }
}
