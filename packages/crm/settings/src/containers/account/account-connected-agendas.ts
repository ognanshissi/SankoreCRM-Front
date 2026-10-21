import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, of } from 'rxjs';
import { ConnectedAccountDto, ConnectedAccountsApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TimeagoPipe } from '@talisoft/ui/timeago';

type ProviderCode = 'Microsoft' | 'Google';

interface ProviderView {
  code: ProviderCode;
  title: string;
  subtitle: string;
  badge: string;
  badgeTone: string;
  addLabel: string;
}

const PROVIDERS: ProviderView[] = [
  {
    code: 'Microsoft',
    title: 'Microsoft 365 et Outlook',
    subtitle: 'Outlook, Exchange, comptes professionnels et personnels',
    badge: 'M',
    badgeTone: 'bg-indigo-50 text-indigo-700',
    addLabel: 'Ajouter un compte Microsoft',
  },
  {
    code: 'Google',
    title: 'Google',
    subtitle: 'Google Agenda et Contacts, Gmail et Google Workspace',
    badge: 'G',
    badgeTone: 'bg-red-50 text-red-700',
    addLabel: 'Ajouter un compte Google',
  },
];

/** Ce que le retour du fournisseur dit, en clair. */
const OUTCOMES: Record<string, { kind: 'success' | 'info' | 'error'; title: string; message: string }> = {
  ok: { kind: 'success', title: 'Compte connecté', message: 'Ses agendas et contacts seront disponibles ici.' },
  refuse: { kind: 'info', title: 'Connexion annulée', message: 'Le compte n’a pas été connecté.' },
  expire: { kind: 'error', title: 'Lien expiré', message: 'La connexion a pris trop de temps : recommencez.' },
  erreur: { kind: 'error', title: 'Connexion impossible', message: 'Le fournisseur n’a pas accepté la connexion. Réessayez.' },
};

const ERRORS: Record<string, string> = {
  CONNECTED_ACCOUNT_PROVIDER_UNAVAILABLE: 'Ce fournisseur n’est pas configuré sur ce déploiement.',
  CONNECTED_ACCOUNT_ORIGIN_NOT_ALLOWED: 'Cette adresse du CRM n’est pas autorisée à connecter un compte.',
  CONNECTED_ACCOUNT_NEEDS_RECONNECT: 'Le fournisseur a refusé l’accès : reconnectez le compte.',
  CONNECTED_ACCOUNT_PROVIDER_ERROR: 'Le fournisseur ne répond pas pour le moment. Réessayez plus tard.',
  CONNECTED_ACCOUNT_NOT_FOUND: 'Ce compte n’existe plus.',
};

class RenameFormModel {
  public label!: string;

  public static of(label: string): RenameFormModel {
    return Object.assign(new RenameFormModel(), { label });
  }
}

/**
 * « Agendas et contacts connectés » (agendas connectés, lot 1) : les comptes Microsoft et Google
 * de l'utilisateur. Ajouter un compte part vers l'écran de consentement du fournisseur, qui
 * renvoie ici avec `?connexion=ok|refuse|expire|erreur`.
 *
 * Les comptes sont rendus en cartes et non en `tas-table` : quelques comptes de l'utilisateur
 * lui-même, jamais paginés, présentés comme la maquette le demande — l'exception des aperçus
 * courts déjà admise ailleurs. Le choix des agendas, l'import des contacts et l'agenda cible des
 * rendez-vous arrivent avec les lots 2, 4 et 5.
 */
