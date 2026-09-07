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
import {
  email,
  form,
  FormField,
  FormRoot,
  required, submit,
} from '@angular/forms/signals';
import { LoginModel } from '../../models/login.model';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthenticationWrapper } from '../../components/authentication-wrapper';
import { AuthenticationService } from '@sankore/crm/common';
import { firstValueFrom } from 'rxjs';

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
    TasError,
    FormRoot
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
  }, {
    submission: {
      action: async (field) => {
        const result = await firstValueFrom(this._authenticationService.login(field()?.value()));
        if (result) {
          const redirectPath =
            this._activatedRoute.snapshot.queryParamMap.get('redirectPath') ??
            '/tasks/my-day';
          this._router.navigate([redirectPath]).then();
        }
      }
    }
  });
}


export default Login;
