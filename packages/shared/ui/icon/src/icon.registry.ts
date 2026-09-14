import { inject, NgModule } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';

@NgModule()
export class TasIconRegistry {
  private readonly _iconRegistry = inject(MatIconRegistry);
  private readonly _domSanitizer = inject(DomSanitizer);

  constructor() {
    // Register icon sets
    this._iconRegistry.addSvgIconSet(
      this._domSanitizer.bypassSecurityTrustResourceUrl(
        'assets/material-outline.svg'
      )
    );
    this._iconRegistry.addSvgIconSetInNamespace(
      'feather',
      this._domSanitizer.bypassSecurityTrustResourceUrl('assets/feather.svg')
    );
    this._iconRegistry.addSvgIconSetInNamespace(
      'heroicons-outline',
      this._domSanitizer.bypassSecurityTrustResourceUrl(
        'assets/heroicons-outline.svg'
      )
    );
    this._iconRegistry.addSvgIconSetInNamespace(
      'heroicons-solid',
      this._domSanitizer.bypassSecurityTrustResourceUrl(
        'assets/heroicons-solid.svg'
      )
    );
    this._iconRegistry.addSvgIconSetInNamespace(
      'material-solid',
      this._domSanitizer.bypassSecurityTrustResourceUrl(
        'assets/material-solid.svg'
      )
    );
  }
}