@Component({
  selector: 'account-connected-agendas',
  templateUrl: './account-connected-agendas.html',
  imports: [Button, TasIcon, TasSpinner, TasInput, TasFormField, TasError, FormRoot, FormField, TimeagoPipe],
})
export class AccountConnectedAgendas implements OnInit {
  private readonly _api = inject(ConnectedAccountsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly providers = PROVIDERS;

  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  /**
   * 403 : la permission a été accordée après la connexion — l'onglet la voit (profil relu du
   * serveur), le jeton de session ne la porte pas encore. Se reconnecter la charge.
   */
  public readonly needsNewSession = signal(false);
  public readonly accounts = signal<ConnectedAccountDto[]>([]);
  public readonly available = signal<string[]>([]);
  /** Le compte dont le fournisseur est en cours d'ouverture, ou en cours d'action. */
  public readonly busy = signal<string | null>(null);
  public readonly renaming = signal<string | null>(null);

  public readonly byProvider = computed(() => {
    const groups: Record<string, ConnectedAccountDto[]> = {};
    for (const account of this.accounts()) (groups[account.provider ?? ''] ??= []).push(account);
    return groups;
  });

  public renameModel = signal(RenameFormModel.of(''));
  public renameForm = form(this.renameModel, (schema) => {
    required(schema.label, { message: 'Le nom est obligatoire' });
    validate(schema.label, (ctx) =>
      ctx.value().trim().length > 60 ? { kind: 'max', message: '60 caractères au plus' } : null,
    );
  });

  ngOnInit(): void {
    const outcome = this._route.snapshot.queryParamMap.get('connexion');

    if (outcome && OUTCOMES[outcome]) {
      const { kind, title, message } = OUTCOMES[outcome];
      this._snackbar[kind](title, message);
      // Le paramètre a servi : un rechargement ne doit pas réafficher le message.
      this._router.navigate([], { relativeTo: this._route, queryParams: {}, replaceUrl: true });
    }

    this.reload();
  }

  public reload(): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);

    this._api.listMyConnectedAccounts().pipe(
      catchError((err: HttpErrorResponse) => {
        this.needsNewSession.set(err.status === 403);
        this.loadFailed.set(true);
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((result) => {
      this.accounts.set(result.accounts ?? []);
      this.available.set(result.providers ?? []);
      this.isLoading.set(false);
    });
  }

  public isAvailable(provider: ProviderCode): boolean {
    return this.available().includes(provider);
  }

  /** Part vers l'écran de consentement du fournisseur ; il renvoie ici une fois le compte choisi. */
  public connect(provider: ProviderCode, label?: string | null): void {
    this.busy.set(provider);

    this._api.startConnectedAccount({ provider, label: label ?? null }).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Connexion impossible', this._message(err));
        this.busy.set(null);
        return EMPTY;
      }),
    ).subscribe((result) => {
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
      else this.busy.set(null);
    });
  }

  public sync(account: ConnectedAccountDto): void {
    this.busy.set(account.id ?? null);

    this._api.syncConnectedAccount(account.id!).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Synchronisation impossible', this._message(err));
        this.busy.set(null);
        this.reload();
        return EMPTY;
      }),
    ).subscribe((updated) => {
      this.accounts.update((all) => all.map((a) => (a.id === updated.id ? updated : a)));
      this.busy.set(null);
      this._snackbar.success('Compte synchronisé', `${updated.label} répond correctement.`);
    });
  }

  public remove(account: ConnectedAccountDto): void {
    this._confirm.confirm({
      title: 'Retirer ce compte ?',
      message: `« ${account.label} » (${account.email}) sera déconnecté de SANKORÉ. Ses agendas et ses contacts n’y apparaîtront plus.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Retirer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._api.removeConnectedAccount(account.id!).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Retrait impossible', this._message(err));
            return EMPTY;
          }),
        ).subscribe(() => {
          this.accounts.update((all) => all.filter((a) => a.id !== account.id));
          this._snackbar.success(
            'Compte retiré',
            account.provider === 'Microsoft'
              ? 'Pour révoquer aussi l’accès chez Microsoft : myaccount.microsoft.com › Confidentialité › Applications.'
              : 'L’accès a aussi été révoqué chez Google.',
          );
        });
      },
    });
  }

  public startRename(account: ConnectedAccountDto): void {
    this.renameModel.set(RenameFormModel.of(account.label ?? ''));
    this.renaming.set(account.id ?? null);
  }

  public saveRename(account: ConnectedAccountDto): void {
    submit(this.renameForm, async (field) => {
      const label = field().value().label.trim();
      let failed = false;

      await firstValueFrom(
        this._api.renameConnectedAccount(account.id!, { label }).pipe(
          catchError((err: HttpErrorResponse) => {
            failed = true;
            this._snackbar.error('Renommage impossible', this._message(err));
            return of(null);
          }),
        ),
        { defaultValue: null },
      );

      if (failed) return;
      this.accounts.update((all) => all.map((a) => (a.id === account.id ? { ...a, label } : a)));
      this.renaming.set(null);
    });
  }

  private _message(err: HttpErrorResponse): string {
    const code = typeof err.error?.detail === 'string' ? err.error.detail : null;
    return (code && ERRORS[code]) || 'Une erreur est survenue. Réessayez.';
  }
}

export default AccountConnectedAgendas;
