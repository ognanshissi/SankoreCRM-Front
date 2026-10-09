import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { ConnectionListDto, MappingDto, UnmappedCodesResponse } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSwitch } from '@talisoft/ui/switch';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY, firstValueFrom, forkJoin, Observable, of, Subject, switchMap } from 'rxjs';
import {
  downloadMappingCsv,
  MappingImportDrawer,
  MappingImportDrawerData,
} from '../../components/mapping-import-drawer';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  CONNECTION_KIND_LABELS,
  ConnectionKind,
  MAPPING_DOMAINS,
  MappingDomain,
  unmappedAvailabilityMeta,
} from '../../data-access/integration-referential';

/**
 * Une ligne du tableau d'un domaine. `isMapped` distingue une correspondance
 * existante d'un code CRM que `unmapped` signale comme sans correspondance : les deux
 * vivent dans la même collection, sinon l'administrateur ne voit pas ce qu'il lui
 * reste à renseigner.
 *
 * Déclaré en `type` et non en `interface` : `TasTable<T extends TableEntity>` exige une
 * signature d'index, que TypeScript n'accorde implicitement qu'aux alias de type.
 */
export type MappingRow = {
  crmCode: string;
  label: string;
  externalCode: string;
  isMapped: boolean;
};

class MappingRowFormModel {
  public label!: string;
  public externalCode!: string;

  public static instantiate(): MappingRowFormModel {
    const model = new MappingRowFormModel();
    model.label = '';
    model.externalCode = '';
    return model;
  }

  public static fromRow(row: MappingRow): MappingRowFormModel {
    const model = new MappingRowFormModel();
    model.label = row.label;
    model.externalCode = row.externalCode;
    return model;
  }
}

