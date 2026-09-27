import {
  Directive,
  effect,
  inject,
  input,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import { PermissionsService } from '../services/permissions.service';
import { PermissionCode } from '../models/permissions';

/**
 * Masque un fragment de template quand l'utilisateur n'a pas la permission.
 *
 *   <button *hasPermission="'user:create'">Ajouter</button>
 *   <div *hasPermission="['role:update', 'role:manage-permissions']">…</div>
 *
 * Une liste signifie « au moins une ». Le code est typé sur le catalogue :
 * une permission inexistante ne compile pas.
 */
@Directive({
  selector: '[hasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly _permissions = inject(PermissionsService);
  private readonly _templateRef = inject(TemplateRef);
  private readonly _viewContainer = inject(ViewContainerRef);

  public readonly hasPermission = input.required<PermissionCode | PermissionCode[]>();

  private _rendered = false;

  constructor() {
    effect(() => {
      const required = this.hasPermission();
      const codes = Array.isArray(required) ? required : [required];
      // `granted()` est un signal : l'effet se réexécute à la reconnexion ou au
      // changement de rôle, sans que la directive relise l'utilisateur.
      const granted = this._permissions.granted();
      const hasAccess = codes.some((c) => granted.has(c));

      if (hasAccess && !this._rendered) {
        this._viewContainer.createEmbeddedView(this._templateRef);
        this._rendered = true;
      } else if (!hasAccess && this._rendered) {
        this._viewContainer.clear();
        this._rendered = false;
      }
    });
  }
}
