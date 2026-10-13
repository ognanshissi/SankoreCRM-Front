import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { KycRemoteInvitationDto, KycRemoteInvitationListDto } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  kycRemoteInvitationPurposeLabel,
  kycRemoteInvitationStatusMeta,
  kycRemoteUnavailableLabel,
} from '../data-access/kyc-referential';
import {
  RevokeKycRemoteInvitationDrawer,
  RevokeKycRemoteInvitationDrawerData,
} from './revoke-kyc-remote-invitation-drawer';

/** Une ligne du suivi, prête à afficher. */
interface InvitationRow {
  id: string;
  statusLabel: string;
  statusSeverity: Severity;
  statusHint: string;
  purposeLabel: string;
  createdAt: string | null;
  expiresAt: string | null;
  sentAt: string | null;
  openedAt: string | null;
  identifiedAt: string | null;
  submittedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  lockedAt: string | null;
  failedAttempts: number;
  isSystemIssued: boolean;
  isActive: boolean;
}

/**
 * Suivi du lien de collecte à distance (KRM-F-07).
 *
 * Posé à deux endroits — l'onglet KYC de la fiche client et le détail du dossier — parce que c'est
 * la même question à deux moments : « où en est le client à qui on a envoyé un lien ? ».
 *
 * Deux partis pris portent l'essentiel de l'écran :
 *
 * 1. **Le motif d'indisponibilité vient du serveur et n'est pas déduit ici.** Les trois causes —
 *    pas d'email, produit non éligible, dossier plus en collecte — changent toutes seules, et le
 *    serveur les réévalue à chaque lecture. Les recalculer côté front, c'est garantir qu'un jour
 *    l'écran annoncera une cause que le serveur n'a pas retenue, et envoyer l'agent réparer la
 *    mauvaise chose.
 * 2. **Aucun jeton n'est affiché, et le contrat n'en porte aucun.** L'écran dit jusqu'où le client
 *    est allé ; il ne permet pas de retrouver, recopier ou renvoyer le lien précédent. Un agent qui
 *    veut que le client reprenne en envoie un nouveau, ce qui révoque l'ancien.
 */
