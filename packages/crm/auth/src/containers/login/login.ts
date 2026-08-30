import {
  ChangeDetectionStrategy,
  Component, signal,
  ViewEncapsulation,
} from '@angular/core';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasIcon } from "@talisoft/ui/icon";
import { Anchor, Button } from "@talisoft/ui/button";
import { email, form, FormField, required } from "@angular/forms/signals";
import { LoginModel } from '../../models/login.model';
import { RouterLink } from '@angular/router';
import { AuthenticationWrapper } from '../components/authentication-wrapper';

@Component({
  templateUrl: 'login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    TasInput,
    TasLabel,
    TasIcon,
    Button,
    FormField,
    TasFormField,
    RouterLink,
    AuthenticationWrapper,
    Anchor,
  ],
  encapsulation: ViewEncapsulation.None,
})
export class Login {
  public loginForm = signal(LoginModel.instantiate());

  public loginFormSchema = form(this.loginForm, (schema) => {
    required(schema.email, {
      message: "L'adresse éléctronique est obligatoire",
    });
    email(schema.email, { message: "L'adresse est invalide" });
    required(schema.password, { message: 'Le mot de passe est obligatoire' });
  });

  public handleFormSubmittion(): void {
    console.log(this.loginForm());
  }
}


export default Login;
