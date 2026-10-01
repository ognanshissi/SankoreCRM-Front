import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Button } from '@talisoft/ui/button';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';

/** Cadre de guidage superposé au flux vidéo. */
export type KycCameraGuide = 'id-card' | 'oval';

/** `environment` = caméra arrière (pièce d'identité), `user` = caméra frontale (selfie). */
export type KycCameraFacing = 'environment' | 'user';

export type KycCameraState = 'idle' | 'starting' | 'live' | 'captured' | 'error';

export interface KycCameraFailure {
  title: string;
  /** Formulé pour un agent : ce qu'il doit faire, pas le nom de l'exception. */
  message: string;
  /** Vrai quand réessayer la caméra a une chance d'aboutir. */
  retryable: boolean;
}

/**
 * Les noms d'erreur de `getUserMedia` sont normalisés mais pas tous implémentés de la même façon :
 * Chrome et Safari renvoient encore les anciens noms (`PermissionDeniedError`,
 * `DevicesNotFoundError`). On les traite comme leurs équivalents actuels plutôt que de tomber sur le
 * message générique, qui n'aide pas l'agent à débloquer sa caméra.
 */
const CAMERA_FAILURES: Record<string, KycCameraFailure> = {
  NotAllowedError: {
    title: "Accès à la caméra refusé",
    message:
      "Votre navigateur bloque la caméra pour ce site. Cliquez sur l'icône de cadenas (ou de caméra) à gauche de l'adresse, autorisez la caméra, puis réessayez. Vous pouvez aussi importer une photo depuis cet appareil.",
    retryable: true,
  },
  NotFoundError: {
    title: 'Aucune caméra détectée',
    message:
      "Cet appareil n'expose aucune caméra. Branchez une webcam, ou importez une photo déjà prise.",
    retryable: false,
  },
  NotReadableError: {
    title: 'Caméra indisponible',
    message:
      'La caméra est déjà utilisée par une autre application. Fermez-la puis réessayez, ou importez une photo.',
    retryable: true,
  },
  OverconstrainedError: {
    title: 'Caméra incompatible',
    message:
      "Aucune caméra ne correspond à la résolution demandée. Importez une photo depuis cet appareil.",
    retryable: true,
  },
  SecurityError: {
    title: 'Caméra bloquée par la sécurité du navigateur',
    message:
      "La caméra n'est accessible que sur une connexion sécurisée (HTTPS). Importez une photo en attendant.",
    retryable: false,
  },
  unsupported: {
    title: 'Caméra non prise en charge',
    message:
      "Ce navigateur n'expose pas d'accès à la caméra. Importez une photo depuis cet appareil.",
    retryable: false,
  },
  unknown: {
    title: "La caméra n'a pas pu démarrer",
    message: 'Réessayez, ou importez une photo depuis cet appareil.',
    retryable: true,
  },
};

const LEGACY_ERROR_NAMES: Record<string, string> = {
  PermissionDeniedError: 'NotAllowedError',
  PermissionDismissedError: 'NotAllowedError',
  DevicesNotFoundError: 'NotFoundError',
  TrackStartError: 'NotReadableError',
  ConstraintNotSatisfiedError: 'OverconstrainedError',
};

/**
 * Prise de vue partagée par la capture de la pièce (KYC-F-02) et celle du selfie (KYC-F-03).
 *
 * Trois responsabilités, et pas une de plus : ouvrir le flux, produire un `File` compressé, et
 * retomber proprement sur l'import de fichier quand la caméra n'est pas disponible. Tout ce qui
 * relève du dossier KYC — upload, vérification, OCR — appartient aux écrans appelants.
 */
@Component({
  selector: 'kyc-camera-capture',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kyc-camera-capture.html',
  imports: [Button, TasFileUploader, TasIcon, TasSpinner],
})
export class KycCameraCapture implements OnDestroy {
  public readonly facingMode = input<KycCameraFacing>('environment');
  public readonly guide = input<KycCameraGuide>('id-card');

  /**
   * Largeur maximale de l'image produite. 1600 px est un plancher, pas un confort d'affichage :
   * en dessous, la zone codée (MRZ) imprimée en bas de la pièce passe sous ~2 px par caractère et
   * la lecture devient fausse plutôt qu'absente — ce qui est pire, car l'agent ne le voit pas.
   * Ne pas descendre pour « économiser du réseau » : c'est l'OCR qu'on casse.
   */
  public readonly maxWidth = input(1600);

  /** 0.85 : seuil au-delà duquel le JPEG n'apporte plus de détail lisible, en dessous duquel les
   * artefacts de compression brouillent les caractères fins de la pièce. */
  public readonly quality = input(0.85);

  public readonly accept = input('image/jpeg,image/png,image/webp');
  public readonly maxSizeMb = input(10);

  public readonly shutterLabel = input('Prendre la photo');
  /** Consigne affichée sous le cadre, propre à chaque écran. */
  public readonly hint = input('');
  /** Préfixe du nom de fichier envoyé au magasin documentaire. */
  public readonly fileBaseName = input('kyc-capture');

  public readonly captured = output<File>();

