import { Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, firstValueFrom, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  KycFileDto,
  RunKycVerificationRequestDocumentTypeEnum,
} from '@sankore/crm-api';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { KycDraftStore } from '../data-access/kyc-draft.store';
import { KycImageRef } from '../data-access/kyc.types';
import { isKycDocumentType } from '../data-access/kyc-referential';
import { KycDocumentCapture } from '../capture/kyc-document-capture';
import { KycSelfieCapture } from '../capture/kyc-selfie-capture';
import { KycScorePanel } from '../verification/kyc-score-panel';
import { KycStatusBadge } from '../ui/kyc-status-badge';
import {
  ClearDuplicateFlagDrawer,
  ClearDuplicateFlagDrawerData,
} from './clear-duplicate-flag-drawer';

type Step = 'document' | 'selfie' | 'summary';

const STEPS: { key: Step; label: string }[] = [
  { key: 'document', label: "Pièce d'identité" },
  { key: 'selfie', label: 'Photo du visage' },
  { key: 'summary', label: 'Récapitulatif' },
];

/** Ce qui est repris après une coupure. Aucune donnée d'état civil : elle vit sur la fiche client. */
interface KycEnrolmentDraft {
  customerId: string;
  kycFileId: string;
  step: Step;
  documentStorageRef: string | null;
  documentImageUrl: string | null;
  /** Nature de la pièce : la vérification de l'étape du selfie l'exige, après une coupure comprise. */
  documentType: RunKycVerificationRequestDocumentTypeEnum | null;
  selfieStorageRef: string | null;
  overrideComment: string | null;
}

/**
 * Enrôlement KYC guidé (KYC-F-01), **adossé au parcours client existant**.
 *
 * Décision de périmètre : le dossier KYC ne porte aucune donnée d'état civil ni de coordonnées — ces
 * champs appartiennent au client, et `customers/create-client` les saisit déjà (parcours particulier
 * et personne morale, avec détection de doublons). Réécrire ici un stepper « type de client, état
 * civil, coordonnées » aurait dupliqué 3 500 lignes et créé deux formulaires à maintenir pour la même
 * saisie. Cet écran ne porte donc que les trois étapes qui appartiennent au KYC — pièce, visage,
 * récapitulatif — et renvoie vers la fiche client pour le reste.
 *
 * **La soumission est une déduction, à confirmer côté backend.** Le contrat n'expose aucune opération
 * « soumettre le dossier ». `GET /approval` distingue un circuit non ouvert (aperçu calculé) d'un
 * circuit ouvert (étapes persistées), et `POST /approval/decisions` accepte le niveau `Agent`. On en
 * déduit que l'agent soumet en se prononçant à son propre niveau. Si le backend prévoit autre chose,
 * c'est `submit()` qu'il faudra corriger, et lui seul.
 */
