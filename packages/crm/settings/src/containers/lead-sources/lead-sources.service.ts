import { inject, Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, Observable, throwError } from 'rxjs';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ChannelTypeParam, ModeParam, StatusParam } from './lead-source.types';
import {
  LeadSourcesApiService,
  LeadSourceDetailDto,
  LeadSourceListDtoPagedResult,
  CreateLeadSourceRequest,
  UpdateLeadSourceRequest,
  SnippetResult,
  DryRunResult,
  SendSnippetRequest,
  PreviewMappingRequest,
  PreviewMappingResult,
  SetSecretRequest,
  SecretHint,
  RotateHmacSecretResult,
  RunDtoPagedResult,
  ManualPullResult,
  SourceQualityDto,
} from '@sankore/crm-api';

/**
 * FE-02 — Service d'accès aux sources avec gestion structurée des erreurs.
 *
 * - 400 / 422 ProblemDetails : expose les erreurs de validation par chemin de champ
 *   (le contrat déclare 422 sur la création et sur activate/pause/archive ;
 *   traiter le seul 400 laissait `serverErrors` vide et les blocs d'erreur des
 *   écrans inertes)
 * - 404 Not Found      : la source a disparu entre l'affichage et l'action
 * - 409 Conflict       : signale un conflit de version sans perdre la saisie
 * - 403 Forbidden      : signale l'action non autorisée, expose `forbidden` pour masquer les boutons
 * - Transmet rowVersion à chaque modification
 */
@Injectable({ providedIn: 'root' })
export class LeadSourcesService {
  private readonly _api = inject(LeadSourcesApiService);
  private readonly _snackbar = inject(SnackbarService);

  /**
   * Passe à `true` après un 403 — les écrans masquent les actions en conséquence.
   * Le service est `providedIn: 'root'` : sans remise à zéro au chargement
   * (`get()` / `list()`), un seul refus masquait les boutons de toutes les
   * sources jusqu'au rechargement complet de la page.
   */
  public readonly forbidden = signal(false);

  /** Set to true during a version conflict — consumers show reload prompt */
  public readonly versionConflict = signal(false);

  /**
   * FE-02 — Erreurs de validation du serveur, indexees par chemin normalise
   * (`settings.allowedOrigins.0`). Les ecrans « sources » sont bases sur des
   * signals et non sur des `FormGroup` : la projection sur des controles ne
   * les atteindrait pas. Ils lisent ce signal via `errorFor(path)`.
   */
  public readonly serverErrors = signal<Record<string, string>>({});

  /** Message d'erreur serveur pour un champ, ou `null`. */
  public errorFor(path: string): string | null {
    return this.serverErrors()[path] ?? null;
  }

  /** A appeler avant une nouvelle soumission. */
  public clearServerErrors(): void {
    this.serverErrors.set({});
  }

  // ——— List ———

  public list(
    channelType?: ChannelTypeParam,
    mode?: ModeParam,
    status?: StatusParam,
    q?: string,
    page?: number,
    pageSize?: number,
  ): Observable<LeadSourceListDtoPagedResult> {
    this.forbidden.set(false);
    return this._api
      .listLeadSources(channelType, mode, status, q, page, pageSize)
      .pipe(this._handleErrors());
  }

  // ——— Detail ———

  public get(id: string): Observable<LeadSourceDetailDto> {
    this.versionConflict.set(false);
    this.forbidden.set(false);
    return this._api.getLeadSource(id).pipe(this._handleErrors());
  }

  // ——— Create ———

  public create(request: CreateLeadSourceRequest): Observable<string> {
    this.clearServerErrors();
    return this._api.createLeadSource(request).pipe(this._handleErrors());
  }

  // ——— Update (auto-sends version) ———

  public update(
    id: string,
    request: UpdateLeadSourceRequest,
  ): Observable<any> {
    this.clearServerErrors();
    return this._api.updateLeadSource(id, request).pipe(this._handleErrors());
  }

  // ——— Lifecycle ———

  public activate(id: string): Observable<any> {
    return this._api.activateLeadSource(id).pipe(this._handleErrors());
  }

  public pause(id: string): Observable<any> {
    return this._api.pauseLeadSource(id).pipe(this._handleErrors());
  }

  public archive(id: string): Observable<any> {
    return this._api.archiveLeadSource(id).pipe(this._handleErrors());
  }

  public startTesting(id: string): Observable<any> {
    return this._api.startTestingLeadSource(id).pipe(this._handleErrors());
  }

  // ——— Specific actions ———

  public getSnippet(id: string): Observable<SnippetResult> {
    return this._api.getLeadSourceSnippet(id).pipe(this._handleErrors());
  }

