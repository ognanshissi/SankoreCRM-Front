import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import {
  AgenciesApiService,
  CompanyInfoApiService,
  DispatchingRulesApiService,
  IntegrationApiService,
  ProductsApiService,
  RolesApiService,
  TerritoriesApiService,
  UsersApiService,
  WorkflowTemplatesApiService,
} from '@sankore/crm-api';
import { PermissionCode, PermissionsService } from '@sankore/crm/common';

export type StatusTone = 'ok' | 'warn' | 'neutral';

export interface EntryStatus {
  label: string;
  tone: StatusTone;
}

export interface SetupStep {
  title: string;
  detail: string;
  done: boolean;
  link: string;
}

export interface SettingsOverviewStatus {
  /** Par identifiant d'entrée du catalogue. Une entrée absente n'affiche pas de statut. */
  entries: Record<string, EntryStatus>;
  /** Seulement les étapes que l'utilisateur peut constater : une lecture refusée retire l'étape. */
  setup: SetupStep[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/**
 * Les lignes d'état de l'accueil du paramétrage (« 3 agences », « Aucun territoire défini »…) et
 * la mise en service.
 *
 * Chaque chiffre est LU, jamais supposé : une lecture que l'utilisateur n'a pas le droit de faire
 * n'est pas lancée, et une lecture qui échoue retire la ligne au lieu d'afficher un zéro — un
 * « Aucune agence » dû à une panne enverrait un administrateur recréer ce qui existe.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStatusService {
  private readonly _permissions = inject(PermissionsService);
  private readonly _agencies = inject(AgenciesApiService);
  private readonly _territories = inject(TerritoriesApiService);
  private readonly _users = inject(UsersApiService);
  private readonly _roles = inject(RolesApiService);
  private readonly _workflows = inject(WorkflowTemplatesApiService);
  private readonly _dispatch = inject(DispatchingRulesApiService);
  private readonly _products = inject(ProductsApiService);
  private readonly _integration = inject(IntegrationApiService);
  private readonly _company = inject(CompanyInfoApiService);

  public load(): Observable<SettingsOverviewStatus> {
    return forkJoin({
      agencies: this._read('agency:read', () =>
        this._agencies.listAgencies(false, 1, 1).pipe(map((r) => r.totalCount ?? (r.items ?? []).length)),
      ),
      territories: this._read('territory:read', () =>
        this._territories.listTerritories(false).pipe(map((r) => r.length)),
      ),
      users: this._read('user:read', () => this._users.getUserStatusStats()),
      roles: this._read('role:read', () => this._roles.listRoles().pipe(map((r) => r.length))),
      workflows: this._read('workflow:read', () =>
        this._workflows.listWorkflowTemplates(true).pipe(map((r) => r.length)),
      ),
      dispatch: this._read('lead:dispatching-rule:read', () =>
        this._dispatch.listDispatchingRules(true).pipe(map((r) => r.length)),
      ),
      products: this._read('product:read', () => this._products.listProducts(true).pipe(map((r) => r.length))),
      connections: this._read('Integration.Connection.View', () =>
        this._integration.listIntegrationConnections(undefined, true, 1, 200).pipe(map((r) => r.items ?? [])),
      ),
      company: this._read('company:read', () => this._company.getCompanyInfo()),
    }).pipe(
      map((r) => {
        const entries: Record<string, EntryStatus> = {};
        const setup: SetupStep[] = [];

        if (r.company) {
          const complete = !!r.company.name?.trim() && !!r.company.logoUrl?.trim() && r.company.logoUrl !== 'default.png';
          entries['company'] = complete ? { label: 'Complet', tone: 'ok' } : { label: 'Logo manquant', tone: 'warn' };
          setup.push({ title: 'Institution', detail: 'Nom, logo, langue', done: complete, link: '/settings/company' });
        }

        if (r.agencies !== null) {
          entries['agencies'] = r.agencies > 0
            ? { label: plural(r.agencies, 'agence', 'agences'), tone: 'ok' }
            : { label: 'Aucune agence', tone: 'warn' };
          setup.push({
            title: 'Agences',
            detail: r.agencies > 0 ? `${plural(r.agencies, 'agence créée', 'agences créées')}` : 'Aucune agence créée',
            done: r.agencies > 0,
            link: '/settings/agencies',
          });
        }

        if (r.territories !== null) {
          entries['territories'] = r.territories > 0
            ? { label: plural(r.territories, 'territoire', 'territoires'), tone: 'ok' }
            : { label: 'Aucun territoire défini', tone: 'warn' };
        }

        if (r.users) {
          const total = r.users.total ?? 0;
          const active = r.users.active ?? 0;
          const pending = r.users.pendingActivation ?? 0;
          entries['users'] = {
            label: `${plural(total, 'membre', 'membres')} · ${plural(active, 'actif', 'actifs')}`,
            tone: pending > 0 ? 'warn' : 'ok',
          };
          // L'équipe est prête quand personne n'attend plus son invitation : un compte en attente
          // est quelqu'un qui ne reçoit aucun lead.
          setup.push({
            title: 'Équipe',
            detail: `${plural(active, 'membre actif', 'membres actifs')} sur ${total}`,
            done: active > 1 && pending === 0,
            link: '/settings/users',
          });
        }

        if (r.roles !== null) entries['roles'] = { label: plural(r.roles, 'rôle', 'rôles'), tone: 'ok' };

        if (r.workflows !== null) {
          entries['workflows'] = r.workflows > 0
            ? { label: plural(r.workflows, 'workflow actif', 'workflows actifs'), tone: 'ok' }
            : { label: 'Aucun workflow actif', tone: 'neutral' };
        }

        if (r.dispatch !== null) {
          entries['dispatch'] = r.dispatch > 0
            ? { label: plural(r.dispatch, 'stratégie active', 'stratégies actives'), tone: 'ok' }
            : { label: 'Aucune stratégie active', tone: 'warn' };
          setup.push({
            title: 'Affectation des leads',
            detail: r.dispatch > 0 ? plural(r.dispatch, 'stratégie active', 'stratégies actives') : 'Aucune stratégie active',
            done: r.dispatch > 0,
            link: '/settings/dispatch-rules',
          });
        }

        if (r.products !== null) {
          entries['products'] = r.products > 0
            ? { label: plural(r.products, 'produit actif', 'produits actifs'), tone: 'ok' }
            : { label: 'Aucun produit actif', tone: 'warn' };
        }

        if (r.connections) {
          // `Fake` est le simulateur de recette : il prouve que le circuit marche, pas que
          // l'institution est reliée à son vrai système.
          const production = r.connections.filter((c) => c.kind !== 'Fake');
          const simulators = r.connections.length - production.length;
          entries['connections'] = production.length > 0
            ? { label: plural(production.length, 'connexion en production', 'connexions en production'), tone: 'ok' }
            : { label: simulators > 0 ? 'Seul le simulateur est actif' : 'Aucune connexion active', tone: 'warn' };

          const coreBanking = production.filter((c) => c.family === 'CoreBanking').length;
          const coreSimulator = r.connections.some((c) => c.family === 'CoreBanking' && c.kind === 'Fake');
          setup.push({
            title: 'Core banking',
            detail: coreBanking > 0 ? 'Connecté en production' : coreSimulator ? 'Seul le simulateur est actif' : 'Aucune connexion',
            done: coreBanking > 0,
            link: '/settings/integrations/connections',
          });
        }

        return { entries, setup };
      }),
    );
  }

  /** `null` quand la lecture n'est pas permise ou a échoué : l'appelant n'affiche alors rien. */
  private _read<T>(permission: PermissionCode, call: () => Observable<T>): Observable<T | null> {
    if (!this._permissions.has(permission)) return of(null);
    return call().pipe(catchError(() => of(null)));
  }
}
