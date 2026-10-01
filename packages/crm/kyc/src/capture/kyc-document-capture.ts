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
import { applyEach, form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { RunKycVerificationResponse, RunKycVerificationResponseOutcomeEnum } from '@sankore/crm-api';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  KycFieldConfidence,
  KycImageRef,
  KycMrzData,
  KycOcrField,
} from '../data-access/kyc.types';
import { KycScoreGauge } from '../ui/kyc-score-gauge';
import { KycStubNotice } from '../ui/kyc-stub-notice';
import { KycCameraCapture } from './kyc-camera-capture';

/**
 * Fiabilité d'un champ lu par l'OCR, telle qu'elle est présentée à l'agent.
 *
 * La couleur ne porte **jamais** l'information seule : chaque niveau a son libellé et son icône,
 * parce qu'un agent daltonien ou un écran mal calibré rendraient le code couleur muet (WCAG 1.4.1).
 *
 * Ces trois libellés devraient à terme rejoindre `kyc-referential.ts`, avec les statuts et les flags.
 * Ils vivent ici parce que le référentiel ne couvre aujourd'hui que le niveau *global* du dossier
 * (`kycConfidenceMeta` : Validé / À revoir / Rejeté), qui est une autre notion que la fiabilité d'un
 * champ.
 */
/** Les clés MRZ qu'on sait traduire. Le reste s'affiche tel quel, lisiblement. */
const MRZ_FIELD_LABELS: Record<string, string> = {
  surname: 'Nom',
  given_names: 'Prénom(s)',
  nationality: 'Nationalité',
  birth_date: 'Date de naissance',
  date_of_birth: 'Date de naissance',
  expiry_date: "Date d'expiration",
  date_of_expiry: "Date d'expiration",
  sex: 'Sexe',
  issuing_country: 'Pays émetteur',
  document_type: 'Type de pièce',
};

const OCR_CONFIDENCE_META: Record<
  KycFieldConfidence,
  { label: string; icon: string; textClasses: string; borderClasses: string }
> = {
  high: {
    label: 'Lecture fiable',
    icon: 'feather:check-circle',
    textClasses: 'text-green-700',
    borderClasses: 'border-l-4 border-green-500',
  },
  medium: {
    label: 'À vérifier',
    icon: 'feather:alert-circle',
    textClasses: 'text-orange-700',
    borderClasses: 'border-l-4 border-orange-400',
  },
  low: {
    label: 'Peu fiable, à corriger',
    icon: 'feather:alert-triangle',
    textClasses: 'text-red-700',
    borderClasses: 'border-l-4 border-red-500',
  },
  // Pas une quatrième nuance de fiabilité : l'absence de mesure. Le service ne note pas tous les
  // champs, et une pièce lue avant que les confiances ne soient conservées n'en a aucune. Neutre
  // en couleur comme en mot : « À vérifier » dirait que la machine a douté, « Lecture fiable »
  // qu'elle était sûre — et les deux seraient faux.
  unknown: {
    label: 'Fiabilité non mesurée',
    icon: 'feather:help-circle',
    textClasses: 'text-slate-600',
    borderClasses: 'border-l-4 border-slate-300',
  },
};

/** Causes de refus que le cahier énumère, traduites pour l'agent. Un code inconnu reste affiché. */
const REJECTION_REASONS: Record<string, string> = {
  blur: 'La photo est floue : posez la pièce à plat et attendez la mise au point.',
  blurry: 'La photo est floue : posez la pièce à plat et attendez la mise au point.',
  glare: 'Un reflet masque une partie de la pièce : éloignez la source de lumière ou inclinez la pièce.',
  reflection:
    'Un reflet masque une partie de la pièce : éloignez la source de lumière ou inclinez la pièce.',
  lighting: 'La lumière est insuffisante : rapprochez-vous d\'une fenêtre ou allumez le plafonnier.',
  darkness: 'La lumière est insuffisante : rapprochez-vous d\'une fenêtre ou allumez le plafonnier.',
  cropped: 'La pièce est coupée : cadrez-la entièrement dans le rectangle de guidage.',
};

/** Un champ du formulaire de correction. `original` sert à ne renvoyer que ce qui a bougé. */
class OcrFieldValue {
  public name!: string;
  public value!: string;
  public original!: string;
  public editable!: boolean;
}

class OcrFieldsFormModel {
  public fields!: OcrFieldValue[];

