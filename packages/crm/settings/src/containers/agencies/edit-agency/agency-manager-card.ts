import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, of } from 'rxjs';
import { TasCard, TasCardHeader } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  AgenciesApiService,
  AssignAgencyManagerResult,
  UsersApiService,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';

export interface AgencyManagerChange {
  userId: string | null;
  fullName: string | null;
}

class AssignAgencyManagerFormModel {
  public managerUserId!: string;

  public static instantiate(): AssignAgencyManagerFormModel {
    const m = new AssignAgencyManagerFormModel();
    m.managerUserId = '';
    return m;
  }
}

/**
 * Section « Responsable » de la fiche agence.
 *
 * - PUT /api/v1/agencies/{id}/manager → `AssignAgencyManagerResult`
 * - DELETE /api/v1/agencies/{id}/manager → 204, idempotent
 *
 * Les deux actions exigent `agency:assign-manager`.
 */
@Component({
  selector: 'agency-manager-card',
  templateUrl: './agency-manager-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasCard,
    TasCardHeader,
    Button,
    TasIcon,
    TasTag,
    TasSpinner,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasSelect,
    FormRoot,
    FormField,
  ],
})
export class AgencyManagerCard {
  private readonly _permissions = inject(PermissionsService);
  public readonly canAssignManager = this._permissions.can(
    'agency:assign-manager',
  );

  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);

  public readonly agencyId = input.required<string>();
  public readonly managerUserId = input<string | null | undefined>(null);
  public readonly managerFullName = input<string | null | undefined>(null);

  public readonly managerChanged = output<AgencyManagerChange>();

  /**
   * Responsable affiché : initialisé sur l'entrée venant de la fiche, puis mis à
   * jour localement après une assignation ou un retrait pour que la carte reflète
   * l'action sans attendre un rechargement complet de l'agence.
   */
  public currentManagerUserId = linkedSignal(() => this.managerUserId() ?? null);
  public currentManagerFullName = linkedSignal(
    () => this.managerFullName() ?? null,
  );

  public isLoadingCandidates = signal(false);
  public isRemoving = signal(false);
  public candidates = signal<{ label: string; value: string }[]>([]);

  /**
   * Rôle que le serveur a accordé à l'utilisateur en le nommant responsable
   * (`AssignAgencyManagerResult.grantedRole`). C'est un effet de bord sur les
   * droits de l'utilisateur : il reste affiché dans la carte, et pas seulement
   * dans un toast qui disparaît, pour que l'administrateur le voie.
   */
  public grantedRoleNotice = signal<{ role: string; userFullName: string } | null>(
    null,
  );

  public readonly hasManager = computed(() => !!this.currentManagerUserId());

  public assignModel = signal(AssignAgencyManagerFormModel.instantiate());
  public assignFormSchema = form(this.assignModel, (schema) => {
    required(schema.managerUserId, {
      message: 'Sélectionnez un utilisateur à nommer responsable',
    });
  });

  constructor() {
    effect(() => {
      const id = this.agencyId();
      if (id) this._loadCandidates(id);
    });
  }

  public handleAssign(): void {
    submit(this.assignFormSchema, async (field) => {
      const userId = field()?.value()?.managerUserId;
      if (!userId) return;

      const result = await firstValueFrom(
        this._agenciesApiService
          .assignAgencyManager(this.agencyId(), { managerUserId: userId })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbarService.error('Erreur', this._describeAssignError(err));
              // `of(null)` et non `EMPTY` : `firstValueFrom` sur un flux vide
              // rejette avec une EmptyError, qui ferait échouer la soumission
              // après qu'on a déjà affiché le message d'erreur.
              return of<AssignAgencyManagerResult | null>(null);
            }),
          ),
      );

      if (!result) return;

      const fullName =
        result.managerFullName?.trim() ||
        this.candidates().find((c) => c.value === userId)?.label ||
        'Cet utilisateur';

      this.currentManagerUserId.set(result.managerUserId ?? userId);
      this.currentManagerFullName.set(result.managerFullName ?? fullName);
      this.assignModel.set(AssignAgencyManagerFormModel.instantiate());

      if (result.changed === false) {
        // Le contrat : « Re-sending the same manager succeeds without changing
        // anything. » Ce n'est pas un échec, ce n'est pas non plus un changement.
        this._snackbarService.info(
          'Aucun changement',
          `${fullName} était déjà responsable de cette agence.`,
        );
      } else {
        this._snackbarService.success(
          'Responsable désigné',
          `${fullName} est désormais responsable de cette agence.`,
        );
      }

      const grantedRole = result.grantedRole?.trim();
      if (grantedRole) {
        this.grantedRoleNotice.set({ role: grantedRole, userFullName: fullName });
        this._snackbarService.info(
          'Rôle accordé',
          `Le serveur a accordé le rôle « ${grantedRole} » à ${fullName} pour cette responsabilité.`,
        );
      } else {
        this.grantedRoleNotice.set(null);
      }

      this.managerChanged.emit({
        userId: result.managerUserId ?? userId,
        fullName: result.managerFullName ?? fullName,
      });

      // Le responsable sortant reste un utilisateur de l'agence : la liste des
      // candidats est rechargée pour que l'étiquette « responsable actuel » suive.
      this._loadCandidates(this.agencyId());
    });
  }

  public confirmRemove(): void {
    const fullName = this.currentManagerFullName()?.trim() || 'Le responsable';

    this._confirmDialogService.confirm({
      title: 'Retirer le responsable',
      message: `${fullName} ne sera plus responsable de cette agence, qui restera sans responsable jusqu'à une nouvelle désignation. Continuer ?`,
      closable: true,
      acceptButtonProps: { label: 'Retirer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._remove(fullName),
    });
  }

  private _remove(fullName: string): void {
    this.isRemoving.set(true);
    this._agenciesApiService
      .removeAgencyManager(this.agencyId())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbarService.error('Erreur', this._describeRemoveError(err));
          this.isRemoving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isRemoving.set(false);
        // L'endpoint est idempotent (« an agency with no manager stays that
        // way ») : un 204 est toujours un succès, même si l'agence n'avait déjà
        // plus de responsable. On ne présente donc jamais ce cas comme un échec.
        this.currentManagerUserId.set(null);
        this.currentManagerFullName.set(null);
        this.grantedRoleNotice.set(null);
        this._snackbarService.success(
          'Responsable retiré',
          "Cette agence n'a plus de responsable.",
        );
        this.managerChanged.emit({ userId: null, fullName: null });
        this._loadCandidates(this.agencyId());
      });
  }

  /**
   * Candidats possibles : le contrat exige un utilisateur du tenant, **actif**,
   * et **rattaché à cette agence**.
   *
   * `UsersApiService.listUsers(status?, agencyId?, search?, page?, pageSize?)` —
   * `agencyId` est le 2e paramètre positionnel. Le filtre `status` est un entier
   * dont le swagger ne documente pas les noms (enum 0|1|2|3) et dont l'usage
   * diverge déjà dans le repo ; on ne s'y fie donc pas et on filtre sur
   * `UserDto.status`, qui est une chaîne en lecture (`'Active'`).
   */
  private _loadCandidates(agencyId: string): void {
    this.isLoadingCandidates.set(true);
    this._usersApiService
      .listUsers(undefined, agencyId, undefined, 1, 200)
      .pipe(
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            "Impossible de charger les utilisateurs de l'agence, la désignation d'un responsable est indisponible.",
          );
          this.isLoadingCandidates.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        const currentId = this.currentManagerUserId();
        const options = (result.items ?? [])
          .filter((u) => !!u.id && u.status === 'Active')
          .map((u) => {
            const name = u.fullName?.trim() || u.email?.trim() || 'Utilisateur';
            return {
              label: u.id === currentId ? `${name} (responsable actuel)` : name,
              value: u.id as string,
            };
          });
        this.candidates.set(options);
        this.isLoadingCandidates.set(false);
      });
  }

  private _describeAssignError(err: HttpErrorResponse): string {
    const body = err?.error;
    const serverMessage =
      (typeof body?.detail === 'string' && body.detail.trim()) ||
      (typeof body?.title === 'string' && body.title.trim()) ||
      '';

    switch (err?.status) {
      case 409:
        // Déduction : le swagger ne décrit le 409 que par « Conflict ». Les
        // autres codes couvrent l'introuvable (404), la validation du corps
        // (400) et le droit (403) ; il reste donc les règles d'état énoncées
        // dans la description — l'utilisateur doit être actif et rattaché à
        // cette agence (sauf super-utilisateur).
        return (
          serverMessage ||
          "Cet utilisateur ne peut pas être nommé responsable de cette agence : il doit être actif et rattaché à cette agence."
        );
      case 404:
        return "Agence ou utilisateur introuvable : rechargez la page avant de réessayer.";
      case 403:
        return "Vous n'avez pas la permission de désigner le responsable d'une agence.";
      case 400:
        return (
          this._describeFieldErrors(body?.errors) ||
          serverMessage ||
          "La désignation a été refusée : l'utilisateur sélectionné n'est pas valide."
        );
      default:
        return (
          serverMessage ||
          'Impossible de désigner le responsable, réessayez plus tard.'
        );
    }
  }

  private _describeRemoveError(err: HttpErrorResponse): string {
    const body = err?.error;
    const serverMessage =
      (typeof body?.detail === 'string' && body.detail.trim()) ||
      (typeof body?.title === 'string' && body.title.trim()) ||
      '';

    switch (err?.status) {
      case 404:
        return 'Cette agence est introuvable : rechargez la page avant de réessayer.';
      case 403:
        return "Vous n'avez pas la permission de retirer le responsable d'une agence.";
      default:
        return (
          serverMessage ||
          'Impossible de retirer le responsable, réessayez plus tard.'
        );
    }
  }

  private _describeFieldErrors(errors: unknown): string {
    if (!errors || typeof errors !== 'object') return '';
    return Object.entries(errors as Record<string, unknown>)
      .map(([path, messages]) => {
        const text = Array.isArray(messages)
          ? messages.join('. ')
          : String(messages);
        return path ? `${path} : ${text}` : text;
      })
      .join(' ; ');
  }
}
