import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthenticationService } from '../services/authentification.service';

@Directive({
  selector: '[sankoreHasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly _auth = inject(AuthenticationService);
  private readonly _templateRef = inject(TemplateRef);
  private readonly _viewContainer = inject(ViewContainerRef);

  public readonly sankoreHasPermission = input.required<string>();

  private _rendered = false;

  constructor() {
    effect(() => {
      const requiredCode = this.sankoreHasPermission();
      const permissions = this._auth.userPermissions();
      const codes = permissions?.rolePermissionCodes ?? [];
      const hasAccess = codes.includes(requiredCode);

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