  public static fromOcr(fields: KycOcrField[]): OcrFieldsFormModel {
    const model = new OcrFieldsFormModel();
    model.fields = fields.map((field) => {
      const item = new OcrFieldValue();
      item.name = field.name;
      item.value = field.value;
      item.original = field.value;
      item.editable = field.editable;
      return item;
    });
    return model;
  }
}

type DocumentStep = 'capture' | 'uploading' | 'review';
type VerificationState = 'idle' | 'running' | 'scored' | 'rejected' | 'queued' | 'failed';

/**
 * KYC-F-02 — capture de la pièce d'identité, relecture des champs et correction tracée.
 *
 * Deux principes structurent l'écran :
 *
 * 1. **La vérification ne bloque jamais la saisie.** `runVerification` part en arrière-plan dès que
 *    l'image est déposée ; l'agent relit et corrige les champs pendant ce temps. Un écran bloqué sur
 *    un spinner le temps d'un appel à un service biométrique est inutilisable en agence.
 * 2. **Rien de simulé n'est présenté comme une donnée serveur.** L'OCR et la zone codée sont des
 *    bouchons (`KYC-B-08`) : le bandeau le dit, sans quoi un agent corrigerait des champs inventés.
 */
@Component({
  selector: 'kyc-document-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kyc-document-capture.html',
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
    KycScoreGauge,
    KycStubNotice,
  ],
})
export class KycDocumentCapture {
  private readonly _kyc = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly kycFileId = input.required<string>();

  /**
   * `POST /kyc-files/{id}/verify` exige **les deux** références d'image : il n'existe aucune
   * vérification de la seule pièce. Quand le selfie n'a pas encore été pris, l'écran lance quand même
   * l'appel avec une référence vide — le serveur tranche — et traduit l'échec en « vérification en
   * attente du selfie » plutôt qu'en erreur. Le parent passe la référence dès qu'il l'a.
   */
  public readonly selfieStorageRef = input<string | null>(null);

  public readonly documentUploaded = output<KycImageRef>();

  public readonly step = signal<DocumentStep>('capture');
  public readonly uploadError = signal<string | null>(null);
  public readonly imageRef = signal<KycImageRef | null>(null);

  public readonly isLoadingFields = signal(false);
  public readonly fieldsError = signal<string | null>(null);
  public readonly ocrFields = signal<KycOcrField[]>([]);

  public readonly isLoadingMrz = signal(false);
  public readonly mrzError = signal<string | null>(null);
  public readonly mrz = signal<KycMrzData | null>(null);

  /**
   * Les champs de la zone codée, prêts à afficher.
   *
   * Dérivé plutôt que nommé champ par champ : les clés sont celles du service de biométrie, donc
   * ouvertes. Un libellé connu est traduit, les autres sont rendus lisibles — une clé inconnue doit
   * apparaître à l'écran, c'est ainsi qu'on apprend que le service en a ajouté une.
   */
  public readonly mrzEntries = computed(() =>
    Object.entries(this.mrz()?.fields ?? {}).map(([key, value]) => ({
      key,
      label: MRZ_FIELD_LABELS[key] ?? key.replace(/[_-]+/g, ' '),
      value,
    })),
  );

  public readonly verificationState = signal<VerificationState>('idle');
  public readonly verification = signal<RunKycVerificationResponse | null>(null);
  public readonly rejectionReason = signal<string | null>(null);
  public readonly verificationError = signal<string | null>(null);

  /** Champs dont la correction est partie au serveur, pour le dire à l'écran champ par champ. */
  public readonly correctedFields = signal<readonly string[]>([]);
  public readonly savingField = signal<string | null>(null);

  /** Score renvoyé par la dernière correction : le dossier est re-noté sans relancer l'OCR. */
  public readonly correctedScore = signal<{ score: number | null; level: string | null } | null>(
    null,
  );

  public model = signal(OcrFieldsFormModel.fromOcr([]));

  public formSchema = form(this.model, (schema) => {
    applyEach(schema.fields, (item) => {
      // Un champ non modifiable ne peut pas être réparé par l'agent : l'exiger bloquerait
      // l'enregistrement sur une valeur qu'il n'a pas le droit de toucher.
      required(item.value, {
        message: 'Ce champ ne peut pas rester vide',
        when: (ctx) => ctx.valueOf(item.editable),
      });
    });
  });

  public readonly displayedScore = computed(
    () => this.correctedScore()?.score ?? this.verification()?.confidenceScore ?? null,
  );

