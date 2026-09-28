import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { AgenciesApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';

export interface ActivatableAgency {
  id?: string;
  name?: string | null;
}

/**
 * Réactivation d'une agence — POST /api/v1/agencies/{id}/activate, permission
 * `agency:activate`.
 *
 * Le service est partagé entre la fiche agence et l'arborescence : le contrat
 * décrit l'endpoint comme l'inverse exact de la suppression douce
 * (« sets IsActive=true and IsDeleted=false »), donc les deux points d'entrée
 * doivent poser la même question et annoncer le même résultat. Dupliquer la
 * confirmation dans les deux écrans les ferait dériver l'un de l'autre.
 */
@Injectable({ providedIn: 'root' })
export class AgencyActivationService {
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);

  /**
   * Id de l'agence en cours de réactivation, ou `null`. Exposé plutôt qu'un
   * simple booléen pour que l'arborescence puisse n'afficher le chargement que
   * sur la ligne concernée.
   */
  public readonly activatingId = signal<string | null>(null);

  public confirmAndActivate(
    agency: ActivatableAgency,
    onActivated?: () => void,
  ): void {
    const id = agency.id;
    if (!id) return;

    const label = agency.name?.trim() || 'Cette agence';

    this._confirmDialogService.confirm({
      title: "Réactiver l'agence",
      message:
        `« ${label} » redeviendra active et ne sera plus marquée comme supprimée. ` +
        'Ses utilisateurs et sa position dans la hiérarchie sont conservés. Continuer ?',
      closable: true,
      acceptButtonProps: { label: 'Réactiver', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.activatingId.set(id);
        this._agenciesApiService
          .activateAgency(id)
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbarService.error('Erreur', this._describeError(err));
              this.activatingId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this.activatingId.set(null);
            this._snackbarService.success(
              'Agence réactivée',
              `« ${label} » est de nouveau active.`,
            );
            onActivated?.();
          });
      },
    });
  }

  private _describeError(err: HttpErrorResponse): string {
    const body = err?.error;
    const serverMessage =
      (typeof body?.detail === 'string' && body.detail.trim()) ||
      (typeof body?.title === 'string' && body.title.trim()) ||
      '';

    switch (err?.status) {
      case 403:
        return "Vous n'avez pas la permission de réactiver une agence.";
      case 404:
        return "Cette agence est introuvable : elle a peut-être été supprimée définitivement.";
      case 400:
        return (
          serverMessage ||
          "La réactivation a été refusée : l'agence n'est pas dans un état réactivable."
        );
      default:
        return (
          serverMessage ||
          "Impossible de réactiver l'agence, réessayez plus tard."
        );
    }
  }
}
