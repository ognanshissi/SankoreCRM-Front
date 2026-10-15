import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ReviewKycDocumentRequestDecisionEnum } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  kycDocumentDecisionMeta,
  kycDocumentKindLabel,
} from '../data-access/kyc-referential';
import { KycDocumentList, KycDocumentRow } from '../data-access/kyc.types';
import {
  RefuseKycDocumentDrawer,
  RefuseKycDocumentDrawerData,
} from './refuse-kyc-document-drawer';

/**
 * Motif inscrit dans `kyc_document_access_logs` à chaque ouverture d'image depuis ce panneau.
 *
 * Fixe, et distinct de celui de la fiche : il dit d'où vient l'accès, ce qui est l'information utile
 * à qui relit la table. Un champ libre proposé à chaque clic serait rempli d'un caractère.
 */
const DOCUMENT_REVEAL_REASON = 'Consultation de la pièce depuis la validation des pièces';

export interface KycDocumentsSummary {
  tone: 'success' | 'warning' | 'error' | 'neutral';
  icon: string;
  title: string;
  message: string;
}

/** Les statuts où le serveur accepte un verdict sur une pièce. */
const REVIEWABLE_STATUSES = new Set(['Verifying', 'Validating']);

/**
 * Pièces du dossier et leur validation (KYC-F-02).
 *
 * Remplace l'ancien onglet qui n'affichait qu'une image : avant le registre, rien ne représentait
 * une pièce déposée — le dépôt rendait une référence opaque, et la seule récupérable ensuite était
 * celle de la pièce lue par l'OCR. C'est ce qui empêchait de rouvrir le selfie et le verso, et ce
 * qui ne laissait nulle part accrocher un verdict.
 *
 * Deux règles tranchées par le propriétaire du produit, que ce panneau rend visibles :
 *
 * - **Accepter ne fait rien avancer.** Accepter la dernière pièce en attente ne valide pas le
 *   dossier ; le panneau le dit en proposant alors la décision de dossier, pas en la prenant.
 * - **Refuser renvoie le dossier en complément**, motif attaché, pour que l'agent reproduise une
 *   image exploitable.
 *
 * Seule la pièce **courante** de chaque nature se décide : une image remplacée reste affichée comme
 * historique, sans action, parce que renvoyer le dossier en complément sur une photo que l'agent a
 * déjà remplacée serait une impasse. Le serveur refuse de toute façon avec
 * `KYC_DOCUMENT_NOT_CURRENT` — l'écran évite d'y conduire.
 *
 * Les pièces sont rendues en grille de cartes, sans `tas-table` : choix explicite du propriétaire
 * pour cet écran, où chaque pièce porte son aperçu d'image.
 */
