import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, of } from 'rxjs';
import { ConnectedAccountDto, ConnectedAccountsApiService, ConnectedCalendarDto, ConnectedMailboxApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { mailboxErrorMessage, mailSyncErrorLabel } from './connected-mailbox.labels';
import { ImapMailboxDrawer, ImapMailboxDrawerData } from './imap-mailbox-drawer';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { MailSignatureDrawer, MailSignatureDrawerData } from '@sankore/crm/tasks';

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

/** Le retour du fournisseur quand la connexion demandait aussi la messagerie (`&messagerie=…`). */
const MAIL_OUTCOMES: Record<string, { kind: 'success' | 'info'; title: string; message: string }> = {
  ok: { kind: 'success', title: 'Messagerie activée', message: 'Les e-mails échangés avec vos leads et clients des 30 derniers jours sont lus dans quelques instants.' },
  refusee: { kind: 'info', title: 'Messagerie non activée', message: 'Le droit d’accès aux e-mails n’a pas été accordé : seuls les agendas sont connectés.' },
};

const ERRORS: Record<string, string> = {
  CONNECTED_ACCOUNT_PROVIDER_UNAVAILABLE: 'Ce fournisseur n’est pas configuré sur ce déploiement.',
  CONNECTED_ACCOUNT_ORIGIN_NOT_ALLOWED: 'Cette adresse du CRM n’est pas autorisée à connecter un compte.',
  CONNECTED_ACCOUNT_NEEDS_RECONNECT: 'Le fournisseur a refusé l’accès : reconnectez le compte.',
  CONNECTED_ACCOUNT_PROVIDER_ERROR: 'Le fournisseur ne répond pas pour le moment. Réessayez plus tard.',
  CONNECTED_ACCOUNT_NOT_FOUND: 'Ce compte n’existe plus.',
  CALENDAR_READ_ONLY: 'Cet agenda est en lecture seule : choisissez-en un où vous pouvez écrire.',
};

/** « Ne pas copier » : une chaîne vide, `tas-select` travaillant en chaînes. */
const NO_TARGET = '';

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
 * courts déjà admise ailleurs. Les cases à cocher (lot 2) choisissent les agendas affichés ;
 * l'agenda cible (lot 4) reçoit une copie des rendez-vous SANKORÉ ; l'import des contacts viendra
 * avec le lot 5.
 *
 * Messagerie connectée (lot 4) : un compte Microsoft ou Google ACTIVE sa messagerie en repassant
 * par l'écran de consentement avec le droit mail ; toute autre boîte se connecte en IMAP/SMTP par
 * un tiroir. Seuls les e-mails échangés avec des leads et clients sont gardés côté serveur.
 */
@Component({
  selector: 'account-connected-agendas',
  templateUrl: './account-connected-agendas.html',
  imports: [Button, TasIcon, TasSpinner, TasInput, TasFormField, TasError, TasLabel, TasSelect, FormsModule, FormRoot, FormField, TimeagoPipe],
})
export class AccountConnectedAgendas implements OnInit {
  private readonly _api = inject(ConnectedAccountsApiService);
  private readonly _mailApi = inject(ConnectedMailboxApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
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

  public readonly imapAccounts = computed(() => this.accounts().filter((a) => a.provider === 'Imap'));

  public readonly mailSyncErrorLabel = mailSyncErrorLabel;

  public readonly byProvider = computed(() => {
    const groups: Record<string, ConnectedAccountDto[]> = {};
    for (const account of this.accounts()) (groups[account.provider ?? ''] ??= []).push(account);
    return groups;
  });

  /** Les agendas où l'on peut écrire : ceux qui peuvent recevoir les rendez-vous. */
  public readonly targetOptions = computed(() => [
    { label: 'Ne pas copier mes rendez-vous', value: NO_TARGET },
    ...this.accounts().flatMap((a) =>
      (a.calendars ?? [])
        .filter((c) => !c.isReadOnly)
        .map((c) => ({ label: `${a.label} · ${c.name}`, value: c.id ?? '' })),
    ),
  ]);

  public readonly target = computed(
    () => this.accounts().flatMap((a) => a.calendars ?? []).find((c) => c.isAppointmentTarget)?.id ?? NO_TARGET,
  );

  public readonly savingTarget = signal(false);

  public renameModel = signal(RenameFormModel.of(''));
  public renameForm = form(this.renameModel, (schema) => {
    required(schema.label, { message: 'Le nom est obligatoire' });
    validate(schema.label, (ctx) =>
      ctx.value().trim().length > 60 ? { kind: 'max', message: '60 caractères au plus' } : null,
    );
  });

  ngOnInit(): void {
    const outcome = this._route.snapshot.queryParamMap.get('connexion');
    const mailOutcome = this._route.snapshot.queryParamMap.get('messagerie');

    if (outcome && OUTCOMES[outcome]) {
      // Une connexion qui demandait la messagerie dit ce qu'il en est de la messagerie : c'est ce
      // que l'utilisateur venait faire.
      const { kind, title, message } = outcome === 'ok' && mailOutcome && MAIL_OUTCOMES[mailOutcome] ? MAIL_OUTCOMES[mailOutcome] : OUTCOMES[outcome];
      this._snackbar[kind](title, message);
      // Le paramètre a servi : un rechargement ne doit pas réafficher le message.
      this._router.navigate([], { relativeTo: this._route, queryParams: {}, replaceUrl: true });

      // Les agendas d'un compte qui vient d'être connecté sont lus en arrière-plan : on relit
      // une fois, quelques secondes plus tard, pour les faire apparaître sans rechargement.
      if (outcome === 'ok') setTimeout(() => this.reload(), 5000);
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

  /**
   * Part vers l'écran de consentement du fournisseur ; il renvoie ici une fois le compte choisi.
   * `account` : reconnecter ce compte (son adresse est préremplie, sa messagerie redemandée si elle
   * était active) ; `includeMail` : demander aussi le droit de lire et d'envoyer ses e-mails.
   */
  public connect(provider: ProviderCode, account?: ConnectedAccountDto | null, includeMail = false): void {
    this.busy.set(account?.id ?? provider);

    this._api.startConnectedAccount({ provider, label: account?.label ?? null, includeMail, accountId: account?.id ?? null }).pipe(
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
      message: account.provider === 'Imap'
        ? `« ${account.label} » (${account.email}) sera déconnectée de SANKORÉ, et les e-mails qui en avaient été gardés effacés. Votre boîte elle-même n’est pas touchée.`
        : `« ${account.label} » (${account.email}) sera déconnecté de SANKORÉ. Ses agendas, ses contacts et les e-mails qui en avaient été gardés n’y apparaîtront plus.`,
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
              : account.provider === 'Google'
                ? 'L’accès a aussi été révoqué chez Google.'
                : 'Le mot de passe enregistré a été effacé.',
          );
        });
      },
    });
  }

  /**
   * Coche ou décoche un agenda. Décocher efface ce qui en avait été lu ; cocher le relit en
   * arrière-plan — d'où la relecture différée.
   */
  public toggleCalendar(account: ConnectedAccountDto, calendar: ConnectedCalendarDto, selected: boolean): void {
    const apply = (value: boolean) =>
      this.accounts.update((all) => all.map((a) => a.id !== account.id ? a : {
        ...a,
        calendars: (a.calendars ?? []).map((c) => c.id === calendar.id ? { ...c, isSelected: value, eventCount: value ? c.eventCount : 0 } : c),
      }));

    apply(selected);

    this._api.selectConnectedCalendar(account.id!, calendar.id!, { isSelected: selected }).pipe(
      catchError((err: HttpErrorResponse) => {
        apply(!selected);
        this._snackbar.error('Agenda non modifié', this._message(err));
        return EMPTY;
      }),
    ).subscribe(() => {
      if (selected) setTimeout(() => this.reload(), 4000);
    });
  }

  /**
   * L'agenda qui reçoit une copie des rendez-vous SANKORÉ, ou aucun. Appliqué tout de suite,
   * comme les cases à cocher : les rendez-vous à venir y sont recopiés en arrière-plan.
   */
  public setTarget(calendarId: string): void {
    const previous = this.target();
    if (calendarId === previous) return;

    const apply = (id: string) =>
      this.accounts.update((all) => all.map((a) => ({
        ...a,
        calendars: (a.calendars ?? []).map((c) => ({ ...c, isAppointmentTarget: c.id === id })),
      })));

    apply(calendarId);
    this.savingTarget.set(true);

    this._api.setAppointmentTarget({ calendarId: calendarId || null }).pipe(
      catchError((err: HttpErrorResponse) => {
        apply(previous);
        this.savingTarget.set(false);
        this._snackbar.error('Agenda cible non modifié', this._message(err));
        return EMPTY;
      }),
    ).subscribe(() => {
      this.savingTarget.set(false);
      this._snackbar.success(
        calendarId ? 'Agenda cible enregistré' : 'Copie arrêtée',
        calendarId
          ? 'Vos rendez-vous à venir y sont copiés dans quelques instants, puis chaque nouveau rendez-vous.'
          : 'Vos rendez-vous à venir sont retirés de l’agenda où ils avaient été copiés.',
      );
    });
  }

  // ── Messagerie (lot 4) ───────────────────────────────────────────────

  public enableMail(account: ConnectedAccountDto): void {
    this.connect(account.provider as ProviderCode, account, true);
  }

  public disableMail(account: ConnectedAccountDto): void {
    this._confirm.confirm({
      title: 'Désactiver la messagerie ?',
      message: `SANKORÉ cessera de lire et d’envoyer les e-mails de « ${account.label} », et effacera ceux qu’il en avait gardés. Ses agendas restent connectés.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._api.disableMailbox(account.id!).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Messagerie non désactivée', mailboxErrorMessage(err));
            return EMPTY;
          }),
        ).subscribe(() => {
          this.accounts.update((all) => all.map((a) => (a.id === account.id ? { ...a, mailEnabled: false, mailSyncedAt: null, mailLastError: null } : a)));
          this._snackbar.success('Messagerie désactivée', 'Les e-mails gardés de ce compte ont été effacés.');
        });
      },
    });
  }

  /** La signature de la boîte, ajoutée sous ses nouveaux messages et ses réponses. */
  public openSignature(account: ConnectedAccountDto): void {
    this._sideDrawer
      .open<string | null, MailSignatureDrawerData, MailSignatureDrawer>(MailSignatureDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { accountId: account.id!, email: account.email ?? '', signature: account.mailSignature ?? null },
      })
      .closed.subscribe((signature) => {
        if (signature === undefined) return;
        this.accounts.update((all) => all.map((a) => (a.id === account.id ? { ...a, mailSignature: signature } : a)));
      });
  }

  /** La lecture se fait en arrière-plan (202) : on relit l'état quelques secondes plus tard. */
  public syncMail(account: ConnectedAccountDto): void {
    this.busy.set(account.id ?? null);

    this._mailApi.syncMyMailbox(account.id!).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Lecture impossible', mailboxErrorMessage(err));
        this.busy.set(null);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.busy.set(null);
      this._snackbar.info('Lecture lancée', 'Les nouveaux e-mails apparaîtront dans quelques instants.');
      setTimeout(() => this.reload(), 6000);
    });
  }

  public openImap(account: ConnectedAccountDto | null): void {
    this._sideDrawer
      .open<ConnectedAccountDto | null, ImapMailboxDrawerData, ImapMailboxDrawer>(ImapMailboxDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { account },
      })
      .closed.subscribe((saved) => {
        if (!saved) return;
        this.accounts.update((all) => (all.some((a) => a.id === saved.id) ? all.map((a) => (a.id === saved.id ? saved : a)) : [...all, saved]));
        setTimeout(() => this.reload(), 6000);
      });
  }

  public eventsLabel(calendar: ConnectedCalendarDto): string {
    if (calendar.isSubscription) return 'abonnement';
    if (!calendar.isSelected) return 'non affiché';
    const count = calendar.eventCount ?? 0;
    return `${count} événement${count > 1 ? 's' : ''}`;
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
