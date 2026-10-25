import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TenantProvider } from '@sankore/crm/common';
import { KycCameraCapture } from '../capture/kyc-camera-capture';
import { KycContinueOnPhone } from './kyc-continue-on-phone';
import { kycDocumentKindLabel, kycDocumentTypeLabel } from '../data-access/kyc-referential';
import { KycRemoteSessionStore } from './kyc-remote-session.store';
import {
  KycIdentifyOutcome,
  KycLinkState,
  KycRemoteService,
} from './kyc-remote.service';
import { kycQualityCauseLabel } from './kyc-remote-labels';

/** Les écrans du parcours, dans l'ordre où le client les traverse. */
type Step =
  | 'checking'
  | 'dead-link'
  | 'identify'
  | 'locked'
  | 'consent'
  /**
   * KRM-F-09 : le lien a été ouvert sur un appareil sans appareil photo arrière. Un écran de
   * PROPOSITION, inséré entre le consentement et la capture — avant la caméra, donc, parce
   * qu'une fois la première photo prise il est trop tard pour changer d'appareil sans tout
   * reprendre.
   */
  | 'continue-on-phone'
  | 'document'
  | 'selfie'
  | 'recap'
  | 'done';

/** Une pièce à photographier, telle que la session la décrit. */
interface PendingDocument {
  kind: string;
  label: string;
  uploaded: boolean;
  retriesRemaining: number;
}

class IdentifyFormModel {
  public clientNumber!: string;
  /** Chaîne ISO rendue par le sélecteur de date (`null` une fois vidé), convertie à la soumission. */
  public birthDate!: string;

  public static empty(): IdentifyFormModel {
    const model = new IdentifyFormModel();
    model.clientNumber = '';
    model.birthDate = '';
    return model;
  }
}

/**
 * Le parcours de dépôt des pièces, côté client (KRM-F-02 à F-05).
 *
 * Un seul composant routé pour les six écrans, et c'est un choix. Ils partagent une
 * session de vingt minutes, un état serveur unique (`GET /session`) et une barre
 * d'étapes ; les découper en routes enfants ferait qu'un rafraîchissement au milieu
 * atterrirait sur une étape sans session, et qu'un retour arrière du navigateur
 * ramènerait le client sur un écran que le serveur considère franchi.
 *
 * **Aucune règle métier ici.** Les pièces acceptées, les documents exigés, l'ordre, les
 * reprises restantes, le texte de consentement : tout vient de `GET /session`. La raison
 * n'est pas la pureté mais la cohérence — un administrateur qui modifie un produit
 * pendant qu'un client photographie sa carte doit changer ce que le serveur exige, et un
 * front qui aurait sa propre idée refuserait le dossier à la fin d'un parcours qu'il
 * avait annoncé complet.
 *
 * **Rien de ce que l'OCR lit n'est affiché**, et aucun résultat de comparaison faciale :
 * le client sait ce qu'il y a sur sa carte, et la façon dont l'institution la juge ne
 * lui appartient pas.
 */
@Component({
  selector: 'kyc-remote-verification',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kyc-remote-verification.html',
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasCard,
    Button,
    TasIcon,
    TasSpinner,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    TasDatePicker,
    KycCameraCapture,
    KycContinueOnPhone,
  ],
})
export class KycRemoteVerificationPage implements OnInit {
  private readonly _remote = inject(KycRemoteService);
  private readonly _session = inject(KycRemoteSessionStore);
  private readonly _tenant = inject(TenantProvider);

  public readonly step = signal<Step>('checking');
  public readonly linkState = signal<KycLinkState>('Unknown');
  public readonly isBusy = signal(false);
  public readonly errorMessage = signal<string | null>(null);

  /** L'état renvoyé par le serveur, source unique de ce qu'il reste à faire. */
  public readonly allowedTypes = signal<string[]>([]);
  public readonly requiredKinds = signal<string[]>([]);
  public readonly uploadedKinds = signal<string[]>([]);
  public readonly missingKinds = signal<string[]>([]);
  public readonly chosenType = signal<string | null>(null);
  public readonly consentText = signal('');
  public readonly consentVersion = signal('');
  public readonly retriesRemaining = signal<Record<string, number>>({});

  /** Le verdict qualité de la dernière photo, et ce qu'il faut corriger. */
  public readonly qualityCauses = signal<string[]>([]);

  public readonly institutionName = computed(
    () => this._tenant.context()?.name ?? '',
  );
  public readonly logoUrl = computed(() => this._tenant.context()?.logoUrl ?? null);