@Component({
  selector: 'kyc-documents-panel',
  templateUrl: './kyc-documents-panel.html',
  imports: [DatePipe, Button, TasIcon, TasSpinner, TasTag],
})
export class KycDocumentsPanel {
  private readonly _facade = inject(KycFacadeService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly kycFileId = input.required<string>();

  /** Remonté au parent pour qu'il rafraîchisse le dossier : un refus change son statut. */
  public readonly fileChanged = output<void>();

  /** Une pièce a été décidée : le parent relit la liste pour le compteur de l'onglet. */
  public readonly documentsChanged = output<void>();

  /** « Passer à la validation » : le parent change d'onglet. */
  public readonly goToValidation = output<void>();

  /** Décider demande `kyc:document:validate`, ouvrir une image `kyc:document:reveal`. */
  public readonly canValidate = this._permissions.can('kyc:document:validate');
  public readonly canReveal = this._permissions.can('kyc:document:reveal');

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly list = signal<KycDocumentList | null>(null);

  /** Pièce en cours d'acceptation, pour n'immobiliser que sa ligne. */
  public readonly acceptingId = signal<string | null>(null);

  // ——— Aperçu d'image, une à la fois ———
  public readonly revealedStorageRef = signal<string | null>(null);
  public readonly revealedImageUrl = signal<string | null>(null);
  public readonly revealingStorageRef = signal<string | null>(null);
  public readonly revealError = signal<string | null>(null);

  private readonly _reloadToken = signal(0);

  public readonly kycDocumentKindLabel = kycDocumentKindLabel;
  public readonly kycDocumentDecisionMeta = kycDocumentDecisionMeta;

  public readonly rows = computed(() => this.list()?.documents ?? []);


  /**
   * Vrai quand le dossier est dans un statut où le serveur accepte un verdict. Hors de là, les
   * actions sont masquées plutôt que proposées pour échouer en 409.
   */
  public readonly isReviewable = computed(() =>
    REVIEWABLE_STATUSES.has(this.list()?.fileStatus ?? ''),
  );

  /** Le constat que le panneau remonte : toutes les pièces courantes sont acceptées. */
  public readonly allAccepted = computed(() => this.list()?.allCurrentAccepted ?? false);
  public readonly anyNotReviewed = computed(() => this.list()?.anyNotReviewed ?? false);


  /** Le constat en tête d'onglet : ce qui reste à faire sur les pièces, ou qu'il n'y a plus rien. */
  public readonly summary = computed<KycDocumentsSummary>(() => {
    const current = this.rows().filter((row) => row.isCurrentForKind);
    const pending = current.filter((row) => row.decision === 'Pending').length;
    const refused = current.filter((row) => row.decision === 'Refused').length;

    if (current.length === 0) {
      return { tone: 'neutral', icon: 'feather:image', title: 'Aucune pièce déposée',
        message: 'Les pièces se déposent depuis l\'enrôlement, ou par le client via le lien à distance.' };
    }
    if (this.allAccepted()) {
      return { tone: 'success', icon: 'feather:check', title: 'Toutes les pièces sont acceptées',
        message: 'Le dossier peut maintenant être validé.' };
    }
    if (refused > 0) {
      return { tone: 'error', icon: 'feather:x', title: `${refused} pièce${refused > 1 ? 's' : ''} refusée${refused > 1 ? 's' : ''}`,
        message: 'Le dossier attend un complément du client avant de pouvoir être validé.' };
    }
    if (pending > 0) {
      return { tone: 'warning', icon: 'feather:clock', title: `${pending} pièce${pending > 1 ? 's' : ''} à examiner`,
        message: this.isReviewable()
          ? 'Acceptez ou refusez chaque pièce avant la validation du dossier.'
          : 'Les pièces ne se décident que sur un dossier en vérification ou en validation.' };
    }
    return { tone: 'neutral', icon: 'feather:help-circle', title: 'Pièces sans verdict',
      message: 'Collectées avant la revue pièce à pièce : le dossier a été décidé dans son ensemble.' };
  });

  constructor() {
    this._destroyRef.onDestroy(() => this._replaceImageUrl(null));

    effect(() => {
      const kycFileId = this.kycFileId();
      this._reloadToken();

      // Changer de dossier ou recharger ne doit pas laisser à l'écran l'image du précédent.
      // `untracked` : la révocation lit `revealedImageUrl`, et cette lecture ferait de l'effet son
      // propre déclencheur — donc un rechargement de la liste à chaque ouverture d'image.
      untracked(() => {
        this._replaceImageUrl(null);
        this.revealedStorageRef.set(null);
        this.revealError.set(null);
      });

      this.isLoading.set(true);
      this.loadError.set(null);

      this._facade
        .listDocuments(kycFileId)
        .pipe(
          takeUntilDestroyed(this._destroyRef),
          catchError((err: HttpErrorResponse) => {
            this.loadError.set(
              err.status === 404
                ? "Ce dossier n'existe pas ou n'est pas dans votre périmètre."
                : "La liste des pièces n'a pas pu être chargée.",
            );
            this.isLoading.set(false);
            return EMPTY;
          }),
        )
        .subscribe((list) => {
          this.list.set(list);
          this.isLoading.set(false);
        });
    });
  }

  public reload(): void {
    this._reloadToken.update((token) => token + 1);
  }

  /** Une pièce ne se décide que si elle est courante, encore en attente, et le dossier ouvert. */
  public canDecide(row: KycDocumentRow): boolean {
    return (
      this.canValidate() &&
      this.isReviewable() &&
      row.isCurrentForKind &&
      row.decision === 'Pending' &&
      !!row.id
    );
  }

  // ——— Décisions ———

  public async accept(row: KycDocumentRow): Promise<void> {
    if (!this.canDecide(row) || !row.id || this.acceptingId()) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      this._confirmDialogService.confirm({
        title: 'Accepter cette pièce ?',
        // Dit explicitement ce que l'acceptation ne fait pas : c'est la règle produit la plus
        // surprenante de l'écran, et la découvrir après coup fait chercher un bug.
        message: `${kycDocumentKindLabel(row.kind)} sera marquée acceptée à votre nom. Le dossier ne change pas d'état : la décision de dossier reste à prendre séparément. Une pièce ne se décide qu'une fois.`,
        closable: true,
        acceptButtonProps: { label: 'Accepter', theme: 'primary' },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });

    if (!confirmed) return;

    this.acceptingId.set(row.id);

    this._facade
      .reviewDocument(
        this.kycFileId(),
        row.id,
        ReviewKycDocumentRequestDecisionEnum.Accepted,
        null,
      )
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Acceptation impossible', this._decisionError(err));
          this.acceptingId.set(null);
          // La liste est rechargée même en échec : un 409 veut dire qu'elle est périmée.
          this.reload();
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success('Pièce acceptée', 'Le dossier reste en attente de sa décision.');
        this.acceptingId.set(null);
        this.reload();
        this.documentsChanged.emit();
      });
  }

  public refuse(row: KycDocumentRow): void {
    if (!this.canDecide(row) || !row.id) return;

    const ref = this._sideDrawerService.open(RefuseKycDocumentDrawer, {
      data: {
        kycFileId: this.kycFileId(),
        documentId: row.id,
        kindLabel: kycDocumentKindLabel(row.kind),
      } satisfies RefuseKycDocumentDrawerData,
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((refused) => {
      if (!refused) return;
      this.reload();
      this.documentsChanged.emit();
      // Un refus a changé le statut du dossier : le parent doit le relire.
      this.fileChanged.emit();
    });
  }

  // ——— Aperçu d'image ———

  /**
   * Ouvre l'image d'une pièce. Jamais au chargement de la liste : le serveur journalise chaque
   * lecture au nom de son auteur, et un accès inscrit sans que personne ne l'ait demandé rend la
   * table d'audit inexploitable.
   */
  public reveal(row: KycDocumentRow): void {
    if (!this.canReveal() || this.revealingStorageRef()) return;

    // Déjà ouverte : on referme, pour que les octets ne restent pas à l'écran.
    if (this.revealedStorageRef() === row.storageRef) {
      this.hide();
      return;
    }

    this.revealingStorageRef.set(row.storageRef);
    this.revealError.set(null);

    this._facade
      .readDocumentImage(this.kycFileId(), row.storageRef, DOCUMENT_REVEAL_REASON)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError((err: HttpErrorResponse) => {
          this.revealError.set(
            err.status === 403
              ? "Vous n'avez pas le droit d'ouvrir les images de ce dossier."
              : "L'image n'a pas pu être ouverte. Réessayez.",
          );
          this.revealingStorageRef.set(null);
          return EMPTY;
        }),
      )
      .subscribe((blob) => {
        this._replaceImageUrl(URL.createObjectURL(blob));
        this.revealedStorageRef.set(row.storageRef);
        this.revealingStorageRef.set(null);
      });
  }

  public hide(): void {
    this._replaceImageUrl(null);
    this.revealedStorageRef.set(null);
  }

  private _replaceImageUrl(next: string | null): void {
    const previous = this.revealedImageUrl();
    this.revealedImageUrl.set(next);
    if (previous) URL.revokeObjectURL(previous);
  }

  /** Taille lisible. Null pour une pièce antérieure au registre — jamais persistée. */
  public formatSize(bytes: number | null): string {
    if (bytes === null) return '—';
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  private _decisionError(error: HttpErrorResponse): string {
    if (error.status === 403) return "Vous n'avez pas le droit de valider les pièces d'un dossier.";

    if (error.status === 409) {
      switch (error.error?.error) {
        case 'KYC_DOCUMENT_ALREADY_REVIEWED':
          return 'Cette pièce a déjà été décidée.';
        case 'KYC_DOCUMENT_NOT_CURRENT':
          return "Une image plus récente a remplacé celle-ci : c'est la nouvelle qu'il faut examiner.";
        case 'KYC_INVALID_TRANSITION':
          return "Le dossier n'est plus dans un état où une pièce peut être décidée.";
        default:
          return 'Le dossier a changé entre-temps.';
      }
    }

    return error.error?.title ?? "La décision n'a pas pu être enregistrée.";
  }
}
