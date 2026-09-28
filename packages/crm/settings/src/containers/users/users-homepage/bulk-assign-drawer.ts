import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField, FormRoot, form, required, submit } from '@angular/forms/signals';
import { EMPTY, catchError, firstValueFrom, of } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  AgenciesApiService,
  AgencyDto,
  BulkAssignResult,
  RoleDto,
  RolesApiService,
  UsersApiService,
} from '@sankore/crm-api';

/**
 * Plafond du contrat : « At most 200 users per request » sur les deux endpoints
 * `POST /api/v1/users/bulk/{agency,role}`.
 */
export const BULK_ASSIGN_MAX_USERS = 200;

export type BulkAssignMode = 'agency' | 'role';

/** Un utilisateur sélectionné, réduit à ce qui sert ici. */
export interface BulkAssignTargetUser {
  id: string;
  fullName: string;
  email: string;
  /** Agence courante : sert à annoncer les doublons avant l'appel. */
  agencyId: string | null;
  /** Rôles courants, tels que `UserDto.roles` les renvoie (noms, pas identifiants). */
  roles: string[];
}

export interface BulkAssignDrawerData {
  mode: BulkAssignMode;
  /**
   * Les utilisateurs sélectionnés au complet, et pas seulement leurs
   * identifiants : `BulkUserOutcome` ne renvoie qu'un `userId`, et le compte
   * rendu doit nommer chaque utilisateur ignoré.
   */
  users: BulkAssignTargetUser[];
}

/** Une ligne du compte rendu : un utilisateur ignoré et le motif du serveur. */
interface SkippedRow {
  name: string;
  email: string;
  reason: string;
}

class BulkAssignFormModel {
  public targetId!: string;

  public static instantiate(): BulkAssignFormModel {
    const model = new BulkAssignFormModel();
    model.targetId = '';
    return model;
  }
}

@Component({
  selector: 'bulk-assign-drawer',
  templateUrl: './bulk-assign-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasHint,
    TasSelect,
    TasSpinner,
    TasIcon,
    FormRoot,
    FormField,
  ],
})
export class BulkAssignDrawer {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly data = inject<BulkAssignDrawerData>(DIALOG_DATA);

  public readonly isAgencyMode = this.data.mode === 'agency';

  public isLoadingOptions = signal(true);
  public options = signal<{ label: string; value: string }[]>([]);

  /** Compte rendu du serveur ; tant qu'il est `null`, le drawer affiche le formulaire. */
  public report = signal<BulkAssignResult | null>(null);

  private readonly _agencies = signal<AgencyDto[]>([]);
  private readonly _roles = signal<RoleDto[]>([]);