@Component({
  selector: 'kyc-enrolment',
  templateUrl: './kyc-enrolment.html',
  imports: [
    RouterLink,
    TasCard,
    TasSpinner,
    TasIcon,
    Button,
    KycDocumentCapture,
    KycSelfieCapture,
    KycScorePanel,
    KycStatusBadge,
  ],
})
export class KycEnrolmentPage {
  private readonly _facade = inject(KycFacadeService);
  private readonly _drafts = inject(KycDraftStore);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);

  /** Identifiant du client à enrôler, lu depuis la route. */
  public readonly customerId = input.required<string>();

  public readonly steps = STEPS;
  /** Même droit que sur l'écran de détail : voir `kyc-file-detail.ts`. */
  public readonly canSeeRawDetail = this._permissions.can('kyc:document:reveal');
  /** Droit de valider les pièces à la main quand la biométrie n'a pas tranché. */
  public readonly canValidateManually = this._permissions.can('kyc:document:validate');

  /**
   * Lever un signalement de doublon a son propre droit (`kyc:duplicate:clear`), distinct de
   * `kyc:manage` : enrôler et décider qu'un doublon n'en est pas un ne sont pas le même geste.
   */
  public readonly canClearDuplicate = this._permissions.can('kyc:duplicate:clear');

  private readonly _scorePanel = viewChild(KycScorePanel);

  public isLoading = signal(true);
  public loadError = signal('');
  public file = signal<KycFileDto | null>(null);
  public customerName = signal('');

  public step = signal<Step>('document');
  public documentRef = signal<KycImageRef | null>(null);
  /** Choisi à l'étape de la pièce, réutilisé par la comparaison faciale qui appelle le même endpoint. */
  public documentType = signal<RunKycVerificationRequestDocumentTypeEnum | null>(null);
  public selfieRef = signal<string | null>(null);
  public overrideComment = signal<string | null>(null);
  public isSubmitting = signal(false);
  public submitted = signal(false);

  public readonly lastSavedAt = this._drafts.lastSavedAt;
  public readonly draftUnavailable = this._drafts.isUnavailable;

  public readonly stepIndex = computed(() => STEPS.findIndex((s) => s.key === this.step()));

  /** Le selfie n'a de sens qu'une fois la pièce déposée : la comparaison a besoin des deux. */
  public readonly canReachSelfie = computed(() => !!this.documentRef());
  public readonly canReachSummary = computed(() => !!this.documentRef() && !!this.selfieRef());

  /** Un override après échec de comparaison impose un passage par le chef d'agence. */
  public readonly needsManagerValidation = computed(() => !!this.overrideComment());

  /**
   * Doublon suspecté, tel que le serveur l'a posé sur le dossier.
   *
   * Affiché pendant l'enrôlement et non seulement sur la fiche : c'est ici que l'agent a le client
   * devant lui, donc le seul moment où la question « est-ce vraiment la même personne ? » peut être
   * tranchée autrement qu'en relisant un écran.
   */
  public readonly duplicateSuspected = computed(() => !!this.file()?.duplicateSuspected);

  constructor() {
    effect(() => {
      const customerId = this.customerId();
      if (customerId) this._open(customerId);
    });
  }

  public goToStep(step: Step): void {
    if (step === 'selfie' && !this.canReachSelfie()) return;
    if (step === 'summary' && !this.canReachSummary()) return;
    this.step.set(step);
    void this._saveDraft();
  }

  public onDocumentTypeSelected(type: RunKycVerificationRequestDocumentTypeEnum): void {
    if (this.documentType() === type) return;
    this.documentType.set(type);
    void this._saveDraft();
  }

  public onDocumentUploaded(ref: KycImageRef): void {
    this.documentRef.set(ref);
    void this._saveDraft();
    // La vérification tourne en arrière-plan côté écran de capture : on avance sans l'attendre.
    this.step.set('selfie');
  }

  public onSelfieMatched(matched: boolean): void {
    // La référence du selfie n'est pas remontée par le composant : on marque l'étape franchie, le
    // score du récapitulatif est relu depuis le serveur de toute façon.
    this.selfieRef.set('captured');
    if (matched) this.overrideComment.set(null);
    void this._saveDraft();
    this.step.set('summary');
    this._scorePanel()?.refresh();
  }

  public onSubmittedWithOverride(comment: string): void {
    this.overrideComment.set(comment);
    this.selfieRef.set('captured');
    void this._saveDraft();
    this.step.set('summary');
    this._scorePanel()?.refresh();
  }

  /**
   * Fin de l'enrôlement.
   *
   * **Il n'existe aucune opération « soumettre » au contrat, et ce n'est pas un oubli.** Un dossier
   * entre dans le circuit par `POST /verify`, que les écrans de capture appellent déjà : une
   * vérification réussie l'y place toute seule. Il ne reste donc rien à envoyer dans le cas nominal.
   *
   * Ce code appelait `decide(Agent, Approved, …)`, déduit à une époque où le contrat ne disait rien.
   * Il le dit maintenant : « the agent who submitted the file can never approve or refuse it ».
   * L'appel partait donc en 403 systématique, et le message affiché — « vérifiez votre rôle dans le
   * circuit » — envoyait l'agent chercher la cause du mauvais côté.
   *
   * Reste le cas où la machine n'a pas tranché : comparaison faciale en échec que l'agent a écrasée
   * avec un commentaire. C'est exactement ce que `POST /manual-validation` couvre, et son motif
   * obligatoire est ce commentaire. Il exige `kyc:document:validate`, que l'agent qui enrôle n'a pas
   * forcément : sans ce droit, on le dit plutôt que de laisser le serveur répondre 403.
   */
  public async submit(): Promise<void> {
    const file = this.file();
    if (!file?.id || this.isSubmitting()) return;

    const comment = this.overrideComment();

    // Cas nominal : `verify` a déjà fait entrer le dossier dans le circuit, rien à envoyer.
    if (!comment) {
      this.submitted.set(true);
      this._drafts.discard(this._draftId());
      this._snackbar.success(
        'Enrôlement terminé',
        'La vérification a placé le dossier dans le circuit de validation.',
      );
      this._reloadFile();
      return;
    }

    if (!this.canValidateManually()) {
      this._snackbar.info(
        'Validation manuelle requise',
        "La comparaison faciale n'a pas abouti : un profil habilité doit valider les pièces à la "
          + 'main depuis la fiche du dossier. Votre commentaire y est déjà rattaché.',
      );
      this.submitted.set(true);
      this._drafts.discard(this._draftId());
      this._reloadFile();
      return;
    }

    this.isSubmitting.set(true);
    const result = await firstValueFrom(
      this._facade.manuallyValidate(file.id, comment).pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Validation refusée', this._submitError(error));
          this.isSubmitting.set(false);
          return of(null);
        }),
      ),
    );

    this.isSubmitting.set(false);
    if (!result) return;

    this.submitted.set(true);
    this._drafts.discard(this._draftId());
    this._snackbar.success(
      'Dossier validé à la main',
      "Le dossier entre dans le circuit, avec le chef d'agence ajouté aux niveaux à signer.",
    );
    this._reloadFile();
  }

  /**
   * Ouvre la levée du signalement. Le dossier est **relu** au retour : le serveur peut avoir changé
   * autre chose que le drapeau, et c'est lui qui dit si la levée a pris.
   */
  public openClearDuplicateDrawer(): void {
    const kycFileId = this.file()?.id;
    if (!kycFileId || !this.canClearDuplicate()) return;

    const data: ClearDuplicateFlagDrawerData = {
      kycFileId,
      customerName: this.customerName() || null,
    };

    const ref = this._sideDrawerService.open<
      boolean,
      ClearDuplicateFlagDrawerData,
      ClearDuplicateFlagDrawer
    >(ClearDuplicateFlagDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((cleared) => {
      if (cleared) this._reloadFile();
    });
  }

  public openFile(): void {
    const id = this.file()?.id;
    if (id) this._router.navigate(['/kyc', id]);
  }

  public discardDraft(): void {
    this._drafts.discard(this._draftId());
    this.documentRef.set(null);
    this.documentType.set(null);
    this.selfieRef.set(null);
    this.overrideComment.set(null);
    this.step.set('document');
    this._snackbar.info('Brouillon supprimé', 'La saisie repart de la première étape.');
  }

  public retry(): void {
    this._open(this.customerId());
  }

  private _draftId(): string {
    return `enrolment:${this.customerId()}`;
  }

  /**
   * Ouvre le dossier du client. `POST /kyc-files` est **idempotent** : il répond le dossier existant
   * plutôt que de refuser, ce qui permet de l'appeler à chaque entrée sans vérifier d'abord.
   */
  private _open(customerId: string): void {
    this.isLoading.set(true);
    this.loadError.set('');

    this._facade
      .createFile(customerId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(
            error.status === 403
              ? "Vous n'avez pas le droit d'ouvrir un dossier KYC pour ce client."
              : "Le dossier KYC n'a pas pu être ouvert.",
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((created) => {
        const kycFileId = created?.kycFileId;
        if (!kycFileId) {
          this.loadError.set("Le serveur n'a pas renvoyé d'identifiant de dossier.");
          this.isLoading.set(false);
          return;
        }
        this._loadFile(kycFileId);
        void this._restoreDraft(kycFileId);
      });
  }

  private _loadFile(kycFileId: string): void {
    this._facade
      .getFile(kycFileId)
      .pipe(
        catchError(() => {
          this.loadError.set("Le dossier KYC n'a pas pu être lu.");
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((file) => {
        this.file.set(file);
        this.isLoading.set(false);
        this._breadcrumbService.set([
          { label: 'Dossiers KYC', link: ['/kyc'] },
          { label: 'Enrôlement' },
        ]);
        this._loadCustomerName();
      });
  }

  private _reloadFile(): void {
    const id = this.file()?.id;
    if (id) this._loadFile(id);
  }

  private _loadCustomerName(): void {
    this._facade
      .getCustomerName(this.customerId())
      .pipe(catchError(() => of('')))
      .subscribe((name) => this.customerName.set(name));
  }

  /** Brouillon chiffré : seule chose conservée dans le navigateur, et reprise après coupure. */
  private async _saveDraft(): Promise<void> {
    const file = this.file();
    if (!file?.id) return;
    const draft: KycEnrolmentDraft = {
      customerId: this.customerId(),
      kycFileId: file.id,
      step: this.step(),
      documentStorageRef: this.documentRef()?.storageRef ?? null,
      documentImageUrl: this.documentRef()?.url ?? null,
      documentType: this.documentType(),
      selfieStorageRef: this.selfieRef(),
      overrideComment: this.overrideComment(),
    };
    await this._drafts.save(this._draftId(), draft);
  }

  private async _restoreDraft(kycFileId: string): Promise<void> {
    const draft = await this._drafts.load<KycEnrolmentDraft>(this._draftId());
    if (!draft || draft.kycFileId !== kycFileId) return;

    // Le lien blob d'une capture précédente ne survit pas au rechargement : on restaure l'avancement,
    // pas l'aperçu, plutôt que d'afficher une image cassée.
    //
    // L'image EST relisible — `GET /kyc-files/{id}/documents/{storageRef}` — mais cette lecture
    // exige `kyc:document:reveal`, la permission de révéler le numéro du document, que l'agent qui
    // enrôle n'a pas forcément. Et chaque lecture est journalisée : restaurer un aperçu à chaque
    // reprise de brouillon inscrirait des accès que personne n'a demandés dans la piste d'audit.
    // C'est pour ça que la relecture est un geste de l'agent, proposé par l'étape de comparaison
    // (`kyc-selfie-capture`, bouton « Afficher la pièce ») et non faite ici.
    if (draft.documentStorageRef) {
      this.documentRef.set({ storageRef: draft.documentStorageRef, url: null });
    }
    // Le type n'est repris que s'il appartient toujours au contrat : un brouillon d'avant une
    // évolution de l'enum ne doit pas faire repartir une valeur que le serveur refuserait.
    if (isKycDocumentType(draft.documentType)) this.documentType.set(draft.documentType);
    this.selfieRef.set(draft.selfieStorageRef);
    this.overrideComment.set(draft.overrideComment);
    this.step.set(draft.step);
    this._snackbar.info(
      'Brouillon repris',
      'La saisie reprend où elle avait été interrompue. La photo du visage doit être reprise ; '
        + "celle de la pièce est conservée et peut être réaffichée à l'étape de comparaison.",
    );
  }

  /** Codes de `POST /manual-validation`. Les libellés nomment la cause réelle, pas « la soumission ». */
  private _submitError(error: HttpErrorResponse): string {
    switch (error.status) {
      case 409:
        // L'opération n'accepte que `Verifying` et `ComplementRequired` : un 409 dit que le dossier
        // a changé d'état entre l'affichage du récapitulatif et le clic.
        return "Ce dossier n'est plus en attente de vérification : il a avancé entre-temps. Rechargez pour voir son état.";
      case 403:
        return "Vous n'avez pas le droit de valider les pièces à la main, ou ce dossier sort de votre périmètre d'agence.";
      case 404:
        return "Ce dossier est introuvable : il a peut-être été clôturé.";
      case 400:
        return error.error?.detail ?? 'Le motif de validation a été refusé par le serveur.';
      default:
        return error.error?.detail ?? "La validation manuelle n'a pas abouti.";
    }
  }
}

export default KycEnrolmentPage;