@Component({
  selector: 'kyc-remote-invitations-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kyc-remote-invitations-panel.html',
  imports: [DatePipe, TasCard, Button, TasIcon, TasTag, TasSpinner],
})
export class KycRemoteInvitationsPanel {
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);

  /**
   * Le dossier dont on suit les liens. `null` pendant que l'écran parent le cherche — le panneau
   * ne s'affiche alors pas du tout plutôt que de montrer un état vide qui ressemblerait à
   * « aucun lien envoyé ».
   */
  public readonly kycFileId = input<string | null>(null);

  public readonly canInvite = this._permissions.can('kyc:remote-invite');

  public readonly isLoading = signal(false);
  public readonly loadFailed = signal(false);
  public readonly isIssuing = signal(false);
  public readonly data = signal<KycRemoteInvitationListDto | null>(null);

  /**
   * Dernier dossier chargé.
   *
   * L'`effect` du constructeur se déclenche à chaque passage du parent, et la fiche client
   * recharge son store à chaque action : sans cette garde, ouvrir un onglet relirait la liste
   * plusieurs fois pour le même dossier.
   */
  private _loadedFor: string | null = null;

  public readonly rows = computed<InvitationRow[]>(() =>
    (this.data()?.invitations ?? []).map((invitation) => this._toRow(invitation)),
  );

  public readonly current = computed(() => this.rows().find((row) => row.isActive) ?? null);

  public readonly past = computed(() => this.rows().filter((row) => !row.isActive));

  public readonly canIssue = computed(() => this.data()?.canIssue === true);

  public readonly unavailableMessage = computed(() =>
    kycRemoteUnavailableLabel(this.data()?.unavailableReason),
  );

  public readonly recipient = computed(() => this.data()?.recipientEmailMasked ?? null);

  public readonly validityHours = computed(() => this.data()?.linkValidityHours ?? null);

  /** Le libellé du bouton : « Envoyer » la première fois, « Renvoyer » ensuite. */
  public readonly issueLabel = computed(() =>
    this.rows().length === 0 ? 'Envoyer le lien' : 'Renvoyer le lien',
  );

  constructor() {
    effect(() => {
      const fileId = this.kycFileId();
      if (!fileId || fileId === this._loadedFor) return;
      this._loadedFor = fileId;
      this._load(fileId);
    });
  }

  public reload(): void {
    const fileId = this.kycFileId();
    if (fileId) this._load(fileId);
  }

  /**
   * Envoie ou renvoie le lien, après confirmation nommant le destinataire.
   *
   * La confirmation n'est pas une politesse : l'action poste une adresse d'accès au dossier d'un
   * client, et le serveur révoque au passage le lien que ce client détient peut-être déjà. Un
   * agent doit voir où cela part avant de cliquer.
   */
  public issue(): void {
    const fileId = this.kycFileId();
    if (!fileId || !this.canIssue() || this.isIssuing()) return;

    const recipient = this.recipient();
    const hours = this.validityHours();

    this._confirm.confirm({
      title: this.rows().length === 0 ? 'Envoyer le lien' : 'Renvoyer le lien',
      message:
        `Un lien à usage unique sera envoyé à ${recipient ?? "l'adresse enregistrée"}`
        + (hours ? `, valable ${hours} heures.` : '.')
        + (this.current() ? ' Le lien précédent sera immédiatement révoqué.' : ''),
      closable: true,
      icon: 'feather:send',
      acceptButtonProps: { label: 'Envoyer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler', theme: 'primary' },
      accept: () => this._issue(fileId),
    });
  }

  private _issue(fileId: string): void {
    this.isIssuing.set(true);

    this._facade
      .issueRemoteInvitation(fileId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isIssuing.set(false);
          this._snackbar.error('Erreur', issueErrorMessage(error));
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isIssuing.set(false);
        this._snackbar.success(
          'Lien envoyé',
          "Le client recevra l'email dans les prochaines minutes.",
        );
        // Le statut, les dates et le motif viennent du serveur : on relit plutôt que de deviner
        // ce qu'il a retenu.
        this._load(fileId);
      });
  }

  /** Révoque un lien. Le motif est saisi dans un drawer — il est obligatoire côté serveur. */
  public revoke(row: InvitationRow): void {
    const fileId = this.kycFileId();
    if (!fileId) return;

    const ref = this._drawer.open(RevokeKycRemoteInvitationDrawer, {
      data: {
        kycFileId: fileId,
        invitationId: row.id,
        statusLabel: row.statusLabel,
      } satisfies RevokeKycRemoteInvitationDrawerData,
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((revoked) => {
      if (revoked) this._load(fileId);
    });
  }

  private _toRow(invitation: KycRemoteInvitationDto): InvitationRow {
    const meta = kycRemoteInvitationStatusMeta(invitation.status);

    return {
      id: invitation.id ?? '',
      statusLabel: meta.label,
      statusSeverity: meta.severity,
      statusHint: meta.hint,
      purposeLabel: kycRemoteInvitationPurposeLabel(invitation.purpose),
      createdAt: invitation.createdAt ?? null,
      expiresAt: invitation.expiresAt ?? null,
      sentAt: invitation.sentAt ?? null,
      openedAt: invitation.openedAt ?? null,
      identifiedAt: invitation.identifiedAt ?? null,
      submittedAt: invitation.submittedAt ?? null,
      revokedAt: invitation.revokedAt ?? null,
      revokeReason: invitation.revokeReason?.trim() || null,
      lockedAt: invitation.lockedAt ?? null,
      failedAttempts: invitation.failedAttempts ?? 0,
      isSystemIssued: invitation.isSystemIssued === true,
      isActive: invitation.isActive === true,
    };
  }

  private _load(kycFileId: string): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);

    this._facade
      .listRemoteInvitations(kycFileId)
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((data) => {
        this.data.set(data);
        this.isLoading.set(false);
      });
  }
}

function issueErrorMessage(error: HttpErrorResponse): string {
  const code = error.error?.error;

  if (typeof code === 'string') {
    const translated = kycRemoteUnavailableLabel(code);
    if (translated) return translated;
  }

  if (error.status === 403) {
    return "Vous n'avez pas le droit d'envoyer un lien de collecte.";
  }

  return "Le lien n'a pas pu être envoyé.";
}
