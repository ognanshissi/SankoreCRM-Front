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
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { AssignManagerResult, UsersApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';

export interface UserManagerChange {
  userId: string | null;
  fullName: string | null;
}

class AssignUserManagerFormModel {
  public managerUserId!: string;

  public static instantiate(): AssignUserManagerFormModel {
    const m = new AssignUserManagerFormModel();
    m.managerUserId = '';
    return m;
  }
}

/**
 * Section « Responsable hiérarchique » de la fiche utilisateur.
 *
 * - PUT /api/v1/users/{userId}/manager → `AssignManagerResult`
 * - DELETE /api/v1/users/{userId}/manager → 204, idempotent
 *
 * Les deux actions exigent `user:assign-manager`.
 *
 * À la différence du responsable d'agence, le contrat précise que le manager
 * « need NOT belong to the same agency » : les candidats sont donc cherchés dans
 * tout le tenant, et non dans l'agence de l'utilisateur.
 */
@Component({
  selector: 'user-manager-card',
  templateUrl: './user-manager-card.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasCard,
    TasCardHeader,
    Button,
    TasIcon,
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
export class UserManagerCard {
  private readonly _permissions = inject(PermissionsService);
  public readonly canAssignManager = this._permissions.can('user:assign-manager');

  private readonly _usersApiService = inject(UsersApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);

  public readonly userId = input.required<string>();
  public readonly userFullName = input<string | null | undefined>(null);
  public readonly reportsToUserId = input<string | null | undefined>(null);
  public readonly reportsToFullName = input<string | null | undefined>(null);

  public readonly managerChanged = output<UserManagerChange>();

  /**
   * Responsable affiché : initialisé sur l'entrée venant de la fiche, puis mis à
   * jour localement après une assignation ou un retrait pour que la carte reflète
   * l'action sans attendre un rechargement complet de l'utilisateur.
   */
  public currentManagerUserId = linkedSignal(() => this.reportsToUserId() ?? null);
  public currentManagerFullName = linkedSignal(
    () => this.reportsToFullName() ?? null,
  );

  public isLoadingCandidates = signal(false);
  public isRemoving = signal(false);
  public candidates = signal<{ label: string; value: string }[]>([]);

  /**
   * Vrai quand le serveur déclare plus d'utilisateurs qu'on n'en a chargé : la
   * liste déroulante est alors incomplète, et le dire vaut mieux que laisser
   * chercher un nom qui n'y est pas.
   */
  public candidatesTruncated = signal(false);

  public readonly hasManager = computed(() => !!this.currentManagerUserId());

  public assignModel = signal(AssignUserManagerFormModel.instantiate());
  public assignFormSchema = form(this.assignModel, (schema) => {
    required(schema.managerUserId, {
      message: 'Sélectionnez le responsable hiérarchique',
    });
  });

  constructor() {
    effect(() => {
      const id = this.userId();
      if (id) this._loadCandidates(id);
    });
  }

  public handleAssign(): void {
    submit(this.assignFormSchema, async (field) => {
      const managerUserId = field()?.value()?.managerUserId;
      if (!managerUserId) return;

      const result = await firstValueFrom(
        this._usersApiService
          .assignUserManager(this.userId(), { managerUserId })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbarService.error('Erreur', this._describeAssignError(err));
              // `of(null)` et non `EMPTY` : `firstValueFrom` sur un flux vide
              // rejette avec une EmptyError, qui ferait échouer la soumission
              // après qu'on a déjà affiché le message d'erreur.
              return of<AssignManagerResult | null>(null);
            }),
          ),
      );

      if (!result) return;

      const fullName =
        result.managerFullName?.trim() ||
        this._candidateName(managerUserId) ||
        'Cet utilisateur';

      this.currentManagerUserId.set(result.managerUserId ?? managerUserId);
      this.currentManagerFullName.set(result.managerFullName ?? fullName);
      this.assignModel.set(AssignUserManagerFormModel.instantiate());

      if (result.changed === false) {
        // Le contrat : « Re-sending the same manager succeeds without changing
        // anything. » Ce n'est pas un échec, ce n'est pas non plus un changement.
        this._snackbarService.info(
          'Aucun changement',
          `${this._subject()} reportait déjà à ${fullName}.`,
        );
      } else {
        const previousName = result.previousManagerUserId
          ? this._candidateName(result.previousManagerUserId)
          : '';
        this._snackbarService.success(
          'Responsable défini',
          previousName
            ? `${this._subject()} reporte désormais à ${fullName}, en remplacement de ${previousName}.`
            : `${this._subject()} reporte désormais à ${fullName}.`,
        );
      }

      this.managerChanged.emit({
        userId: result.managerUserId ?? managerUserId,
        fullName: result.managerFullName ?? fullName,
      });

      // Recharge la liste pour que l'étiquette « responsable actuel » suive le
      // changement qu'on vient d'enregistrer.
      this._loadCandidates(this.userId());
    });
  }

  public confirmRemove(): void {
    const fullName = this.currentManagerFullName()?.trim() || 'Son responsable';

    this._confirmDialogService.confirm({
      title: 'Retirer le responsable hiérarchique',
      message: `${this._subject()} ne reportera plus à ${fullName} et se retrouvera au sommet de sa ligne hiérarchique. Les utilisateurs qui lui reportent ne sont pas touchés. Continuer ?`,
      closable: true,
      acceptButtonProps: { label: 'Retirer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._remove(),
    });
  }

  private _remove(): void {
    this.isRemoving.set(true);
    this._usersApiService
      .clearUserManager(this.userId())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbarService.error('Erreur', this._describeRemoveError(err));
          this.isRemoving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isRemoving.set(false);
        // L'endpoint est idempotent : un 204 est toujours un succès, même si
        // l'utilisateur n'avait déjà plus de responsable. On ne présente donc
        // jamais ce cas comme un échec.
        this.currentManagerUserId.set(null);
        this.currentManagerFullName.set(null);
        this._snackbarService.success(
          'Responsable retiré',
          `${this._subject()} n'a plus de responsable hiérarchique.`,
        );
        this.managerChanged.emit({ userId: null, fullName: null });
        this._loadCandidates(this.userId());
      });
  }

  /**
   * Candidats possibles : un utilisateur du tenant, **actif**, et différent de
   * l'utilisateur édité — se désigner soi-même fermerait immédiatement une
   * boucle, que le serveur refuse par un 409.
   *
   * `UsersApiService.listUsers(status?, agencyId?, search?, page?, pageSize?)`.
   * Le filtre `status` est un entier dont le swagger ne documente pas les noms
   * (enum 0|1|2|3) et dont l'usage diverge déjà dans le repo ; on ne s'y fie donc
   * pas et on filtre sur `UserDto.status`, qui est une chaîne en lecture
   * (`'Active'`).
   */
  private _loadCandidates(userId: string): void {
    this.isLoadingCandidates.set(true);
    this._usersApiService
      .listUsers(undefined, undefined, undefined, 1, 500)
      .pipe(
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            "Impossible de charger la liste des utilisateurs, la désignation d'un responsable est indisponible.",
          );
          this.isLoadingCandidates.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        const items = result.items ?? [];
        const currentId = this.currentManagerUserId();
        const options = items
          .filter((u) => !!u.id && u.id !== userId && u.status === 'Active')
          .map((u) => {
            const name = u.fullName?.trim() || u.email?.trim() || 'Utilisateur';
            const agency = u.agencyName?.trim();
            const label = agency ? `${name} — ${agency}` : name;
            return {
              label: u.id === currentId ? `${label} (responsable actuel)` : label,
              value: u.id as string,
            };
          });
        this.candidates.set(options);
        this.candidatesTruncated.set((result.totalCount ?? 0) > items.length);
        this.isLoadingCandidates.set(false);
      });
  }

  private _candidateName(userId: string): string {
    const label = this.candidates().find((c) => c.value === userId)?.label ?? '';
    // L'étiquette porte l'agence et, le cas échéant, la mention « responsable
    // actuel » : on ne garde que le nom pour les messages.
    return label.split(' — ')[0].replace(' (responsable actuel)', '').trim();
  }

  private _subject(): string {
    return this.userFullName()?.trim() || 'Cet utilisateur';
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
        // dans la description — le manager doit être actif, et l'assignation
        // est refusée « when it would close a loop in the hierarchy ».
        return (
          serverMessage ||
          "Cette désignation fermerait une boucle dans la hiérarchie : le responsable choisi reporte, directement ou indirectement, à cet utilisateur. Choisissez quelqu'un hors de sa ligne hiérarchique."
        );
      case 404:
        return 'Utilisateur ou responsable introuvable : rechargez la page avant de réessayer.';
      case 403:
        return "Vous n'avez pas la permission de définir le responsable hiérarchique d'un utilisateur.";
      case 400:
        return (
          this._describeFieldErrors(body?.errors) ||
          serverMessage ||
          "La désignation a été refusée : l'utilisateur sélectionné n'est pas valide."
        );
      default:
        return (
          serverMessage ||
          'Impossible de définir le responsable, réessayez plus tard.'
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
        return 'Cet utilisateur est introuvable : rechargez la page avant de réessayer.';
      case 403:
        return "Vous n'avez pas la permission de retirer le responsable hiérarchique d'un utilisateur.";
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