  public readonly displayedLevel = computed(
    () => this.correctedScore()?.level ?? this.verification()?.confidenceLevel ?? null,
  );

  /**
   * État du formulaire et non comparaison du modèle : les signaux `dirty` du `form()` sont la seule
   * source dont la réactivité est garantie, le modèle pouvant être muté en place par le formulaire.
   */
  public readonly hasPendingCorrections = computed(() => this.formSchema().dirty());

  public readonly isEmptyOcr = computed(
    () => !this.isLoadingFields() && !this.fieldsError() && this.ocrFields().length === 0,
  );

  public confidenceMeta(confidence: KycFieldConfidence) {
    return OCR_CONFIDENCE_META[confidence];
  }

  public isCorrected(name: string): boolean {
    return this.correctedFields().includes(name);
  }

  /** Reçu de la caméra comme de l'import : le reste du parcours est identique. */
  public onCaptured(file: File): void {
    this.step.set('uploading');
    this.uploadError.set(null);

    this._kyc
      .uploadImage(this.kycFileId(), 'IdentityDocumentFront', file)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError((error: HttpErrorResponse) => {
          this.uploadError.set(
            error.error?.title ?? "L'image n'a pas pu être déposée. Réessayez.",
          );
          this.step.set('capture');
          return EMPTY;
        }),
      )
      .subscribe((ref) => {
        // Le lien de la capture précédente devient inutile dans la seconde qui suit : on le libère
        // ici, après avoir obtenu le nouveau, pour ne jamais afficher une image révoquée.
        const previous = this.imageRef()?.url;
        if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);

        this.imageRef.set(ref);
        this.step.set('review');
        this.documentUploaded.emit(ref);
        this._loadOcr();
        this._loadMrz();
        this._runVerification(ref.storageRef);
      });
  }

  public retake(): void {
    this.step.set('capture');
    this.ocrFields.set([]);
    this.mrz.set(null);
    this.model.set(OcrFieldsFormModel.fromOcr([]));
    this.verificationState.set('idle');
    this.verification.set(null);
    this.rejectionReason.set(null);
    this.verificationError.set(null);
    this.correctedFields.set([]);
    this.correctedScore.set(null);
  }

  /** Correction d'un seul champ, au fil de la relecture. */
  public saveField(name: string): void {
    const item = this.model().fields.find((f) => f.name === name);
    if (!item || !item.editable || item.value === item.original) return;

    const value = (item.value ?? '').trim();
    if (!value) {
      this._snackbar.error('Correction refusée', 'Ce champ ne peut pas rester vide.');
      return;
    }

    this.savingField.set(name);
    this._kyc
      .correctField(this.kycFileId(), name, value)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Correction non enregistrée',
            error.error?.title ?? 'Le serveur a refusé la correction. Réessayez.',
          );
          this.savingField.set(null);
          return EMPTY;
        }),
      )
      .subscribe((response) => {
        this.savingField.set(null);
        this._acceptCorrection(name, value, response.newScore ?? null, response.newConfidenceLevel ?? null);
        this._snackbar.success(
          'Correction enregistrée',
          'La valeur corrigée, son auteur et sa date sont conservés dans l\'historique du dossier.',
        );
      });
  }

  /**
   * Enregistrement groupé. Il passe par `submit()` — et non par une boucle d'appels — pour que la
   * validation, l'état `submitting` et le blocage du bouton viennent du formulaire, comme sur tous
   * les écrans du projet.
   */
  public saveAll(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const modified = value.fields.filter((f) => f.editable && f.value !== f.original);
      if (modified.length === 0) return;

      let lastScore: { score: number | null; level: string | null } | null = null;
      let failures = 0;

      for (const item of modified) {
        const response = await firstValueFrom(
          this._kyc.correctField(this.kycFileId(), item.name, item.value.trim()).pipe(
            catchError(() => {
              failures += 1;
              return of(null);
            }),
          ),
        );
        if (!response) continue;
        lastScore = {
          score: response.newScore ?? null,
          level: response.newConfidenceLevel ?? null,
        };
        this._acceptCorrection(item.name, item.value.trim(), null, null);
      }

      if (lastScore) this.correctedScore.set(lastScore);

      if (failures === 0) {
        this._snackbar.success(
          'Corrections enregistrées',
          `${modified.length} champ(s) corrigé(s). Chaque correction est tracée et le dossier a été re-noté.`,
        );
      } else {
        this._snackbar.error(
          'Corrections partiellement enregistrées',
          `${failures} champ(s) n'ont pas pu être enregistrés. Vérifiez-les et réessayez.`,
        );
      }
    });
  }

  public reloadOcr(): void {
    this._loadOcr();
  }

  public reloadMrz(): void {
    this._loadMrz();
  }

  /** Relance la vérification depuis l'indicateur, après une mise en file ou une panne réseau. */
  public retryVerification(): void {
    const ref = this.imageRef();
    if (ref) this._runVerification(ref.storageRef);
  }

  private _acceptCorrection(
    name: string,
    value: string,
    score: number | null,
    level: string | null,
  ): void {
    const index = this.model().fields.findIndex((f) => f.name === name);

    this.model.update((current) => {
      const next = new OcrFieldsFormModel();
      next.fields = current.fields.map((f) => {
        if (f.name !== name) return f;
        const updated = new OcrFieldValue();
        updated.name = f.name;
        updated.value = value;
        updated.original = value;
        updated.editable = f.editable;
        return updated;
      });
      return next;
    });

    // `reset` remet le champ à neuf : la valeur corrigée devient la référence et l'état `dirty`
    // retombe, ce qui fait disparaître le bouton « Enregistrer cette correction » déjà honoré.
    if (index >= 0) this.formSchema.fields[index].value().reset(value);

    this.correctedFields.update((names) =>
      names.includes(name) ? names : [...names, name],
    );
    if (score !== null || level !== null) this.correctedScore.set({ score, level });
  }

  private _loadOcr(): void {
    this.isLoadingFields.set(true);
    this.fieldsError.set(null);

    this._kyc
      .getOcrFields(this.kycFileId())
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this.fieldsError.set(
            'Les champs lus sur la pièce sont indisponibles. Vous pouvez réessayer.',
          );
          this.isLoadingFields.set(false);
          return EMPTY;
        }),
      )
      .subscribe((fields) => {
        this.ocrFields.set(fields);
        this.model.set(OcrFieldsFormModel.fromOcr(fields));
        this.correctedFields.set([]);
        this.isLoadingFields.set(false);
      });
  }

  private _loadMrz(): void {
    this.isLoadingMrz.set(true);
    this.mrzError.set(null);

    this._kyc
      .getMrz(this.kycFileId())
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this.mrzError.set('La zone codée n\'a pas pu être relue.');
          this.isLoadingMrz.set(false);
          return EMPTY;
        }),
      )
      .subscribe((mrz) => {
        this.mrz.set(mrz);
        this.isLoadingMrz.set(false);
      });
  }

  private _runVerification(documentStorageRef: string): void {
    this.verificationState.set('running');
    this.verificationError.set(null);
    this.rejectionReason.set(null);

    this._kyc
      .runVerification(this.kycFileId(), documentStorageRef, this.selfieStorageRef() ?? '')
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError((error: HttpErrorResponse) => {
          this.verificationState.set('failed');
          // Sans référence de selfie, l'endpoint refuse la requête : le dire franchement vaut mieux
          // que d'afficher une erreur technique qui laisserait croire à une panne.
          this.verificationError.set(
            this.selfieStorageRef()
              ? (error.error?.title ??
                  "La vérification n'a pas pu être lancée. Les champs restent corrigeables.")
              : "La vérification attend la photo du visage : elle sera lancée à l'étape suivante. Les champs restent corrigeables dès maintenant.",
          );
          return EMPTY;
        }),
      )
      .subscribe((response) => {
        this.verification.set(response);

        switch (response.outcome) {
          case RunKycVerificationResponseOutcomeEnum.CaptureRejected:
            this.verificationState.set('rejected');
            this._loadRejectionReason();
            break;
          case RunKycVerificationResponseOutcomeEnum.ServiceUnavailable:
            this.verificationState.set('queued');
            break;
          default:
            this.verificationState.set('scored');
            break;
        }
      });
  }

  /** La cause du refus n'est pas dans `RunKycVerificationResponse` : elle vient du détail. */
  private _loadRejectionReason(): void {
    this._kyc
      .getVerificationDetail(this.kycFileId())
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => EMPTY),
      )
      .subscribe((detail) => {
        const raw = detail.captureRejectionReason;
        if (!raw) return;
        this.rejectionReason.set(REJECTION_REASONS[raw.toLowerCase()] ?? raw);
      });
  }
}
