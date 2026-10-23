import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { catchError, EMPTY } from 'rxjs';
import {
  TenantModuleDto,
  TenantModuleDtoStateEnum,
  TenantModulesApiService,
  TenantModuleSubscriptionDto,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService, TenantModulesService } from '@sankore/crm/common';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { RequestTenantModuleDrawer, RequestTenantModuleOutcome } from './request-tenant-module-drawer';
import { formatModulePrice, MODULE_STATE_META, moduleErrorMessage } from './tenant-modules.models';

/**
 * Les modules payants de l'institution : ce qu'ils coûtent, où en est chacun, et les trois gestes
 * de l'administrateur — demander, annuler une demande, désactiver. L'autorisation, elle, se donne
 * dans l'application de la plateforme.
 *
 * Deux cartes et non un `tas-table` : la liste est fixe, sans pagination ni recherche (choix du
 * propriétaire du projet).
 */
@Component({
  templateUrl: './tenant-modules.html',
  imports: [DatePipe, TasCard, Button, TasIcon, TasTag, TasSpinner],
})
export class TenantModulesPage implements OnInit {
  private readonly _api = inject(TenantModulesApiService);
  private readonly _tenantModules = inject(TenantModulesService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canRequest = this._permissions.can('tenant:modules:request');
  public readonly canDeactivate = this._permissions.can('tenant:modules:deactivate');

  public isLoading = signal(true);
  public loadFailed = signal<string | null>(null);
  public modules = signal<TenantModuleDto[]>([]);
  public busyCode = signal<string | null>(null);
  public expandedHistory = signal<ReadonlySet<string>>(new Set());

  public readonly stateMeta = MODULE_STATE_META;
  public readonly price = formatModulePrice;

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Modules et abonnement' },
    ]);
    this._load();
  }

  public reload(): void {
    this.isLoading.set(true);
    this._load();
  }

  public state(module: TenantModuleDto): TenantModuleDtoStateEnum {
    return module.state ?? TenantModuleDtoStateEnum.None;
  }

  /** Demander n'a de sens que hors d'une période ouverte, et pour un module que la plateforme propose. */
  public canAsk(module: TenantModuleDto): boolean {
    const state = this.state(module);
    return !!module.isAvailable && state !== 'Requested' && state !== 'Active';
  }

  public toggleHistory(code: string): void {
    this.expandedHistory.update((set) => {
      const next = new Set(set);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  /** La ligne courante est déjà décrite en tête de carte : l'historique montre les périodes passées. */
  public pastPeriods(module: TenantModuleDto): TenantModuleSubscriptionDto[] {
    return (module.history ?? []).filter((h) => h.id !== module.current?.id);
  }

  public openRequest(module: TenantModuleDto): void {
    const ref = this._sideDrawer.open<RequestTenantModuleOutcome, TenantModuleDto, RequestTenantModuleDrawer>(
      RequestTenantModuleDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: module },
    );
    ref.closed.subscribe((outcome) => {
      if (outcome === 'requested') {
        this._snackbar.success('Demande envoyée', `L’équipe Sankoré va examiner la demande « ${module.label} ».`);
      }
      if (outcome) this._load();
    });
  }

  public cancelRequest(module: TenantModuleDto): void {
    const id = module.current?.id;
    if (!id) return;
    this._confirmDialog.confirm({
      title: 'Annuler la demande ?',
      message: `La demande du module « ${module.label} » sera retirée. Vous pourrez en refaire une plus tard.`,
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Annuler la demande', theme: 'warn' },
      rejectButtonProps: { label: 'Garder la demande' },
      accept: () => {
        this.busyCode.set(module.code!);
        this._api.cancelTenantModuleRequest(id).pipe(
          catchError((err) => {
            this.busyCode.set(null);
            this._snackbar.error('Erreur', moduleErrorMessage(err, 'La demande n’a pas pu être annulée.'));
            this._load();
            return EMPTY;
          }),
        ).subscribe(() => {
          this._snackbar.success('Demande annulée', `La demande « ${module.label} » est retirée.`);
          this._load();
        });
      },
    });
  }

  public deactivate(module: TenantModuleDto): void {
    this._confirmDialog.confirm({
      title: `Désactiver « ${module.label} » ?`,
      message:
        'La désactivation est immédiate : pour toute l’institution, les écrans du module passent en consultation ' +
        'seule et plus rien ne peut y être créé ni modifié. Aucune donnée n’est supprimée, les produits et ' +
        'contrats existants restent utilisables. Réactiver le module demandera une nouvelle autorisation.',
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.busyCode.set(module.code!);
        this._api.deactivateTenantModule(module.code!).pipe(
          catchError((err) => {
            this.busyCode.set(null);
            this._snackbar.error('Erreur', moduleErrorMessage(err, 'Le module n’a pas pu être désactivé.'));
            this._load();
            return EMPTY;
          }),
        ).subscribe(() => {
          this._snackbar.success('Module désactivé', `« ${module.label} » n’est plus actif.`);
          this._load();
        });
      },
    });
  }

  private _load(): void {
    this._api.listTenantModules().pipe(
      catchError((err) => {
        this.isLoading.set(false);
        this.busyCode.set(null);
        this.loadFailed.set(moduleErrorMessage(err, 'Les modules n’ont pas pu être chargés.'));
        return EMPTY;
      }),
    ).subscribe((result) => {
      const modules = result.modules ?? [];
      this.modules.set(modules);
      // La page lit le registre lui-même : elle remet à jour les écrans que le menu et les gardes
      // ouvrent ou ferment, sans attendre le prochain chargement du profil.
      this._tenantModules.sync(
        modules.filter((m) => m.state === 'Active').map((m) => m.code!),
        // Même règle que le registre : désactivé un jour et pas réactivé — une nouvelle demande
        // en attente ne retire pas la consultation.
        modules
          .filter((m) => m.state !== 'Active' && (m.history ?? []).some((h) => h.status === 'Deactivated'))
          .map((m) => m.code!),
      );
      this.loadFailed.set(null);
      this.isLoading.set(false);
      this.busyCode.set(null);
    });
  }
}

export default TenantModulesPage;
