import { Injectable, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { UserDto, UsersApiService } from '@sankore/crm-api';

/**
 * L'utilisateur affiché, partagé entre l'en-tête de la fiche et ses onglets. Un onglet qui
 * enregistre appelle `reload()` : l'en-tête (nom, statut, bandeau d'invitation) suit sans que
 * chaque onglet ait à le prévenir. Fourni par la coque, donc propre à une fiche.
 */
@Injectable()
export class EditUserState {
  private readonly _usersApi = inject(UsersApiService);

  public readonly user = signal<UserDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  private _id: string | null = null;

  public load(id: string): void {
    this._id = id;
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._usersApi
      .getUser(id)
      .pipe(catchError(() => of(null)))
      .subscribe((user) => {
        if (user) this.user.set(user);
        else this.loadFailed.set(true);
        this.isLoading.set(false);
      });
  }

  public reload(): void {
    if (this._id) this.load(this._id);
  }
}
