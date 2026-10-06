import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  RunKycVerificationRequestDocumentTypeEnum,
  RunKycVerificationResponse,
  RunKycVerificationResponseOutcomeEnum,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { kycConfidenceMeta } from '../data-access/kyc-referential';
import { KycImageRef } from '../data-access/kyc.types';
import { KycStubNotice } from '../ui/kyc-stub-notice';
import { KycCameraCapture } from './kyc-camera-capture';

type SelfieStep = 'capture' | 'uploading' | 'verifying' | 'result';

/** Verdict montré à l'agent. Trois issues, jamais un pourcentage livré seul. */
type FaceMatchOutcome = 'confirmed' | 'review' | 'mismatch';

interface FaceMatchMeta {
  outcome: FaceMatchOutcome;
  label: string;
  message: string;
  icon: string;
  textClasses: string;
  boxClasses: string;
  barClasses: string;
}

/**
 * Les trois issues de la comparaison faciale.
 *
 * **Le seuil n'est pas ici.** Il vient de `kycConfidenceMeta` (`canSubmit` / `warnOnSubmit`) :
 * écrire « 80 % » en dur dans cet écran reviendrait à dupliquer une règle métier que le serveur et le
 * référentiel portent déjà, et à la laisser divergée le jour où elle change. Seuls les mots employés
 * pour parler d'un visage sont locaux — le référentiel, lui, parle du dossier entier.
 */
const FACE_MATCH_META: Record<FaceMatchOutcome, FaceMatchMeta> = {
  confirmed: {
    outcome: 'confirmed',
    label: 'Correspondance confirmée',
    message: 'Le visage correspond à la photo de la pièce. Vous pouvez poursuivre le dossier.',
    icon: 'feather:user-check',
    textClasses: 'text-green-700',
    boxClasses: 'border-green-200 bg-green-50',
    barClasses: 'bg-green-500',
  },
  review: {
    outcome: 'review',
    label: 'À vérifier',
    message:
      "La correspondance est incertaine. Reprenez la photo dans de meilleures conditions : une soumission en l'état partira en revue.",
    icon: 'feather:alert-circle',
    textClasses: 'text-orange-700',
    boxClasses: 'border-orange-200 bg-orange-50',
    barClasses: 'bg-orange-400',
  },
  mismatch: {
    outcome: 'mismatch',
    label: 'Non-correspondance',
    message:
      "Le visage ne correspond pas à la photo de la pièce. Reprenez la photo ; si l'écart persiste, le dossier devra être revu.",
    icon: 'feather:user-x',
    textClasses: 'text-red-700',
    boxClasses: 'border-red-200 bg-red-50',
    barClasses: 'bg-red-500',
  },
};

class SelfieOverrideFormModel {
  public comment!: string;

  public static instantiate(): SelfieOverrideFormModel {
    const model = new SelfieOverrideFormModel();
    model.comment = '';
    return model;
  }
}

/**
 * KYC-F-03 — capture du selfie et comparaison faciale.
 *
 * Le parti pris de l'écran : montrer les deux images côte à côte et écrire le verdict en mots. Un
 * pourcentage seul (« 71 % ») ne dit pas à un agent s'il peut continuer ; c'est exactement le genre
 * d'affichage qui pousse à valider un dossier douteux.
 */
@Component({
  selector: 'kyc-selfie-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kyc-selfie-capture.html',
  imports: [
    Button,
    TasCard,
    TasError,
    TasFormField,
    TasHint,
    TasIcon,
    TasInput,
    TasLabel,
    TasSpinner,
    FormRoot,
    FormField,
    KycCameraCapture,
    KycStubNotice,
  ],
})
export class KycSelfieCapture {
  private readonly _kyc = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _destroyRef = inject(DestroyRef);

  /** Même droit que sur la capture de pièce : la comparaison faciale note le dossier. */
  public readonly canVerify = this._permissions.can('kyc:verify');

  public readonly kycFileId = input.required<string>();

  /** Photo de la pièce, pour l'affichage côte à côte. Absente, l'écran le dit au lieu de l'inventer. */
  public readonly documentImageUrl = input<string | null>(null);

  /**
   * Référence de la pièce dans le magasin documentaire. `POST /kyc-files/{id}/verify` exige les deux
   * références : sans celle de la pièce, aucune comparaison n'est possible, et l'écran refuse de
   * lancer la vérification plutôt que d'envoyer une requête vouée au 400.
   */
  public readonly documentStorageRef = input<string>('');

  /**
   * Nature de la pièce, choisie à l'étape précédente. `POST /kyc-files/{id}/verify` l'exige, et la
   * comparaison faciale passe par le même endpoint : sans elle, la requête repart en 400. Le parent
   * la conserve, brouillon repris compris.
   */
  public readonly documentType = input<RunKycVerificationRequestDocumentTypeEnum | null>(null);

  /** Paramètre tenant : le nombre d'essais avant qu'une soumission commentée devienne possible. */
  public readonly maxAttempts = input(2);

  public readonly matched = output<boolean>();
  /** Soumission forcée après épuisement des tentatives ; porte le commentaire obligatoire. */
  public readonly submittedWithOverride = output<string>();

  public readonly step = signal<SelfieStep>('capture');
  public readonly selfieRef = signal<KycImageRef | null>(null);
  public readonly errorMessage = signal<string | null>(null);
  public readonly isQueued = signal(false);
  public readonly captureRejected = signal(false);

  public readonly verification = signal<RunKycVerificationResponse | null>(null);
  public readonly faceMatchPercent = signal<number | null>(null);

  /** Nombre de photos déjà jugées sans correspondance confirmée. */
  public readonly attempts = signal(0);

  public overrideModel = signal(SelfieOverrideFormModel.instantiate());

