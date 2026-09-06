import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasIcon } from "@talisoft/ui/icon";
import { Anchor, Button } from "@talisoft/ui/button";
import { email, form, FormField, required } from "@angular/forms/signals";
import { LoginModel } from '../../models/login.model';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthenticationWrapper } from '../../components/authentication-wrapper';
import { AuthenticationService, TenantProvider } from '@sankore/crm/common';

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
    TasError
],
  encapsulation: ViewEncapsulation.None,
})
export class Login {
  private readonly _authenticationService = inject(AuthenticationService);
  private readonly _activatedRoute = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public loginForm = signal(LoginModel.instantiate());

  public loginFormSchema = form(this.loginForm, (schema) => {
    required(schema.email, {
      message: "L'adresse éléctronique est obligatoire",
    });
    email(schema.email, { message: "L'adresse éléctronique n'est pas valide" });
    required(schema.password, { message: 'Le mot de passe est obligatoire' });
  });

  public handleFormSubmit(): void {

    if (this.loginFormSchema().invalid()) {
      return;
    }

    console.log(this.loginFormSchema().submitting());

    this._authenticationService.login(this.loginForm()).subscribe({
      next: (result) => {
        console.log(result);
        const redirectPath =
          this._activatedRoute.snapshot.queryParamMap.get('redirectPath') ??
          '/tasks/my-day';
        this._router.navigate([redirectPath]).then();
      }
    })

  }
}


export default Login;
