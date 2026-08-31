import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, minLength, pattern, required, validate } from '@angular/forms/signals';
import { TasTitle } from '@talisoft/ui/title';
import { TasError, TasHint } from '@talisoft/ui/form-field';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { TasIcon } from '@talisoft/ui/icon';
import { Anchor, Button } from '@talisoft/ui/button';
import { AuthenticationWrapper } from '../../components/authentication-wrapper';
import { AccountActivationModel } from '../../models/account-activation.model';

/**
 * A password needs at least one lowercase letter, one uppercase letter and one digit.
 */
const PASSWORD_COMPLEXITY_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

type ActivationStep = 'checking' | 'invalid' | 'form' | 'success';

@Component({
  templateUrl: './account-activation.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthenticationWrapper,
    TasTitle,
    TasHint,
    TasError,
    TasInputPassword,
    TasIcon,
    Button,
    Anchor,
    RouterLink,
    FormField,
  ],
})
export class AccountActivationComponent {
  // Bound automatically from the `?token=` query param (see `withComponentInputBinding`).
  public token = input<string>();

  public step = signal<ActivationStep>('checking');

  public model = signal(AccountActivationModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.password, { message: 'Le mot de passe est obligatoire' });
    minLength(schema.password, 8, {
      message: 'Le mot de passe doit contenir au moins 8 caractères',
    });
    pattern(schema.password, PASSWORD_COMPLEXITY_PATTERN, {
      message: 'Le mot de passe doit contenir une majuscule, une minuscule et un chiffre',
    });

    required(schema.confirmPassword, {
      message: 'La confirmation du mot de passe est obligatoire',
    });
    validate(schema.confirmPassword, (ctx) => {
      if (ctx.value() && ctx.value() !== ctx.valueOf(schema.password)) {
        return { kind: 'mismatch', message: 'Les mots de passe ne correspondent pas' };
      }
      return null;
    });
  });

  ngOnInit(): void {
    this.checkTokenValidity();
  }

  public handleFormSubmission(): void {
    if (this.formSchema().invalid()) {
      return;
    }

    // TODO: call the account-activation API with { token: this.token(), password }
    // once the endpoint is available, then swap the line below for the response handling.
    console.log({ token: this.token(), password: this.model().password });
    this.step.set('success');
  }

  private checkTokenValidity(): void {
    const token = this.token();

    if (!token) {
      this.step.set('invalid');
      return;
    }

    // TODO: replace with a real call to the activation API, e.g.
    // GET /account-activation/:token, and route to 'invalid' on a 4xx/expired response.
    this.step.set('form');
  }
}

export default AccountActivationComponent;