  public readonly state = signal<KycCameraState>('idle');
  public readonly failure = signal<KycCameraFailure | null>(null);

  /** L'agent a demandé l'import : on ne rallume pas la caméra derrière son dos. */
  public readonly importMode = signal(false);
  public readonly importedFile = signal<File | null>(null);
  public readonly isCompressing = signal(false);

  private readonly _video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly _stream = signal<MediaStream | null>(null);

  /**
   * L'aperçu d'un selfie est inversé, parce qu'un visage non miroir désoriente l'utilisateur qui se
   * cadre. Le fichier produit, lui, ne l'est pas : c'est l'image réelle qui part à la comparaison.
   */
  public readonly mirrored = computed(() => this.facingMode() === 'user');

  public readonly importVisible = computed(() => this.importMode() || this.state() === 'error');

  public readonly guideLabel = computed(() =>
    this.guide() === 'id-card'
      ? "Cadre de la pièce d'identité"
      : 'Cadre du visage',
  );

  constructor() {
    // Le `<video>` n'existe qu'une fois l'état « live » rendu : brancher le flux dans `start()`
    // tomberait sur un `viewChild` encore vide. L'effet attend que les deux soient là.
    effect(() => {
      const element = this._video()?.nativeElement;
      const stream = this._stream();
      if (!element || !stream || element.srcObject === stream) return;
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    });
  }

  public async start(): Promise<void> {
    if (this.state() === 'starting' || this.state() === 'live') return;

    this.importMode.set(false);
    this.failure.set(null);

    const devices = navigator.mediaDevices;
    if (!devices?.getUserMedia) {
      this._fail('unsupported');
      return;
    }

    this.state.set('starting');
    try {
      const stream = await devices.getUserMedia({
        // `ideal` et non `exact` : sur un poste fixe sans caméra arrière, `exact` échoue en
        // OverconstrainedError alors que la webcam disponible ferait parfaitement l'affaire.
        video: {
          facingMode: { ideal: this.facingMode() },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      this._stream.set(stream);
      this.state.set('live');
    } catch (error: unknown) {
      const raw = (error as { name?: string } | null)?.name ?? 'unknown';
      this._fail(LEGACY_ERROR_NAMES[raw] ?? raw);
    }
  }

  /** Reprendre la photo : on repart sur un flux neuf plutôt que de réutiliser le précédent. */
  public retake(): void {
    this.importedFile.set(null);
    this.state.set('idle');
    void this.start();
  }

  public chooseImport(): void {
    this._releaseStream();
    this.importMode.set(true);
    this.state.set('idle');
  }

  public async capture(): Promise<void> {
    const video = this._video()?.nativeElement;
    if (!video || !video.videoWidth || !video.videoHeight) {
      this._fail('unknown');
      return;
    }

    const file = await this._toCompressedFile(video, video.videoWidth, video.videoHeight);
    if (!file) {
      this._fail('unknown');
      return;
    }

    // La webcam s'éteint dès la prise de vue : laisser le voyant allumé pendant que l'agent
    // relit les champs lus par l'OCR est à la fois inutile et anxiogène.
    this._releaseStream();
    this.state.set('captured');
    this.captured.emit(file);
  }

  /**
   * Fichier importé : on le redimensionne aussi s'il dépasse la largeur utile. Une photo de 4000 px
   * prise au téléphone n'améliore pas la lecture et multiplie par six le temps d'envoi en agence.
   * Si la conversion échoue, le fichier d'origine part tel quel — mieux vaut une image lourde
   * qu'aucune image.
   */
  public async onImported(file: File | null): Promise<void> {
    this.importedFile.set(file);
    if (!file) return;

    this.isCompressing.set(true);
    try {
      const resized = await this._resizeFile(file);
      this.state.set('captured');
      this.captured.emit(resized ?? file);
    } finally {
      this.isCompressing.set(false);
    }
  }

  public ngOnDestroy(): void {
    // Sans ce `stop()`, la webcam reste allumée après la fermeture de l'écran : le flux survit au
    // composant tant qu'une piste n'est pas explicitement arrêtée.
    this._releaseStream();
  }

  private _fail(key: string): void {
    this._releaseStream();
    this.failure.set(CAMERA_FAILURES[key] ?? CAMERA_FAILURES['unknown']);
    this.state.set('error');
  }

  private _releaseStream(): void {
    this._stream()?.getTracks().forEach((track) => track.stop());
    this._stream.set(null);
    const element = this._video()?.nativeElement;
    if (element) element.srcObject = null;
  }

  private async _resizeFile(file: File): Promise<File | null> {
    if (typeof createImageBitmap !== 'function') return null;
    try {
      const bitmap = await createImageBitmap(file);
      const result = await this._toCompressedFile(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      return result;
    } catch {
      return null;
    }
  }

  private async _toCompressedFile(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
  ): Promise<File | null> {
    const scale = Math.min(1, this.maxWidth() / sourceWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sourceWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);

    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), 'image/jpeg', this.quality()),
    );
    if (!blob) return null;

    return new File([blob], `${this.fileBaseName()}-${Date.now()}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  }
}