  public sendSnippet(id: string, request: SendSnippetRequest): Observable<any> {
    return this._api.sendLeadSourceSnippet(id, request).pipe(this._handleErrors());
  }

  public dryRun(id: string): Observable<DryRunResult> {
    return this._api.dryRunLeadSource(id).pipe(this._handleErrors());
  }

  public previewMapping(id: string, request: PreviewMappingRequest): Observable<PreviewMappingResult> {
    return this._api.previewLeadSourceMapping(id, request).pipe(this._handleErrors());
  }

  public rotateHmacSecret(id: string): Observable<RotateHmacSecretResult> {
    return this._api.rotateLeadSourceHmacSecret(id).pipe(this._handleErrors());
  }

  public rotatePublicKey(id: string): Observable<string> {
    return this._api.rotateLeadSourcePublicKey(id).pipe(this._handleErrors());
  }

  public setSecret(id: string, name: string, request: SetSecretRequest): Observable<SecretHint> {
    return this._api.setLeadSourceSecret(id, name, request).pipe(this._handleErrors());
  }

  public getProviderDoc(id: string): Observable<any> {
    return this._api.getProviderDoc(id).pipe(this._handleErrors());
  }

  public listRuns(id: string, page?: number, pageSize?: number): Observable<RunDtoPagedResult> {
    return this._api.listLeadSourceRuns(id, page, pageSize).pipe(this._handleErrors());
  }

  public manualPull(id: string): Observable<ManualPullResult> {
    return this._api.manualPullLeadSource(id).pipe(this._handleErrors());
  }

  public getSourceQuality(from?: string, to?: string): Observable<SourceQualityDto[]> {
    return this._api.getSourceQuality(from, to).pipe(this._handleErrors());
  }

  public exportDuplicates(id: string): Observable<any> {
    return this._api.exportSourceDuplicates(id).pipe(this._handleErrors());
  }

  // ——— Error handling pipeline ———

  private _handleErrors<T>(): (source: Observable<T>) => Observable<T> {
    return (source: Observable<T>) =>
      source.pipe(
        catchError((err: HttpErrorResponse) => {
          switch (err.status) {
            // Le contrat déclare 422 (ValidationProblemDetails) sur la création
            // et sur activate/pause/archive : sans ce cas, les erreurs de champ
            // tombaient dans `default` et n'atteignaient jamais `serverErrors`.
            case 400:
            case 422:
              this._handleValidationError(err);
              break;
            case 403:
              this._handle403();
              break;
            case 404:
              this._handle404();
              break;
            case 409:
              this._handle409();
              break;
            default:
              this._snackbar.error('Erreur', err.error?.detail ?? 'Une erreur inattendue est survenue.');
          }
          return throwError(() => err);
        }),
      );
  }

  /**
   * 400 / 422 — (Validation)ProblemDetails.
   * Expose les erreurs par chemin normalisé (`settings.allowedOrigins.0`), que
   * les écrans lisent via `errorFor(path)`, et les répète dans le snackbar :
   * la branche précédente ne gardait que `detail`, presque toujours nul sur un
   * ValidationProblemDetails, donc les messages du serveur étaient perdus.
   */
  private _handleValidationError(err: HttpErrorResponse): void {
    const body = err.error;
    const validationErrors: Record<string, string[]> = body?.errors ?? {};

    const byPath: Record<string, string> = {};
    for (const [path, messages] of Object.entries(validationErrors)) {
      byPath[this._normalizePath(path)] = (messages ?? []).join('. ');
    }
    this.serverErrors.set(byPath);

    const collected = Object.values(byPath).filter(Boolean).join(' ');
    this._snackbar.error(
      'Erreur de validation',
      collected || body?.detail || body?.title || 'Les données envoyées sont invalides.',
    );
  }

  /** 403 — Forbidden: mark as forbidden and notify */
  private _handle403(): void {
    this.forbidden.set(true);
    this._snackbar.error(
      'Accès refusé',
      'Vous n\'êtes pas autorisé à effectuer cette action.',
    );
  }

  /** 404 — la source a disparu entre l'affichage de la liste et l'action */
  private _handle404(): void {
    this._snackbar.error(
      'Source introuvable',
      'Cette source n\'existe plus. Rechargez la liste pour voir l\'état à jour.',
    );
  }

  /** 409 — Conflict: the source was modified by another user */
  private _handle409(): void {
    this.versionConflict.set(true);
    this._snackbar.error(
      'Conflit de version',
      'Cette source a été modifiée par un autre utilisateur. Rechargez pour voir les dernières modifications.',
    );
  }

  /** `settings.allowedOrigins[0]` → `settings.allowedOrigins.0` */
  private _normalizePath(path: string): string {
    return path.replace(/\[(\d+)]/g, '.$1');
  }
}
