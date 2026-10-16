import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TelephonyApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { EMPTY, catchError, firstValueFrom } from 'rxjs';
import {
  isRecordingPlayable,
  telRecordingStatusLabel,
  telRecordingStatusSeverity,
  telephonyErrorMessage,
} from '../../data-access/telephony-referential';

/**
 * Lecteur d'enregistrement d'appel (TEL-F-10).
 *
 * Trois choses dans ce composant ne sont pas des choix de style et ne doivent pas être
 * « simplifiées ».
 *
 * 1. **Pas d'URL signée, et `<audio src>` ne peut pas pointer sur l'API.** Le serveur sert
 *    un flux AUTHENTIFIÉ et audité (`GET telephony/calls/{id}/recording`), délibérément :
 *    une URL signée ne permet d'auditer que l'ÉMISSION du lien, alors que la story exige que
 *    l'ÉCOUTE soit tracée. Or un `<audio src="...">` déclenche une requête du navigateur à
 *    laquelle on ne peut pas attacher d'en-tête `Authorization`. D'où le détour obligé :
 *    on télécharge le Blob avec le jeton, on fabrique un object URL, on le donne à `<audio>`.
 *
 * 2. **L'object URL est révoqué.** À la destruction du composant et avant tout rechargement.
 *    Sans ça les octets de la conversation restent accessibles dans l'onglet pour la durée de
 *    la session, ce qui contredit l'exigence « aucun média conservé dans le navigateur ».
 *
 * 3. **Aucun bouton de téléchargement sur l'écoute.** L'export est une action séparée, sous
 *    une permission séparée, avec un motif obligatoire — parce qu'il fait sortir la voix de
 *    quelqu'un de la plateforme, hors de portée de tous les contrôles du lecteur.
 *
 * Conséquences assumées de cette conception, à ne pas prendre pour des défauts : le fichier
 * est chargé en entier avant la première seconde de son (pas de requêtes `Range`, donc pas de
 * lecture progressive), et chaque chargement écrit une ligne dans le journal d'accès — c'est
 * exactement ce que ce journal est censé contenir.
 */
@Component({
  selector: 'lib-recording-player',
  imports: [
    FormsModule,
    Button,
    TasIcon,
    TasSpinner,
    TasTag,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './recording-player.html',
})
export class RecordingPlayer {
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly callId = input.required<string>();

  /**
   * L'état d'enregistrement tel que le serveur le renvoie sur la ligne d'appel. On ne le
   * déduit pas : « Récupération en cours », « Indisponible » et « Supprimé (fin de
   * conservation) » sont trois situations différentes pour l'utilisateur, et seul le serveur
   * les distingue.
   */
  public readonly recordingStatus = input<string | null>(null);

  /**
   * Ce que le serveur dit de CE lecteur-ci. Fourni par la ligne de journal (`canListen`),
   * qui l'a calculé avec le périmètre appliqué — on ne le recalcule pas côté client.
   */
  public readonly canListen = input<boolean>(false);

  public readonly canExport = this._permissions.can('Telephony.Recording.Export');

  public readonly isLoading = signal(false);
  public readonly loadError = signal<string | null>(null);
  public readonly audioUrl = signal<string | null>(null);
  public readonly speed = signal<1 | 1.5 | 2>(1);

  public readonly isExportOpen = signal(false);
  public readonly exportReason = signal('');
  public readonly isExporting = signal(false);

  public readonly statusLabel = computed(() => telRecordingStatusLabel(this.recordingStatus()));
  public readonly statusSeverity = computed(() =>
    telRecordingStatusSeverity(this.recordingStatus()),
  );

  /** Lecture possible : il y a des octets à récupérer ET le serveur nous l'accorde. */
  public readonly isPlayable = computed(
    () => this.canListen() && isRecordingPlayable(this.recordingStatus()),
  );

  public readonly exportReasonError = computed(() =>
    this.exportReason().trim().length === 0
      ? 'Le motif est obligatoire : il est conservé au journal d’audit.'
      : null,
  );

  constructor() {
    // Révocation à la destruction. C'est la ligne qui rend vraie la promesse « aucun média
    // conservé dans le navigateur » : sans elle, les octets de la conversation restent
    // joignables par l'object URL jusqu'à la fin de la session.
    this._destroyRef.onDestroy(() => this._revoke());
  }

  public async load(): Promise<void> {
    if (this.isLoading() || this.audioUrl()) return;

    this.isLoading.set(true);
    this.loadError.set(null);

    // Le client généré annonce `Observable<object>` alors que la réponse est un Blob : la
    // méthode force `Accept: application/octet-stream`, donc `responseType: 'blob'`. Le cast
    // est le prix de cette imprécision du générateur, pas une approximation de notre part.
    const blob = (await firstValueFrom(
      this._telephonyApi.listenTelephonyRecording(this.callId()).pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(
            telephonyErrorMessage(error, "L'enregistrement n'a pas pu être chargé."),
          );
          this.isLoading.set(false);

          return EMPTY;
        }),
      ),
    )) as Blob | undefined;

    if (!blob) return;

    this._revoke();
    this.audioUrl.set(URL.createObjectURL(blob));
    this.isLoading.set(false);
  }

  public setSpeed(value: 1 | 1.5 | 2, player: HTMLAudioElement | null): void {
    this.speed.set(value);

    if (player) player.playbackRate = value;
  }

  public openExport(): void {
    this.exportReason.set('');
    this.isExportOpen.set(true);
  }

  public closeExport(): void {
    this.isExportOpen.set(false);
  }

  public async submitExport(): Promise<void> {
    if (this.exportReasonError()) return;

    this.isExporting.set(true);

    const blob = (await firstValueFrom(
      this._telephonyApi
        .exportTelephonyRecording(this.callId(), this.exportReason().trim())
        .pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error(
              'Export impossible',
              telephonyErrorMessage(error, "L'export n'a pas abouti."),
            );
            this.isExporting.set(false);

            return EMPTY;
          }),
        ),
    )) as Blob | undefined;

    this.isExporting.set(false);

    if (!blob) return;

    // Un object URL éphémère, révoqué immédiatement après le clic : c'est le seul moyen de
    // remettre un fichier à l'utilisateur sans jamais exposer d'URL durable vers l'API, et
    // sans que rien ne subsiste dans l'onglet.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `appel-${this.callId()}.audio`;
    anchor.click();

    URL.revokeObjectURL(url);

    this.isExportOpen.set(false);
    this._snackbar.success('Export effectué', 'Le motif a été consigné au journal d’audit.');
  }

  private _revoke(): void {
    const url = this.audioUrl();

    if (url) {
      URL.revokeObjectURL(url);
      this.audioUrl.set(null);
    }
  }
}
