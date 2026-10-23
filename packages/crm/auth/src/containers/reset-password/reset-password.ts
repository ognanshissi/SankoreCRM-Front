import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { form, FormField, required, validate } from '@angular/forms/signals';
import { TasTitle } from '@talisoft/ui/title';
import { TasError } from '@talisoft/ui/form-field';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { Anchor, Button } from '@talisoft/ui/button';
import { AuthenticationWrapper } from '../../components/authentication-wrapper';
import { PasswordStrength } from '../../components/password-strength';
import { firstUnmetPasswordCriterion } from '../../models/password-policy';
import { ResetPasswordModel } from '../../models/reset-password.model';
import {
  AuthApiService,
  ResetPasswordRequest,
  UsersApiService,
} from '@sankore/crm-api';
import { Loading } from '@sankore/crm/common';

type ResetPasswordStep = 'checking' | 'invalid' | 'form' | 'success';

@Component({
  templateUrl: './reset-password.html',
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
export class ResetPasswordComponent implements OnInit {
  private readonly _authApiService = inject(AuthApiService);
  private readonly _loadingService = inject(Loading);
  private readonly _snackbarService = inject(SnackbarService);

  public token = input<string>();
  public userId = input<string>();

  public step = signal<ResetPasswordStep>('checking');

  public model = signal(ResetPasswordModel.instantiate());

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
        this._authApiService.resetPassword({
          newPassword: this.formSchema()?.value().password,
          confirmPassword: this.formSchema()?.value().confirmPassword,
          userId: this.userId()!,
          token: this.token()!,
        } as ResetPasswordRequest),
      )
      .subscribe({
        next: () => this.step.set('success'),
        error: (err: HttpErrorResponse) => {
          // L'historique des 12 derniers mots de passe ne peut être vérifié que par le
          // serveur ; sans ce cas, un mot de passe déjà utilisé affichait « lien invalide ».
          if (err.error?.detail === 'PASSWORD_RECENTLY_USED') {
            this._snackbarService.error(
              'Mot de passe déjà utilisé',
              'Choisissez un mot de passe que vous n\'avez pas utilisé récemment.',
            );
            return;
          }
          this.step.set('invalid');
        },
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
      .showLoaderUntilCompleted(this._authApiService.validateResetToken(userId, token))
      .subscribe({
        next: () => this.step.set('form'),
        error: () => this.step.set('invalid'),
      });
  }
}

export default ResetPasswordComponent;
