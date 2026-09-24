import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthenticationService } from '../services/authentification.service';

@Directive({
  selector: '[hasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly _auth = inject(AuthenticationService);
  private readonly _templateRef = inject(TemplateRef);
  private readonly _viewContainer = inject(ViewContainerRef);

  public readonly hasPermission = input.required<string>();

  private _rendered = false;

  constructor() {
    effect(() => {
      const requiredCode = this.hasPermission();
      const permissions = this._auth.connectedUser()?.permissions;
      const hasAccess = (permissions ?? []).includes(requiredCode);

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
