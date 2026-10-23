import { computed, inject, Injectable, linkedSignal, Signal } from '@angular/core';
import { AuthenticationService } from './authentification.service';
import { TENANT_MODULES, TenantModule } from '../models/tenant-modules';

const ALL_MODULES: readonly string[] = Object.values(TENANT_MODULES);

/**
 * Modules payants actifs pour l'institution de l'utilisateur connecté.
 *
 * La liste vient de `GET users/auth-context`. Absente — API antérieure aux modules, profil pas
 * encore chargé — elle se lit comme « tous les modules », comme côté serveur : dans le doute, un
 * tenant garde ce qu'il a. Vide, c'est le socle seul.
 */
@Injectable({ providedIn: 'root' })
export class TenantModulesService {
  private readonly _auth = inject(AuthenticationService);

  /**
   * Recalé sur le profil à chaque rechargement, et poussé par la page « Modules » après une
   * désactivation : recharger le profil viderait `connectedUser` le temps de la requête, et avec
   * lui le menu et toutes les permissions de l'écran.
   */
  private readonly _list = linkedSignal<readonly string[] | null>(
    () => this._auth.connectedUser()?.activeModules ?? null,
  );

  public readonly active = computed<ReadonlySet<string>>(() => new Set(this._list() ?? ALL_MODULES));

  /** Modules désactivés par l'institution : leurs écrans restent ouverts en consultation seule. */
  private readonly _readOnlyList = linkedSignal<readonly string[]>(
    () => this._auth.connectedUser()?.readOnlyModules ?? [],
  );

  /** Ce qu'on peut CONSULTER : les modules actifs et les modules désactivés. */
  public readonly readable = computed<ReadonlySet<string>>(
    () => new Set([...this.active(), ...this._readOnlyList()]),
  );

  /** Vrai si AU MOINS un des modules est actif. */
  public has(...anyOf: TenantModule[]): boolean {
    const active = this.active();
    return anyOf.some((m) => active.has(m));
  }

  /** Variante en signal, à stocker dans un champ du composant. */
  public can(...anyOf: TenantModule[]): Signal<boolean> {
    return computed(() => this.has(...anyOf));
  }

  /** Vrai si AU MOINS un des modules est consultable (actif ou désactivé). */
  public canRead(...anyOf: TenantModule[]): boolean {
    const readable = this.readable();
    return anyOf.some((m) => readable.has(m));
  }

  /**
   * Signal vrai quand l'écran se consulte sans pouvoir agir : lisible, mais aucun des modules
   * n'est actif. Les boutons d'action s'y masquent ; le serveur refuserait de toute façon.
   */
  public readOnly(...anyOf: TenantModule[]): Signal<boolean> {
    return computed(() => !this.has(...anyOf) && this.canRead(...anyOf));
  }

  /** Remplace les listes par celles que le registre vient de renvoyer. */
  public sync(activeModules: readonly string[], readOnlyModules: readonly string[] = []): void {
    this._list.set([...activeModules]);
    this._readOnlyList.set([...readOnlyModules]);
  }
}