  /** Le jeton, lu une fois dans le fragment puis effacé de la barre d'adresse. */
  private _token: string | null = null;

  // ── Appareil sans caméra arrière (KRM-F-09) ─────────────────────────────

  /**
   * Le client a choisi de rester sur cet appareil. Une fois posé, l'écran de proposition ne
   * revient plus : il reparaîtrait à chaque pièce, et quelqu'un qui a dit « je continue à la
   * webcam » n'a pas besoin qu'on lui repose la question trois fois.
   */
  private readonly _stayingHere = signal(false);

  /** Null jusqu'à ce que la détection ait répondu, puis true/false. */
  private readonly _hasRearCamera = signal<boolean | null>(null);

  /**
   * Le lien complet à encoder dans le QR — reconstruit à partir du jeton gardé en mémoire et
   * NON lu dans la barre d'adresse, que `_readTokenFromFragment` a volontairement effacée.
   * Vide quand il n'y a pas de jeton, ce qui n'arrive pas sur cet écran.
   */
  public readonly continueLink = computed(() =>
    this._token
      ? `${window.location.origin}${window.location.pathname}#t=${this._token}`
      : '',
  );

  // ── Identification (KRM-F-03) ───────────────────────────────────────────

  public readonly identifyModel = signal(IdentifyFormModel.empty());