  public overrideForm = form(this.overrideModel, (schema) => {
    required(schema.comment, {
      message: 'Un commentaire est obligatoire pour soumettre malgré l\'échec',
    });
    // `required` laisse passer une suite d'espaces : un commentaire vide de sens tracé au dossier
    // vaut moins que pas de commentaire du tout, puisqu'il donne l'illusion d'une justification.
    validate(schema.comment, (ctx) =>
      ctx.value().trim().length > 0
        ? undefined
        : { kind: 'required', message: 'Expliquez pourquoi le dossier est soumis malgré l\'échec' },
    );
  });

  public readonly remainingAttempts = computed(() =>
    Math.max(0, this.maxAttempts() - this.attempts()),
  );

  public readonly attemptsExhausted = computed(() => this.remainingAttempts() === 0);

  public readonly matchMeta = computed<FaceMatchMeta | null>(() => {
    const response = this.verification();
    if (!response) return null;
    const meta = kycConfidenceMeta(response.confidenceLevel);
    if (!meta.canSubmit) return FACE_MATCH_META['mismatch'];
    return meta.warnOnSubmit ? FACE_MATCH_META['review'] : FACE_MATCH_META['confirmed'];
  });

  public readonly isConfirmed = computed(() => this.matchMeta()?.outcome === 'confirmed');

  /** Il n'y a rien à comparer tant que la pièce n'a pas été capturée. */
  public readonly missingDocument = computed(() => !this.documentStorageRef());

  public readonly percentLabel = computed(() => {
    const percent = this.faceMatchPercent();
    return percent === null ? 'non communiqué' : `${percent} %`;
  });

  public onCaptured(file: File): void {
    this.step.set('uploading');
    this.errorMessage.set(null);
    this.isQueued.set(false);
    this.captureRejected.set(false);

    this._kyc
      .uploadImage(this.kycFileId(), 'Selfie', file)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError((error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.title ?? "La photo n'a pas pu être déposée. Réessayez.",
          );
          this.step.set('capture');
          return EMPTY;
        }),
      )
      .subscribe((ref) => {
        const previous = this.selfieRef()?.url;
        if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);

        this.selfieRef.set(ref);
        this._verify(ref.storageRef);
      });
  }

  public retake(): void {
    this.step.set('capture');
    this.verification.set(null);
    this.faceMatchPercent.set(null);
    this.errorMessage.set(null);
    this.isQueued.set(false);
    this.captureRejected.set(false);
  }

  public retryVerification(): void {
    const ref = this.selfieRef();
    if (ref) this._verify(ref.storageRef);
  }

  public confirmMatch(): void {
    this.matched.emit(true);
    this._snackbar.success(
      'Correspondance retenue',
      'La comparaison faciale est confirmée pour ce dossier.',
    );
  }

  public submitWithOverride(): void {
    submit(this.overrideForm, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const comment = value.comment.trim();
      this.submittedWithOverride.emit(comment);
      // `info` et non `warning` : le SnackbarService du projet n'expose que success / error / info.
      this._snackbar.info(
        'Dossier soumis pour validation',
        "La comparaison faciale n'a pas abouti : le chef d'agence devra valider ce dossier.",
      );
    });
  }

  private _verify(selfieStorageRef: string): void {
    const documentRef = this.documentStorageRef();
    if (!documentRef) {
      this.errorMessage.set(
        "La photo de la pièce d'identité manque : capturez-la avant de comparer les visages.",
      );
      this.step.set('result');
      return;
    }

    const documentType = this.documentType();
    if (!documentType) {
      this.errorMessage.set(
        "La nature de la pièce d'identité manque : revenez à l'étape de la pièce pour l'indiquer, "
          + 'la comparaison pourra alors être lancée.',
      );
      this.step.set('result');
      return;
    }

    // Sans le droit de vérifier, l'appel repartirait en 403 : on le dit au lieu de laisser lire
    // une panne du service biométrique.
    if (!this.canVerify()) {
      this.errorMessage.set(
        "La comparaison faciale demande le droit de vérifier les dossiers KYC, que vous n'avez pas. "
          + 'La photo est enregistrée ; un profil habilité doit lancer la comparaison.',
      );
      this.step.set('result');
      return;
    }

    this.step.set('verifying');
    this.errorMessage.set(null);

    this._kyc
      .runVerification(this.kycFileId(), documentRef, selfieStorageRef, documentType)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError((error: HttpErrorResponse) => {
          this.errorMessage.set(
            error.error?.title ??
              "La comparaison n'a pas pu être lancée. Réessayez dans un instant.",
          );
          this.step.set('result');
          return EMPTY;
        }),
      )
      .subscribe((response) => {
        this.verification.set(response);
        this.step.set('result');

        switch (response.outcome) {
          case RunKycVerificationResponseOutcomeEnum.ServiceUnavailable:
            // Aucune photo n'a été jugée : cette tentative ne doit pas être décomptée.
            this.isQueued.set(true);
            this.verification.set(null);
            break;
          case RunKycVerificationResponseOutcomeEnum.CaptureRejected:
            this.captureRejected.set(true);
            this.verification.set(null);
            this.attempts.update((count) => count + 1);
            this.matched.emit(false);
            break;
          default:
            this._loadFaceMatch();
            if (this.isConfirmed()) {
              this.matched.emit(true);
            } else {
              this.attempts.update((count) => count + 1);
              this.matched.emit(false);
            }
            break;
        }
      });
  }

  /** Le pourcentage n'est pas dans `RunKycVerificationResponse` : il vient du détail (bouchon). */
  private _loadFaceMatch(): void {
    this._kyc
      .getVerificationDetail(this.kycFileId())
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => EMPTY),
      )
      .subscribe((detail) => this.faceMatchPercent.set(detail.faceMatchPercent));
  }
}
