import { Component, input } from '@angular/core';
import { LoginHistoryList } from './login-history-list';

/**
 * Onglet « Connexions » de la fiche utilisateur.
 *
 * Le contrat déclare la version admin de l'opération
 * (`GET /users/{userId}/login-history`) sans aucune permission : la route
 * reprend `user:read`, le droit que la fiche utilisateur exige déjà, plutôt
 * qu'un code inventé pour l'occasion.
 */
@Component({
  selector: 'user-connexions',
  imports: [LoginHistoryList],
  template: `
    <div class="pb-6 flex flex-col gap-4">
      <user-login-history [userId]="id()"></user-login-history>
    </div>
  `,
})
export class UserConnexionsPage {
  public readonly id = input.required<string>();
}

export default UserConnexionsPage;
