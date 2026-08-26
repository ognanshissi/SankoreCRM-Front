import {
  Component,
  computed,
  forwardRef,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { FormField, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';
import {
  AbstractControl,
  FormControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  ValidationErrors,
} from '@angular/forms';
import { TasInput } from '@talisoft/ui/input';

@Component({
  selector: 'tas-input-password, InputPassword',
  templateUrl: './input-password.html',
  standalone: true,
  imports: [
    FormField,
    TasSuffix,
    TasIcon,
    TasLabel,
    ReactiveFormsModule,
    TasInput,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TasInputPassword),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => TasInputPassword),
      multi: true,
    },
  ],
})
export class TasInputPassword
  extends AbstractControlValueAccessor<string>
  implements OnInit
{
  public placeholder = input<string>('Mot de passe');

  public showPassword = signal<boolean>(false);

  public passwordFieldType = computed(() => {
    return this.showPassword() ? 'text' : 'password';
  });

  public passwordControl = new FormControl<string>('');

  ngOnInit() {
    this.passwordControl.valueChanges.subscribe((value) => {
      super.value = value ?? '';
    });
  }

  override writeValue(obj: string) {
    super.writeValue(obj);
    this.passwordControl.patchValue(obj);
  }

  override setDisabledState(isDisabled: boolean): void {
    super.setDisabledState(isDisabled);
    isDisabled ? this.passwordControl.disable() : this.passwordControl.enable();
  }

  override validate(control: AbstractControl): ValidationErrors | null {
    this.passwordControl.setErrors(control.errors);
    return super.validate(control);
  }
}
