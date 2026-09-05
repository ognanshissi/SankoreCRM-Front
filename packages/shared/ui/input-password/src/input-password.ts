import {
  Component,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import { TasFormField, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import {
  ReactiveFormsModule,
} from '@angular/forms';
import { FormValueControl } from '@angular/forms/signals';

@Component({
  selector: 'tas-input-password, InputPassword',
  templateUrl: './input-password.html',
  standalone: true,
  imports: [
    TasFormField,
    TasSuffix,
    TasIcon,
    TasLabel,
    ReactiveFormsModule,
  ]
})
export class TasInputPassword
  implements FormValueControl<string>
{

  static nextId = 0;

  public id = `input-password-${TasInputPassword.nextId++}`;

  public placeholder = input<string>('Mot de passe');

  public showPassword = signal<boolean>(false);

  public passwordFieldType = computed(() => {
    return this.showPassword() ? 'text' : 'password';
  });

  public value = model('');
}