@Component({
  selector: 'integration-mappings-page',
  templateUrl: './mappings-page.html',
  imports: [
    FormsModule,
    FormField,
    TasAlert,
    Button,
    TasCard,
    TasError,
    TasFormField,
    TasIcon,
    TasInput,
    TasLabel,
    TasSelect,
    TasSwitch,
    TasTable,
    TasTag,
  ],
})
export class MappingsPage implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  public readonly canManage = this._permissions.can('Integration.Mapping.Manage');

  public readonly domains = MAPPING_DOMAINS;

  // ——— Connexions ———

  public readonly isLoadingConnections = signal(true);
  public readonly connections = signal<ConnectionListDto[]>([]);
  public readonly selectedConnectionId = signal<string | null>(null);

  public readonly connectionOptions = computed(() =>
    this.connections().map((connection) => {
      const kindLabel =
        CONNECTION_KIND_LABELS[String(connection.kind) as ConnectionKind] ?? String(connection.kind);
      return {
        label: `${connection.name ?? 'Connexion sans nom'} (${kindLabel})`,
        value: connection.id ?? '',
      };
    }),
  );

  // ——— Correspondances ———

  public readonly isLoading = signal(false);
  /**
   * Le contrat répond 404 pour une connexion inconnue COMME pour celle d'un autre
   * tenant, jamais 403, afin que la réponse ne serve pas à sonder les connexions des
   * autres. Ce n'est donc pas un problème de droits : on l'affiche comme « cette
   * connexion n'existe pas, ou plus ».
   */
  public readonly connectionMissing = signal(false);
  public readonly mappingsByDomain = signal<Partial<Record<MappingDomain, MappingDto[]>>>({});
  public readonly unmappedByDomain = signal<
    Partial<Record<MappingDomain, UnmappedCodesResponse | null>>
  >({});

  public readonly activeDomain = signal<MappingDomain>(MAPPING_DOMAINS[0].value);
  public readonly missingOnly = signal(false);

  /**
   * `listMappings` n'est pas paginé — « a correspondence table is a closed list
   * maintained by hand » : on reçoit la collection entière, donc la pagination est
   * locale et `(pageEventChange)` n'aurait rien à émettre.
   */
  public readonly tableConfig = signal<TableConfig>({
    property: 'crmCode',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 25,
      pageSizeOptions: [25, 50, 100],
    },
  });

  // ——— Édition en place ———

  /**
   * Le code CRM de la ligne ouverte en édition. Une seule à la fois : deux lignes
   * ouvertes en même temps invitent à perdre une saisie.
   */
  public readonly editingCrmCode = signal<string | null>(null);

  public readonly rowModel = signal(MappingRowFormModel.instantiate());

  public readonly rowForm = form(this.rowModel, (schema) => {
    required(schema.externalCode, { message: 'Le code externe est obligatoire' });
  });

  private readonly _load$ = new Subject<void>();

  // ——— Dérivés d'affichage ———

  public readonly currentDomainMeta = computed(
    () => MAPPING_DOMAINS.find((domain) => domain.value === this.activeDomain()) ?? MAPPING_DOMAINS[0],
  );

  public readonly currentUnmapped = computed(
    () => this.unmappedByDomain()[this.activeDomain()] ?? null,
  );

  public readonly currentAvailability = computed(() =>
    unmappedAvailabilityMeta(this.currentUnmapped()?.availability),
  );

  /**
   * Motif du filtre désactivé, montré en `title` : un filtre « manquants uniquement »
   * qui renvoie une liste vide parce que rien n'a été mesuré ferait croire à une
   * absence de manques.
   */
  public readonly missingOnlyTitle = computed(() =>
    this.currentAvailability().isMeasured
      ? "N'afficher que les codes CRM sans correspondance"
      : "Filtre indisponible : la liste des codes CRM de ce domaine n'est pas mesurable, un filtre vide ne voudrait rien dire.",
  );

  /**
   * Le filtre n'est appliqué que si les manques ont été mesurés : un `missingOnly=true`
   * venu de l'URL sur un domaine non mesurable viderait le tableau et se lirait « aucun
   * manque », alors que rien n'a été compté.
   */
  public readonly isMissingOnlyApplied = computed(
    () => this.missingOnly() && this.currentAvailability().isMeasured,
  );

  /** Onglets avec leur compte de manquants, et le fait qu'il ait été mesuré ou non. */
  public readonly tabs = computed(() =>
    MAPPING_DOMAINS.map((domain) => {
      const unmapped = this.unmappedByDomain()[domain.value] ?? null;
      const meta = unmappedAvailabilityMeta(unmapped?.availability);
      return {
        value: domain.value,
        label: domain.label,
        isMeasured: meta.isMeasured,
        missingCount: (unmapped?.codes ?? []).length,
      };
    }),
  );

  /**
   * Les correspondances du domaine et les codes CRM sans correspondance, fusionnés et
   * triés sur le code CRM : c'est la liste de travail de l'écran.
   */
  public readonly rows = computed<MappingRow[]>(() => {
    const domain = this.activeDomain();
    const mapped = this.mappingsByDomain()[domain] ?? [];
    const mappedCodes = new Set(mapped.map((mapping) => mapping.crmCode ?? ''));

    const rows: MappingRow[] = mapped.map((mapping) => ({
      crmCode: mapping.crmCode ?? '',
      label: mapping.label ?? '',
      externalCode: mapping.externalCode ?? '',
      isMapped: true,
    }));

    for (const code of this.unmappedByDomain()[domain]?.codes ?? []) {
      // Un code peut figurer dans les deux réponses si une correspondance a été
      // ajoutée entre les deux appels : la clé du tableau est `crmCode`, un doublon
      // déclencherait NG0955.
      if (!code.crmCode || mappedCodes.has(code.crmCode)) continue;
      rows.push({
        crmCode: code.crmCode,
        label: code.label ?? '',
        externalCode: '',
        isMapped: false,
      });
    }

    rows.sort((a, b) => a.crmCode.localeCompare(b.crmCode, 'fr'));

    // Le filtre n'est appliqué que si les manques ont été mesurés : un `missingOnly=true`
    // venu de l'URL sur un domaine non mesurable viderait le tableau et se lirait
    // « aucun manque », alors que rien n'a été compté.
    return this.isMissingOnlyApplied() ? rows.filter((row) => !row.isMapped) : rows;
  });

  public readonly hasRows = computed(() => this.rows().length > 0);

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: 'Correspondances de codes' },
    ]);

    this._restoreFromUrl();
    this._setupLoader();
    this._loadConnections();

    if (this.selectedConnectionId()) this._load$.next();
  }

  // ——— Sélection ———

  public onConnectionChange(connectionId: string | null): void {
    this.selectedConnectionId.set(connectionId || null);
    this.editingCrmCode.set(null);
    this.mappingsByDomain.set({});
    this.unmappedByDomain.set({});
    this.connectionMissing.set(false);
    this._persistUrl();
    if (connectionId) this._load$.next();
  }

  public selectTab(domain: MappingDomain): void {
    if (domain === this.activeDomain()) return;
    this.activeDomain.set(domain);
    // Changer d'onglet ferme l'édition en cours : la ligne ouverte appartient au
    // domaine qu'on quitte.
    this.editingCrmCode.set(null);
    this._persistUrl();
  }

  public onTabKeydown(event: KeyboardEvent): void {
    const current = MAPPING_DOMAINS.findIndex((domain) => domain.value === this.activeDomain());
    let next: number;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % MAPPING_DOMAINS.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + MAPPING_DOMAINS.length) % MAPPING_DOMAINS.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = MAPPING_DOMAINS.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.selectTab(MAPPING_DOMAINS[next].value);
    this._tabButtons()[next]?.nativeElement.focus();
  }

  public onMissingOnlyChange(value: boolean): void {
    this.missingOnly.set(value);
    this._persistUrl();
  }

  public refresh(): void {
    if (this.selectedConnectionId()) this._load$.next();
  }

  // ——— Édition en place ———

  public startEdit(row: MappingRow): void {
    // Le modèle du formulaire est repoussé à chaque ouverture : un seul `form()` sert
    // toutes les lignes, puisqu'une seule est éditable à la fois.
    this.rowModel.set(MappingRowFormModel.fromRow(row));
    this.editingCrmCode.set(row.crmCode);
  }

  public cancelEdit(): void {
    this.editingCrmCode.set(null);
  }

  public saveRow(row: MappingRow): void {
    const connectionId = this.selectedConnectionId();
    if (!connectionId) return;
    const domain = this.activeDomain();

    submit(this.rowForm, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const response = await firstValueFrom(
        this._facade
          .upsertMapping(
            connectionId,
            domain,
            row.crmCode,
            value.externalCode.trim(),
            value.label.trim() || null,
          )
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                integrationErrorMessage(err, "Impossible d'enregistrer la correspondance."),
              );
              return EMPTY;
            }),
          ),
      );

      if (!response) return;

      // `created` vient de la réponse : dire « ajoutée » sur une mise à jour laisse
      // croire qu'une seconde ligne a été créée pour le même code CRM.
      this._snackbar.success(
        response.created ? 'Correspondance ajoutée' : 'Correspondance mise à jour',
        `${row.crmCode} → ${value.externalCode.trim()}`,
      );
      this.editingCrmCode.set(null);
      this._load$.next();
    });
  }

  public confirmDelete(row: MappingRow): void {
    const connectionId = this.selectedConnectionId();
    if (!connectionId) return;

    this._confirm.confirm({
      title: 'Supprimer cette correspondance ?',
      message: `Le code ${row.crmCode} n'aura plus de correspondance : les prochaines demandes qui le portent seront refusées par le système externe jusqu'à ce qu'une correspondance soit renseignée.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer la correspondance', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._delete(connectionId, this.activeDomain(), row.crmCode),
    });
  }

  // ——— Import / export ———

  public exportCsv(): void {
    const connectionId = this.selectedConnectionId();
    if (!connectionId) return;
    const domain = this.activeDomain();

    this._facade
      .exportMappings(connectionId, domain)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, "L'export des correspondances a échoué."),
          );
          return EMPTY;
        }),
      )
      .subscribe((csv) => {
        downloadMappingCsv(csv, domain);
        this._snackbar.success('Export prêt', 'Le fichier a été téléchargé.');
      });
  }

  public openImportDrawer(): void {
    const connectionId = this.selectedConnectionId();
    if (!connectionId) return;

    const ref = this._sideDrawer.open(MappingImportDrawer, {
      data: {
        connectionId,
        domain: this.activeDomain(),
        domainLabel: this.currentDomainMeta().label,
        crmLabel: this.currentDomainMeta().crmLabel,
      } satisfies MappingImportDrawerData,
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((imported) => {
      if (imported) this._load$.next();
    });
  }

  // ——— Interne ———

  private _delete(connectionId: string, domain: MappingDomain, crmCode: string): void {
    this._facade
      .deleteMapping(connectionId, domain, crmCode)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, 'Impossible de supprimer la correspondance.'),
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success('Correspondance supprimée', `${crmCode} n'a plus de correspondance.`);
        if (this.editingCrmCode() === crmCode) this.editingCrmCode.set(null);
        this._load$.next();
      });
  }

  private _loadConnections(): void {
    this._facade
      .listAllConnections()
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isLoadingConnections.set(false);
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, 'Impossible de charger les connexions.'),
          );
          return EMPTY;
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((connections) => {
        this.connections.set(connections);
        this.isLoadingConnections.set(false);
      });
  }

  private _setupLoader(): void {
    this._load$
      .pipe(
        switchMap(() => {
          const connectionId = this.selectedConnectionId();
          if (!connectionId) return EMPTY;

          this.isLoading.set(true);
          this.connectionMissing.set(false);

          return forkJoin({
            // Un seul appel pour les huit domaines : `listMappings` sans filtre
            // `domain` renvoie toute la table, ordonnée par domaine puis code CRM. On
            // groupe ensuite côté client plutôt que de faire huit appels filtrés.
            mappings: this._facade.listMappings(connectionId).pipe(
              catchError((err: HttpErrorResponse) => {
                if (err.status === 404) {
                  this.connectionMissing.set(true);
                } else {
                  this._snackbar.error(
                    'Erreur',
                    integrationErrorMessage(err, 'Impossible de charger les correspondances.'),
                  );
                }
                return of(null);
              }),
            ),
            unmapped: this._unmappedForAllDomains(connectionId),
          });
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(({ mappings, unmapped }) => {
        this.mappingsByDomain.set(this._groupByDomain(mappings?.items ?? []));
        this.unmappedByDomain.set(unmapped);
        this.isLoading.set(false);
      });
  }

  private _unmappedForAllDomains(
    connectionId: string,
  ): Observable<Partial<Record<MappingDomain, UnmappedCodesResponse | null>>> {
    const calls: Partial<Record<MappingDomain, Observable<UnmappedCodesResponse | null>>> = {};

    for (const domain of MAPPING_DOMAINS) {
      // L'échec d'un domaine ne doit pas vider les sept autres : son onglet affichera
      // « indéterminé », ce qui est exact, plutôt qu'un zéro rassurant.
      calls[domain.value] = this._facade
        .listUnmappedCodes(connectionId, domain.value)
        .pipe(catchError(() => of(null)));
    }

    return forkJoin(calls as Record<MappingDomain, Observable<UnmappedCodesResponse | null>>);
  }

  private _groupByDomain(items: MappingDto[]): Partial<Record<MappingDomain, MappingDto[]>> {
    const grouped: Partial<Record<MappingDomain, MappingDto[]>> = {};

    for (const domain of MAPPING_DOMAINS) grouped[domain.value] = [];
    for (const item of items) {
      const domain = item.domain as MappingDomain | null | undefined;
      if (!domain || !grouped[domain]) continue;
      grouped[domain].push(item);
    }

    return grouped;
  }

  private _restoreFromUrl(): void {
    const params = this._route.snapshot.queryParams;

    if (params['connectionId']) this.selectedConnectionId.set(params['connectionId']);

    const domain = MAPPING_DOMAINS.find((candidate) => candidate.value === params['domain']);
    if (domain) this.activeDomain.set(domain.value);

    this.missingOnly.set(params['missingOnly'] === 'true');
  }

  /** L'URL porte la vue entière : un lien envoyé à un collègue rouvre le même onglet. */
  private _persistUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        connectionId: this.selectedConnectionId() || null,
        domain: this.activeDomain(),
        missingOnly: this.missingOnly() ? 'true' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

export default MappingsPage;