  public readonly identifyForm = form(this.identifyModel, (schema) => {
    validate(schema.clientNumber, (ctx) =>
      (ctx.value() ?? '').trim().length === 0
        ? { kind: 'required', message: 'Votre numéro client est obligatoire' }
        : undefined,
    );
    validate(schema.birthDate, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (!raw) {
        return { kind: 'required', message: 'Votre date de naissance est obligatoire' };
      }
      // Le sélecteur ne rend que des dates valides ; on revérifie quand même, et c'est
      // ici qu'une date future est refusée.
      const parsed = Date.parse(raw);
      if (Number.isNaN(parsed) || parsed > Date.now()) {
        return { kind: 'invalid', message: 'Indiquez une date de naissance valide' };
      }
      return undefined;
    });
  });

  // ── Étapes dérivées ─────────────────────────────────────────────────────

  /**
   * La pièce d'identité à photographier maintenant : le recto d'abord, puis le verso
   * quand le type choisi en a un. Le serveur dit lequel manque ; cette liste ne fait que
   * remettre dans l'ordre du parcours.
   */
  public readonly identityDocuments = computed<PendingDocument[]>(() =>
    ['IdentityDocumentFront', 'IdentityDocumentBack', 'ProofOfAddress']
      .filter((kind) => this.requiredKinds().includes(kind))
      .map((kind) => this._toPending(kind)),
  );

  public readonly nextIdentityDocument = computed(
    () => this.identityDocuments().find((d) => !d.uploaded) ?? null,
  );

  public readonly selfie = computed(() => this._toPending('Selfie'));

  public readonly allDocumentsReady = computed(() => this.missingKinds().length === 0);

  public readonly typeOptions = computed(() =>
    this.allowedTypes().map((value) => ({
      value,
      label: kycDocumentTypeLabel(value),
    })),
  );

  /** Les étapes affichées dans l'indicateur de progression (KRM-F-02). */
  public readonly progressSteps = computed(() => {
    const current = this.step();
    const order: Step[] = ['identify', 'consent', 'document', 'selfie', 'recap'];
    const index = order.indexOf(current);

    return [
      { label: 'Identification', done: index > 0, active: current === 'identify' },
      { label: 'Autorisation', done: index > 1, active: current === 'consent' },
      { label: 'Pièce', done: index > 2, active: current === 'document' },
      { label: 'Selfie', done: index > 3, active: current === 'selfie' },
      { label: 'Envoi', done: current === 'done', active: current === 'recap' },
    ];
  });

  public readonly deadLinkMessage = computed(() => {
    switch (this.linkState()) {
      case 'Expired':
        return "Ce lien a expiré. Contactez votre agence : elle peut vous en envoyer un nouveau.";
      case 'Consumed':
        return 'Vos pièces ont déjà été transmises. Vous recevrez un email dès que votre dossier sera traité.';
      case 'Revoked':
        return "Ce lien a été désactivé par votre agence. Contactez-la pour en recevoir un nouveau.";
      case 'FileClosed':
        return "Votre dossier est déjà pris en charge par votre agence : il n'y a plus de pièce à déposer ici.";
      case 'WrongTenant':
        return "Ce lien n'appartient pas à cette institution. Vérifiez que vous avez ouvert le lien reçu par email.";
      case 'Unreachable':
        return "Le service est momentanément indisponible. Réessayez dans quelques minutes.";
      default:
        return "Ce lien n'est pas valide. Vérifiez que vous avez ouvert le lien complet reçu par email.";
    }
  });

  public readonly canRetryLink = computed(() => this.linkState() === 'Unreachable');

  public readonly kindLabel = kycDocumentKindLabel;
  public readonly typeLabel = kycDocumentTypeLabel;
  public readonly causeLabel = kycQualityCauseLabel;

  public ngOnInit(): void {
    this._readTokenFromFragment();

    if (!this._token) {
      this.linkState.set('Unknown');
      this.step.set('dead-link');
      return;
    }

    this.checkLink();

    // KRM-F-09, lancée en parallèle du contrôle du lien : la réponse n'est lue qu'après le
    // consentement, donc rien n'attend dessus — et `void` plutôt qu'un `await` parce qu'un
    // navigateur qui met une seconde à énumérer ses périphériques ne doit pas retarder
    // l'affichage du premier écran.
    void this._detectRearCamera();
  }

  /**
   * Lit le jeton dans le fragment, puis l'efface de la barre d'adresse.
   *
   * Le fragment n'est jamais envoyé au serveur — c'est pourquoi le lien le met là plutôt
   * qu'en query string. L'effacer ensuite couvre ce que le fragment ne couvre pas : un
   * client qui montre son écran, un historique de navigation partagé, une capture
   * d'écran envoyée au support. `replaceState` ne crée pas d'entrée d'historique, donc le
   * bouton retour ne ramène pas l'URL complète.
   */
  private _readTokenFromFragment(): void {
    const hash = window.location.hash ?? '';
    const match = /[#&]t=([A-Za-z0-9_-]+)/.exec(hash);

    this._token = match?.[1] ?? null;

    if (this._token) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
  }

  public checkLink(): void {
    if (!this._token) return;

    this.step.set('checking');

    this._remote
      .linkStatus(this._token)
      .pipe(catchError(() => EMPTY))
      .subscribe((state) => {
        this.linkState.set(state);

        if (state === 'Locked') {
          this.step.set('locked');
          return;
        }

        this.step.set(state === 'Usable' ? 'identify' : 'dead-link');
      });
  }

  // ── KRM-F-03 : identification ───────────────────────────────────────────

  public handleIdentify(): void {
    submit(this.identifyForm, async (field) => {
      const token = this._token;
      if (!token) return;

      const value = field().value();
      this.errorMessage.set(null);

      const outcome = await firstValueFrom(
        this._remote.identify(
          token,
          value.clientNumber.trim(),
          value.birthDate,
        ),
      );

      this._applyIdentifyOutcome(outcome);
    });
  }

  private _applyIdentifyOutcome(outcome: KycIdentifyOutcome): void {
    switch (outcome) {
      case 'Identified':
        this.loadSession();
        return;

      case 'Locked':
        this.linkState.set('Locked');
        this.step.set('locked');
        return;

      case 'Unreachable':
        this.errorMessage.set(
          "Le service est momentanément indisponible. Réessayez dans quelques instants.",
        );
        return;

      default:
        // UN SEUL message, qui ne dit pas lequel des deux champs est en cause — le
        // serveur ne le dit pas non plus, et le nombre d'essais restants n'est
        // volontairement pas affiché : il indiquerait à un tiers combien il lui reste, et
        // découragerait le vrai client de réessayer.
        this.errorMessage.set(
          'Ces informations ne correspondent pas à notre dossier. Vérifiez votre numéro '
          + 'client (il figure dans votre email de bienvenue) et votre date de naissance.',
        );
    }
  }

  // ── État du parcours ────────────────────────────────────────────────────

  public loadSession(): void {
    this.isBusy.set(true);

    this._remote
      .session()
      .pipe(
        catchError(() => {
          this.isBusy.set(false);
          this._onSessionLost();
          return EMPTY;
        }),
      )
      .subscribe((state) => {
        this.isBusy.set(false);

        this.allowedTypes.set(state.allowedDocumentTypes ?? []);
        this.requiredKinds.set(state.requiredDocuments ?? []);
        this.uploadedKinds.set(state.uploadedDocuments ?? []);
        this.missingKinds.set(state.missingDocuments ?? []);
        this.chosenType.set(state.chosenDocumentType ?? null);
        this.consentText.set(state.consentText ?? '');
        this.consentVersion.set(state.consentTextVersion ?? '');
        this.retriesRemaining.set(state.retriesRemaining ?? {});

        this.step.set(this._nextStep(state.consentGiven === true));
      });
  }

  /**
   * L'écran à afficher, déduit de l'état SERVEUR et jamais d'un compteur local.
   *
   * C'est ce qui fait qu'un client revenu après l'expiration de sa session reprend là où
   * il s'était arrêté : ses photos sont sur le serveur, donc l'étape l'est aussi.
   */
  private _nextStep(consentGiven: boolean): Step {
    if (!consentGiven) return 'consent';

    // KRM-F-09 : la proposition de passer au téléphone s'insère ici et nulle part ailleurs —
    // avant la PREMIÈRE capture. Une fois une photo prise elle ne reparaît plus, puisque
    // nextIdentityDocument() n'est plus le premier document à faire… et surtout parce que
    // changer d'appareil en cours de route marcherait de toute façon : les photos sont sur le
    // serveur et la session se rouvre depuis le QR.
    if (this.nextIdentityDocument() !== null) {
      return this.uploadedKinds().length === 0 ? this._afterConsentStep() : 'document';
    }

    if (!this.uploadedKinds().includes('Selfie')) return 'selfie';
    return 'recap';
  }

  private _onSessionLost(): void {
    // La session a expiré, ou le lien a été révoqué pendant le parcours. Retour à
    // l'identification — les photos déjà envoyées sont conservées côté serveur, et le
    // prochain `GET /session` les retrouvera.
    this._session.close();
    this.errorMessage.set(
      'Votre session a expiré. Identifiez-vous à nouveau : les photos déjà envoyées sont conservées.',
    );
    this.step.set('identify');
  }

  // ── KRM-F-04 : consentement et pièce ────────────────────────────────────

  public acceptConsent(): void {
    this.isBusy.set(true);

    this._remote
      .consent(this.consentVersion())
      .pipe(
        catchError(() => {
          this.isBusy.set(false);
          this.errorMessage.set(
            "Votre autorisation n'a pas pu être enregistrée. Réessayez.",
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isBusy.set(false);
        this.loadSession();
      });
  }

  public chooseType(type: string): void {
    this.chosenType.set(type);
    this.qualityCauses.set([]);
  }

  /**
   * Revient au choix de la pièce.
   *
   * Remet seulement la sélection locale à zéro : les photos déjà envoyées restent sur le
   * serveur, et le prochain `GET /session` dira de nouveau quel type elles déclaraient.
   * Choisir un autre type se matérialise en reprenant le recto, ce que le serveur traite
   * comme la correction d'un mauvais choix.
   */
  public resetType(): void {
    this.chosenType.set(null);
    this.qualityCauses.set([]);
  }

  /**
   * Envoie une photo et traite le verdict qualité.
   *
   * Un refus n'est pas une erreur : la photo ne compte pas comme déposée, les causes
   * sont affichées, et le client reprend. C'est tout l'intérêt du contrôle immédiat —
   * la carte est encore dans sa main.
   */
  public async capture(kind: string, file: File): Promise<void> {
    this.isBusy.set(true);
    this.errorMessage.set(null);
    this.qualityCauses.set([]);

    const needsType =
      kind === 'IdentityDocumentFront' || kind === 'IdentityDocumentBack';

    const verdict = await firstValueFrom(
      this._remote
        .upload(kind, file, needsType ? (this.chosenType() ?? undefined) : undefined)
        .pipe(
          catchError(() => {
            this.isBusy.set(false);
            this.errorMessage.set(
              "Cette photo n'a pas pu être envoyée. Vérifiez votre connexion et réessayez.",
            );
            return EMPTY;
          }),
        ),
    ).catch(() => null);

    this.isBusy.set(false);

    if (!verdict) return;

    if (verdict.accepted === false) {
      this.qualityCauses.set(verdict.qualityCauses ?? []);

      if ((verdict.qualityCauses ?? []).length === 0 && verdict.qualityCode) {
        // Le service a refusé sans détailler : on affiche la consigne générique plutôt
        // qu'un code.
        this.qualityCauses.set([verdict.qualityCode]);
      }

      this.retriesRemaining.update((current) => ({
        ...current,
        [kind]: verdict.retriesRemaining ?? 0,
      }));
      return;
    }

    this.loadSession();
  }

  /** Reprendre une photo déjà envoyée, depuis le récapitulatif. */
  public retake(kind: string): void {
    this.isBusy.set(true);

    this._remote
      .removeDocument(kind)
      .pipe(
        catchError(() => {
          this.isBusy.set(false);
          this.errorMessage.set("Cette photo n'a pas pu être retirée. Réessayez.");
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isBusy.set(false);
        this.qualityCauses.set([]);
        this.loadSession();
      });
  }

  // ── KRM-F-05 : envoi ────────────────────────────────────────────────────

  public send(): void {
    this.isBusy.set(true);
    this.errorMessage.set(null);

    this._remote
      .submit()
      .pipe(
        catchError(() => {
          this.isBusy.set(false);
          this._onSessionLost();
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.isBusy.set(false);

        if (!result.submitted) {
          // Le serveur a la liste de ce qui manque : on la reprend plutôt que de
          // recalculer, et on renvoie le client sur l'étape correspondante.
          this.missingKinds.set(result.missing);
          this.errorMessage.set('Il manque encore une pièce.');
          this.step.set(this._nextStep(true));
          return;
        }

        this.step.set('done');
      });
  }

  public goToStep(step: Step): void {
    this.errorMessage.set(null);
    this.qualityCauses.set([]);
    this.step.set(step);
  }

  /** KRM-F-09 : le client reste sur cet appareil et passe à la capture. */
  public continueOnThisDevice(): void {
    this._stayingHere.set(true);
    this.goToStep('document');
  }

  /**
   * Détecte si l'appareil a de quoi photographier une pièce d'identité (KRM-F-09).
   *
   * **C'est une heuristique, et elle est assumée comme telle** — d'où un écran qui propose au
   * lieu de bloquer. La seule détection fiable serait
   * `getUserMedia({ video: { facingMode: { exact: 'environment' } } })`, qui déclenche la
   * demande d'autorisation caméra : poser cette demande à quelqu'un sur un ordinateur pour lui
   * dire ensuite d'utiliser son téléphone est exactement l'inverse de ce que l'écran cherche à
   * éviter. `enumerateDevices` sans autorisation renvoie des entrées aux libellés vides, donc
   * ni `label` ni `facingMode` ne sont lisibles ; ce qui reste lisible est le NOMBRE
   * d'entrées vidéo.
   *
   * Deux signaux, et la combinaison est choisie pour se tromper du bon côté :
   *
   * - **deux entrées vidéo ou plus** → un téléphone, qui expose avant et arrière ;
   * - **une seule entrée sur un appareil tactile** → une tablette, dont la caméra unique est
   *   utilisable pour une pièce.
   *
   * Un ordinateur portable a une webcam et aucun écran tactile, et tombe donc du côté « pas de
   * caméra arrière ». Un ordinateur tactile avec une seule webcam est le faux négatif de cette
   * règle : il verra la capture directement, ce qui est le résultat le moins gênant des deux.
   *
   * Une API absente ou qui refuse de répondre compte comme « on ne sait pas », et on ne sait
   * pas vaut « continue ici » : un navigateur qui ne donne pas accès à `enumerateDevices` ne
   * doit pas envoyer tous ses clients sur un QR code.
   */
  private async _detectRearCamera(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      const videoInputs = (devices ?? []).filter((d) => d.kind === 'videoinput').length;

      // maxTouchPoints plutôt que `matchMedia('(pointer: coarse)')` : le second est vrai sur un
      // ordinateur portable dont on a branché un écran tactile en second moniteur.
      const isTouch = (navigator.maxTouchPoints ?? 0) > 0;

      this._hasRearCamera.set(videoInputs >= 2 || (isTouch && videoInputs >= 1));
    } catch {
      this._hasRearCamera.set(true);
    }
  }

  /**
   * L'écran à afficher après le consentement : la proposition de passer au téléphone, ou la
   * capture. Lu par `_nextStep`, donc par les deux chemins qui arrivent là.
   */
  private _afterConsentStep(): Step {
    return this._hasRearCamera() === false && !this._stayingHere()
      ? 'continue-on-phone'
      : 'document';
  }

  private _toPending(kind: string): PendingDocument {
    return {
      kind,
      label: kycDocumentKindLabel(kind),
      uploaded: this.uploadedKinds().includes(kind),
      retriesRemaining: this.retriesRemaining()[kind] ?? 0,
    };
  }
}

export default KycRemoteVerificationPage;