  public model = signal(BulkAssignFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.targetId, {
      message: this.isAgencyMode ? "Choisissez l'agence de destination" : 'Choisissez le rôle à attribuer',
    });
  });

  /** Nom affichable par identifiant : `BulkUserOutcome` ne renvoie que le GUID. */
  private readonly _usersById = computed(
    () => new Map(this.data.users.map((user) => [user.id, user])),
  );

  public readonly selectedCount = this.data.users.length;

  /**
   * Utilisateurs que le serveur ignorera très probablement, repérés avant
   * l'appel avec ce qu'affiche déjà la liste. **Déduit** : le contrat annonce
   * « already belongs to that agency » / « already holds the role » parmi ses
   * motifs d'exclusion, on l'annonce donc à l'avance plutôt que de laisser
   * l'opérateur découvrir après coup des lignes ignorées. Le serveur garde le
   * dernier mot — cet aperçu n'empêche jamais l'envoi.
   */
  public readonly alreadyAssignedCount = computed(() => {
    const targetId = this.model().targetId;
    if (!targetId) return 0;

    if (this.isAgencyMode) {
      return this.data.users.filter((user) => user.agencyId === targetId).length;
    }

    // `UserDto.roles` contient des noms de rôle et la requête attend un
    // `roleId` : on repasse par le `RoleDto` pour comparer. `name` et `label`
    // sont tous deux testés, le contrat ne disant pas lequel des deux alimente
    // `UserDto.roles`.
    const role = this._roles().find((candidate) => candidate.id === targetId);
    if (!role) return 0;
    const names = [role.name, role.label].filter((name): name is string => !!name);
    return this.data.users.filter((user) => user.roles.some((held) => names.includes(held)))
      .length;
  });

  public readonly appliedCount = computed(() => this.report()?.applied ?? 0);
  public readonly requestedCount = computed(() => this.report()?.requested ?? 0);
  public readonly skippedCount = computed(() => this.report()?.skipped ?? 0);

  /** Les utilisateurs ignorés, nommés, avec le motif renvoyé pour chacun. */
  public readonly skippedRows = computed<SkippedRow[]>(() =>
    (this.report()?.outcomes ?? [])
      .filter((outcome) => !outcome.applied)
      .map((outcome) => {
        const user = outcome.userId ? this._usersById().get(outcome.userId) : undefined;
        return {
          name: user?.fullName || 'Utilisateur inconnu',
          email: user?.email ?? '',
          reason: outcome.reason?.trim() || 'Motif non précisé par le serveur',
        };
      }),
  );

  constructor() {
    this._loadOptions();
  }

  public handleSubmit(): void {
    // Garde de réentrance en première ligne : un double clic, ou la touche
    // Entrée pendant que l'appel est en vol, renverrait la même affectation en
    // masse une seconde fois. Une fois le compte rendu affiché, le formulaire
    // n'est plus soumissible non plus.
    if (this.formSchema().submitting() || this.report()) return;

    submit(this.formSchema, async (field) => {
      const targetId = field()?.value().targetId;
      if (!targetId) return;

      const userIds = this.data.users.map((user) => user.id);
      if (userIds.length > BULK_ASSIGN_MAX_USERS) {
        this._snackbarService.error(
          'Sélection trop large',
          `Le serveur traite au plus ${BULK_ASSIGN_MAX_USERS} utilisateurs par envoi.`,
        );
        return;
      }

      const request$ = this.isAgencyMode
        ? this._usersApiService.bulkAssignUsersToAgency({ userIds, agencyId: targetId })
        : this._usersApiService.bulkAssignRoleToUsers({ userIds, roleId: targetId });

      const result = await firstValueFrom(
        request$.pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbarService.error(
              'Affectation refusée',
              err.error?.detail ??
                err.error?.title ??
                (this.isAgencyMode
                  ? "Impossible d'affecter la sélection à cette agence."
                  : "Impossible d'attribuer ce rôle à la sélection."),
            );
            // `of(null)` et non `EMPTY` : `firstValueFrom` rejetterait sur un
            // flux vide (EmptyError), et l'échec remonterait en promesse non
            // gérée au lieu d'être déjà signalé à l'opérateur.
            return of(null);
          }),
        ),
      );

      if (!result) return;

      this.report.set(result);

      const applied = result.applied ?? 0;
      const requested = result.requested ?? this.data.users.length;
      const skipped = result.skipped ?? 0;

      if (skipped === 0) {
        this._snackbarService.success(
          'Affectation effectuée',
          `${applied} utilisateur(s) sur ${requested}.`,
        );
      } else {
        // `SnackbarService` n'expose pas de `warning` : un compte rendu partiel
        // passe donc par `info`, l'écran détaillant les lignes ignorées.
        this._snackbarService.info(
          'Affectation partielle',
          `${applied} sur ${requested} affecté(s), ${skipped} ignoré(s).`,
        );
      }
    });
  }

  public close(): void {
    this._dialogRef.close(this.report() !== null);
  }

  private _loadOptions(): void {
    this.isLoadingOptions.set(true);

    if (this.isAgencyMode) {
      this._agenciesApiService
        // Attention à l'ordre des paramètres du client généré :
        // `listAgencies(includeDeleted, page, pageSize, parentId?, search?)`,
        // qui ne suit pas l'ordre déclaré dans le swagger. `pageSize = 0`
        // renvoie toutes les agences (cf. description de l'endpoint).
        .listAgencies(false, 1, 0)
        .pipe(
          takeUntilDestroyed(this._destroyRef),
          catchError(() => {
            this._snackbarService.error('Erreur', 'Impossible de charger les agences.');
            this.isLoadingOptions.set(false);
            return EMPTY;
          }),
        )
        .subscribe((result) => {
          const agencies = result.items ?? [];
          this._agencies.set(agencies);
          this.options.set(
            agencies.map((agency) => ({
              // Une agence désactivée reste proposée — le contrat ne l'exclut
              // pas — mais son état est dit dans le libellé.
              label: `${agency.name ?? agency.code ?? '—'}${agency.isActive === false ? ' (désactivée)' : ''}`,
              value: agency.id ?? '',
            })),
          );
          this.isLoadingOptions.set(false);
        });
      return;
    }

    this._rolesApiService
      .listRoles()
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this._snackbarService.error('Erreur', 'Impossible de charger les rôles.');
          this.isLoadingOptions.set(false);
          return EMPTY;
        }),
      )
      .subscribe((roles) => {
        this._roles.set(roles);
        this.options.set(
          roles
            // **Déduit** : le contrat ne cite pas l'assignabilité parmi ses
            // motifs d'exclusion, mais `RoleDto.isAssignable` existe et
            // proposer un rôle non assignable exposerait à un refus global.
            .filter((role) => role.isAssignable !== false)
            .map((role) => ({
              label: role.label ?? role.name ?? '—',
              value: role.id ?? '',
            })),
        );
        this.isLoadingOptions.set(false);
      });
  }
}
