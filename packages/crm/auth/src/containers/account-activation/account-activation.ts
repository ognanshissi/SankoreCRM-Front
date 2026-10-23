import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, required, validate } from '@angular/forms/signals';
import { TasTitle } from '@talisoft/ui/title';
import { TasError } from '@talisoft/ui/form-field';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { TasIcon } from '@talisoft/ui/icon';
import { Anchor, Button } from '@talisoft/ui/button';
import { AuthenticationWrapper } from '../../components/authentication-wrapper';
import { PasswordStrength } from '../../components/password-strength';
import { firstUnmetPasswordCriterion } from '../../models/password-policy';
import { AccountActivationModel } from '../../models/account-activation.model';
import { AuthApiService } from '@sankore/crm-api';
import { Loading } from '@sankore/crm/common';

type ActivationStep = 'checking' | 'invalid' | 'form' | 'success';

@Component({
  templateUrl: './account-activation.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthenticationWrapper,
    TasTitle,
    PasswordStrength,
    TasError,
    TasInputPassword,
    TasIcon,
    Button,
    Anchor,
    RouterLink,
    FormField,
  ],
})
export class AccountActivationComponent implements OnInit {
  private readonly _authApiService = inject(AuthApiService);
  private readonly _loadingService = inject(Loading);
  // Bound automatically from the `?token=` query param (see `withComponentInputBinding`).
  public token = input<string>();
  public userId = input<string>();

  public step = signal<ActivationStep>('checking');

  public model = signal(AccountActivationModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.password, { message: 'Le mot de passe est obligatoire' });
    validate(schema.password, (ctx) => {
      const unmet = ctx.value() ? firstUnmetPasswordCriterion(ctx.value()) : undefined;
      return unmet ? { kind: `password-${unmet.key}`, message: unmet.message } : null;
    });

    required(schema.confirmPassword, {
      message: 'La confirmation du mot de passe est obligatoire',
    });
    validate(schema.confirmPassword, (ctx) => {
      if (ctx.value() && ctx.value() !== ctx.valueOf(schema.password)) {
        return {
          kind: 'mismatch',
          message: 'Les mots de passe ne correspondent pas',
        };
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

    if (!this.token() || !this.userId()) {
      this.step.set('invalid');
      return;
    }

    this._loadingService
      .showLoaderUntilCompleted(
        this._authApiService.activateAccount({
          newPassword: this.model()?.password,
          confirmPassword: this.model()?.confirmPassword,
          token: this.token(),
          userId: this.userId()
        }),
      )
      .subscribe({
        next: (response) => {
          console.log(response);
          this.step.set('success')
        },
        error: (_error) => {
          this.step.set('invalid')
        }
      });
  }

  private checkTokenValidity(): void {
    const token = this.token();
    const userId = this.userId();

    if (!token || !userId) {
      this.step.set('invalid');
      return;
    }

    this.step.set('checking');

    this._loadingService
      .showLoaderUntilCompleted(
        this._authApiService.validateActivationToken(
          this.userId() ?? '',
          this.token() ?? '',
        ),
      )
      .subscribe({
        next: () => this.step.set('form'),
        error: () => {
          this.step.set('invalid');
        },
      });
  }
}

export default AccountActivationComponent;
