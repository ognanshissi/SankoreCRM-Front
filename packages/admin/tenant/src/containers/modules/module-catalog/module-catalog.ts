import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { catchError, EMPTY, finalize } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ModuleCatalogApiService, ModuleDefinitionResponse } from '@sankore/crm-admin-api';
import { describeModuleError, formatPrice } from '../module-referential';
import { EditModuleDefinitionDrawer } from './edit-module-definition-drawer';

/**
 * L'offre : ce que chaque module s'appelle, coûte, et s'il peut être demandé. Pas de création ni
 * de suppression — un module est du code avant d'être une ligne ; la migration a créé les deux.
 */
@Component({
  templateUrl: './module-catalog.html',
  imports: [DatePipe, Button, TasIcon, TasTable],
})
export class ModuleCatalog implements OnInit {
  private readonly _api = inject(ModuleCatalogApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);

  public definitions = signal<ModuleDefinitionResponse[]>([]);
  public isLoading = signal(false);
  public loadError = signal<string | null>(null);
  public readonly price = formatPrice;

  public readonly tableConfig = signal<TableConfig>({
    property: 'code',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20] },
  });

  public ngOnInit(): void {
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._api
      .listModuleCatalog()
      .pipe(
        catchError((err) => {
          this.loadError.set(describeModuleError(err, 'Le catalogue n’a pas pu être chargé.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((definitions) => this.definitions.set(definitions ?? []));
  }

  public edit(definition: ModuleDefinitionResponse): void {
    const ref = this._drawer.open<boolean, ModuleDefinitionResponse, EditModuleDefinitionDrawer>(
      EditModuleDefinitionDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: definition },
    );
    ref.closed.subscribe((saved) => {
      if (!saved) return;
      this._snackbar.success('Module enregistré', definition.label ?? '');
      this.load();
    });
  }
}

export default ModuleCatalog;
