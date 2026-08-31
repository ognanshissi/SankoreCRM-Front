import { Component, input, signal } from '@angular/core';
import { TasTitle } from '@talisoft/ui/title';
import { AuthenticationWrapper } from '../../components/authentication-wrapper';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { Anchor, Button } from '@talisoft/ui/button';
import { RouterLink } from '@angular/router';
import { email, form, FormField, required } from '@angular/forms/signals';

export class ForgotPasswordModel {
  public email!: string;
}

@Component({
  templateUrl: 'forgot-password.html',
  imports: [
    TasTitle,
    AuthenticationWrapper,
    TasFormField,
    TasLabel,
    Button,
    Anchor,
    RouterLink,
    FormField,
  ],
})
export class ForgotPassword {
  public email = input<string>();
  public model = signal<ForgotPasswordModel>({ email: this.email() ?? '' });

  public formSchema = form(this.model, (schema) => {
    required(schema.email, {
      message: "L'adresse electronique est obligatoire",
    });
    email(schema.email, {
      message: "L'adresse electronique n'est pas valide",
    });
  });

  ngOnInit(): void {
    console.log(this.email());
    this.model.set({ email: this.email() ?? '' });
  }
}

export default ForgotPassword;
