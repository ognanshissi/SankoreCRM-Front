import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, minLength, pattern, required, validate } from '@angular/forms/signals';
import { TasTitle } from '@talisoft/ui/title';
import { TasError, TasHint } from '@talisoft/ui/form-field';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { TasIcon } from '@talisoft/ui/icon';
import { Anchor, Button } from '@talisoft/ui/button';
import { AuthenticationWrapper } from '../../components/authentication-wrapper';
import { ResetPasswordModel } from '../../models/reset-password.model';
import {
  AuthApiService,
  ResetPasswordRequest,
  UsersApiService,
} from '@sankore/crm-api';
import { Loading } from '@sankore/crm/common';

/**
 * A password needs at least one lowercase letter, one uppercase letter and one digit.
 */
const PASSWORD_COMPLEXITY_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

type ResetPasswordStep = 'checking' | 'invalid' | 'form' | 'success';

@Component({
  templateUrl: './reset-password.html',
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
export class ResetPasswordComponent {
  private readonly _authApiService = inject(AuthApiService);
  private readonly _loadingService = inject(Loading);

  public token = input<string>();
  public userId = input<string>();

  public step = signal<ResetPasswordStep>('checking');

  public model = signal(ResetPasswordModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.password, { message: 'Le mot de passe est obligatoire' });
    minLength(schema.password, 8, {
      message: 'Le mot de passe doit contenir au moins 8 caractères',
    });
    pattern(schema.password, PASSWORD_COMPLEXITY_PATTERN, {
      message:
        'Le mot de passe doit contenir une majuscule, une minuscule et un chiffre',
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
        this._authApiService.refreshToken({
          newPassword: this.formSchema()?.value().password,
          confirmPassword: this.formSchema()?.value().confirmPassword,
          userId: this.userId()!,
          token: this.token()!,
        } as ResetPasswordRequest),
      )
      .subscribe({
        next: () => this.step.set('success'),
        error: () => this.step.set('invalid'),
      });
  }

  private checkTokenValidity(): void {
    const token = this.token();
    const userId = this.userId();

    if (!token || !userId) {
      this.step.set('invalid');
      return;
    }

    this._loadingService
      .showLoaderUntilCompleted(
        this._authApiService.validateActivationToken(userId, token),
      )
      .subscribe({
        next: () => this.step.set('form'),
        error: () => this.step.set('invalid'),
      });
  }
}

export default ResetPasswordComponent;
