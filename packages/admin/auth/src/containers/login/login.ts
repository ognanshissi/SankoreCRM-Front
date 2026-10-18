import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { email, form, FormField, FormRoot, required } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { AdminAuthService } from '../../services/admin-auth.service';

class LoginFormModel {
  public email!: string;
  public password!: string;

  public static instantiate(): LoginFormModel {
    const m = new LoginFormModel();
    m.email = '';
    m.password = '';
    return m;
  }
}

@Component({
  templateUrl: './login.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, TasFormField, TasLabel, TasError, TasInput, TasInputPassword, TasIcon, Button],
})
export class AdminLogin {
  private readonly _auth = inject(AdminAuthService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  /** Message du serveur, affiché sous le formulaire et non en toast : il dit quoi corriger ici. */
  public serverError = signal<string | null>(null);

  public model = signal(LoginFormModel.instantiate());
  public formSchema = form(
    this.model,
    (schema) => {
      required(schema.email, { message: 'L’adresse électronique est obligatoire' });
      email(schema.email, { message: 'L’adresse électronique n’est pas valide' });
      required(schema.password, { message: 'Le mot de passe est obligatoire' });
    },
    {
      submission: {
        action: async (field) => {
          this.serverError.set(null);
          const { email: address, password } = field().value();
          const admin = await firstValueFrom(
            this._auth.login(address.trim(), password).pipe(
              catchError((error: unknown) => {
                this.serverError.set(this._describe(error));
                return EMPTY;
              }),
            ),
            { defaultValue: null },
          );
          if (admin) {
            await this._router.navigateByUrl(this._safeRedirect());
          }
        },
      },
    },
  );

  /** Seul un chemin interne est suivi : un `redirectPath` absolu ferait de la page un rebond ouvert. */
  private _safeRedirect(): string {
    const target = this._route.snapshot.queryParamMap.get('redirectPath');
    return target && target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/auth')
      ? target
      : '/';
  }

  private _describe(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Le serveur d’administration est injoignable.';
      if (error.status === 429) return 'Trop de tentatives. Patientez une minute avant de réessayer.';
      if (typeof error.error?.detail === 'string') return error.error.detail;
    }
    return 'La connexion a échoué. Réessayez.';
  }
}

export default AdminLogin;
