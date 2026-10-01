import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { KYCSettingsApiService, UsersApiService } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { KycSettingRow, toKycSettingRow } from './kyc-settings.model';
import { EditKycSettingDrawer, EditKycSettingDrawerData } from './edit-kyc-setting-drawer';

/**
 * Paramètres KYC du tenant (`GET /kyc-settings`, `PUT /kyc-settings/{key}`).
 *
 * **L'écran ne connaît aucune clé.** Le contrat ne déclare pas la liste des paramètres : il renvoie
 * « tout paramètre M02 déclaré », avec son type, sa description, sa valeur d'usine et un drapeau
 * `isDefault`. Écrire ici une liste de clés attendues — ne serait-ce que pour les grouper ou les
 * traduire — ferait disparaître de l'écran le paramètre que le backend ajouterait demain, sans que
 * personne s'en aperçoive. Tout est donc rendu à partir de la réponse, et un type inattendu retombe
 * sur une saisie texte au lieu de masquer la ligne.
 *
 * Conséquence assumée : les libellés affichés sont la **clé** et la **description du serveur**, pas
 * une traduction française. Le jour où la liste des clés sera stable et documentée, un référentiel
 * de libellés aura un sens ; l'inventer avant reviendrait à afficher un nom inventé à côté d'une
 * valeur qui gouverne la conformité.
 */
@Component({
  selector: 'kyc-settings',
  templateUrl: './kyc-settings.html',
  imports: [DatePipe, Button, TasIcon, TasTag, TasTable],
})
export class KycSettingsPage implements OnInit {
  private readonly _settingsApi = inject(KYCSettingsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);

  /** Lire demande `kyc:read`, écrire `kyc:settings:manage` : ce sont deux droits distincts. */
  public readonly canManage = this._permissions.can('kyc:settings:manage');

  public isLoading = signal(true);
  /**
   * Séparé de l'état vide à dessein : « aucun paramètre » et « le chargement a échoué » n'appellent
   * pas la même réaction, et confondre les deux ferait conclure qu'il n'y a rien à régler.
   */
  public loadError = signal<string | null>(null);
  public resettingKey = signal<string | null>(null);

  public readonly settings = signal<KycSettingRow[]>([]);
  public searchQuery = signal('');

  /** Noms des auteurs, résolus une fois par identifiant : la liste répète les mêmes. */
  private readonly _authorNames = signal<Record<string, string>>({});
  private readonly _resolvingAuthors = new Set<string>();

  public readonly filteredSettings = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.settings();
    return this.settings().filter(
      (row) =>
        row.key.toLowerCase().includes(query) ||
        row.description.toLowerCase().includes(query),
    );
  });

  public readonly customisedCount = computed(
    () => this.settings().filter((row) => !row.isDefault).length,
  );

  public readonly isEmpty = computed(
    () => !this.isLoading() && !this.loadError() && this.settings().length === 0,
  );

  /** La liste tient en une réponse : pagination locale, comme les autres écrans de paramétrage. */
  public tableConfig = signal<TableConfig>({
    property: 'key',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Paramètres KYC' },
    ]);
    this._load();
  }

  public onSearchChange(query: string): void {
    this.searchQuery.set(query);
  }

  public reload(): void {
    this._load();
  }

  public authorLabel(row: KycSettingRow): string {
    if (!row.updatedBy) return 'Système';
    return this._authorNames()[row.updatedBy] ?? 'Utilisateur inconnu';
  }

  public openEdit(row: KycSettingRow): void {
    if (!this.canManage()) return;

    const data: EditKycSettingDrawerData = { setting: row };
    const ref = this._sideDrawerService.open<boolean, EditKycSettingDrawerData, EditKycSettingDrawer>(
      EditKycSettingDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );

    ref.closed.subscribe((saved) => {
      // Rechargement complet plutôt que mise à jour de la ligne : changer un plafond du palier
      // simplifié purge des valeurs côté serveur, et rien ne garantit que la seule ligne modifiée
      // soit la seule à avoir bougé.
      if (saved) this._load();
    });
  }

  /**
   * Retour à la valeur d'usine. Le contrat n'expose pas de suppression : on réécrit la valeur par
   * défaut que le serveur a lui-même renvoyée, ce qui est exactement ce que l'agent attend.
   */
  public confirmReset(row: KycSettingRow): void {
    if (!this.canManage() || row.isDefault) return;

    this._confirmDialogService.confirm({
      title: "Revenir à la valeur d'usine",
      message: `Le paramètre ${row.key} reprendra sa valeur d'usine (${row.displayDefaultValue}). La modification s'applique immédiatement à tout le tenant.`,
      closable: true,
      acceptButtonProps: { label: 'Réinitialiser', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._reset(row),
    });
  }

  private _reset(row: KycSettingRow): void {
    this.resettingKey.set(row.key);
    this._settingsApi
      .updateKycSetting(row.key, { value: row.defaultValue })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Réinitialisation refusée',
            error.error?.detail ?? "La valeur d'usine n'a pas pu être rétablie.",
          );
          this.resettingKey.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.resettingKey.set(null);
        this._snackbar.success(
          'Paramètre réinitialisé',
          `${row.key} a repris sa valeur d'usine.`,
        );
        this._load();
      });
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._settingsApi
      .listKycSettings()
      .pipe(
        catchError(() => {
          this.settings.set([]);
          this.loadError.set(
            "Les paramètres KYC n'ont pas pu être chargés. Réessayez dans un instant.",
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((items) => {
        const rows = (items ?? []).map((dto) => toKycSettingRow(dto));
        this.settings.set(rows);
        this.isLoading.set(false);
        this._resolveAuthors(rows);
      });
  }

  private _resolveAuthors(rows: KycSettingRow[]): void {
    const known = this._authorNames();
    const pending = new Set(
      rows
        .map((row) => row.updatedBy)
        .filter((id): id is string => !!id && !known[id] && !this._resolvingAuthors.has(id)),
    );

    for (const id of pending) {
      this._resolvingAuthors.add(id);
      this._usersApi
        .getUser(id)
        .pipe(catchError(() => of(null)))
        .subscribe((user) => {
          const name = user?.fullName || user?.email;
          if (name) this._authorNames.update((current) => ({ ...current, [id]: name }));
        });
    }
  }
}

export default KycSettingsPage;
