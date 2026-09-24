import { inject, Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormGroup } from '@angular/forms';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { SnackbarService } from '@talisoft/ui/snackbar';
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
 * - 400 ProblemDetails : projette les erreurs de validation sur les contrôles du formulaire
 * - 409 Conflict       : signale un conflit de version sans perdre la saisie
 * - 403 Forbidden      : signale l'action non autorisée, expose `forbidden` pour masquer les boutons
 * - Transmet rowVersion à chaque modification
 */
@Injectable({ providedIn: 'root' })
export class LeadSourcesService {
  private readonly _api = inject(LeadSourcesApiService);
  private readonly _snackbar = inject(SnackbarService);

  /** Set to true after a 403 — consumers hide actions accordingly */
  public readonly forbidden = signal(false);

  /** Set to true during a version conflict — consumers show reload prompt */
  public readonly versionConflict = signal(false);

  // ——— List ———

  public list(
    channelType?: number,
    mode?: number,
    status?: number,
    q?: string,
    page?: number,
    pageSize?: number,
  ): Observable<LeadSourceListDtoPagedResult> {
    return this._api.listLeadSources(
      channelType as any, mode as any, status as any, q, page, pageSize,
    ).pipe(this._handleErrors());
  }

  // ——— Detail ———

  public get(id: string): Observable<LeadSourceDetailDto> {
    this.versionConflict.set(false);
    return this._api.getLeadSource(id).pipe(this._handleErrors());
  }

  // ——— Create ———

  public create(
    request: CreateLeadSourceRequest,
    form?: FormGroup,
  ): Observable<string> {
    return this._api.createLeadSource(request).pipe(
      this._handleErrors(form),
    );
  }

  // ——— Update (auto-sends version) ———

  public update(
    id: string,
    request: UpdateLeadSourceRequest,
    form?: FormGroup,
  ): Observable<any> {
    return this._api.updateLeadSource(id, request).pipe(
      this._handleErrors(form),
    );
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

  private _handleErrors<T>(form?: FormGroup): (source: Observable<T>) => Observable<T> {
    return (source: Observable<T>) =>
      source.pipe(
        catchError((err: HttpErrorResponse) => {
          switch (err.status) {
            case 400:
              this._handle400(err, form);
              break;
            case 403:
              this._handle403();
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
   * 400 — ProblemDetails with validation errors.
   * Maps `errors` object keys (e.g. "settings.allowedOrigins[0]") to form controls.
   */
  private _handle400(err: HttpErrorResponse, form?: FormGroup): void {
    const body = err.error;
    const validationErrors: Record<string, string[]> = body?.errors ?? {};
    const hasFieldErrors = Object.keys(validationErrors).length > 0;

    if (form && hasFieldErrors) {
      for (const [path, messages] of Object.entries(validationErrors)) {
        const control = this._resolveControl(form, path);
        if (control) {
          control.setErrors({ server: messages.join('. ') });
          control.markAsTouched();
        }
      }
      this._snackbar.error(
        'Validation',
        body?.detail ?? 'Veuillez corriger les erreurs indiquées.',
      );
    } else {
      this._snackbar.error(
        'Erreur de validation',
        body?.detail ?? 'Les données envoyées sont invalides.',
      );
    }
  }

  /** 403 — Forbidden: mark as forbidden and notify */
  private _handle403(): void {
    this.forbidden.set(true);
    this._snackbar.error(
      'Accès refusé',
      'Vous n\'êtes pas autorisé à effectuer cette action.',
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

  /**
   * Resolves a form control from a dot/bracket path.
   * e.g. "settings.allowedOrigins[0]" → form.get("settings.allowedOrigins.0")
   */
  private _resolveControl(form: FormGroup, path: string): AbstractControl | null {
    const normalized = path.replace(/\[(\d+)]/g, '.$1');
    return form.get(normalized);
  }
}
