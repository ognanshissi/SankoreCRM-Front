import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  AgenciesApiService,
  AssignOfficeRoleRequestOfficeRoleEnum,
  ClientGroupsApiService,
  GroupDetailDto,
  GroupMemberDto,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';

import { clientStatusLabel, clientStatusSeverity } from '../../models/client-labels';
import {
  AddGroupMemberDrawer,
  AddGroupMemberDrawerData,
} from './add-group-member-drawer';
import {
  OFFICE_BOARD_ROLES,
  OFFICE_ROLE_OPTIONS,
  groupStatusLabel,
  groupStatusSeverity,
  groupTypeLabel,
  isDissolvedGroup,
  isFormingGroup,
  isSuspendedGroup,
  officeRoleLabel,
  officeRoleName,
} from './group-labels';

/** Une entrée de la liste de contrôle d'activation. */
interface ActivationCheck {
  label: string;
  done: boolean;
  detail: string | null;
}

/** Un évènement d'adhésion, entrée ou sortie, pour l'historique. */
interface MembershipEvent {
  date: string;
  kind: 'join' | 'leave';
  memberName: string;
  officeRole: string | null;
  reason: string | null;
}

/** L'action en attente de motif : les trois écritures concernées en exigent un. */
interface PendingReasonAction {
  kind: 'suspend' | 'dissolve' | 'removeMember';
  title: string;
  hint: string;
  confirmLabel: string;
  clientId?: string;
}

class ReasonFormModel {
  public reason!: string;

  public static instantiate(): ReasonFormModel {
    const model = new ReasonFormModel();
    model.reason = '';
    return model;
  }
}

@Component({
  selector: 'client-group-detail',
  templateUrl: './client-group-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TasCard,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasSpinner,
    TasTag,
    TasIcon,
    FormRoot,
    FormField,
  ],
})
export class ClientGroupDetailPage {
  private readonly _clientGroupsApiService = inject(ClientGroupsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _router = inject(Router);

  /**
   * La lecture tient à `customers:read`, posé par la garde de route. Ce droit
   * couvre les écritures de la fiche : ajout et retrait d'un membre, attribution
   * d'un rôle de bureau, suspension et dissolution.
   */
  public readonly canManage = this._permissions.can('customers:groups_manage');

  public readonly groupId = input.required<string>();

  public readonly roleOptions = OFFICE_ROLE_OPTIONS;
  public readonly groupTypeLabel = groupTypeLabel;
  public readonly groupStatusLabel = groupStatusLabel;
  public readonly groupStatusSeverity = groupStatusSeverity;
  public readonly officeRoleLabel = officeRoleLabel;
  public readonly officeRoleName = officeRoleName;
  public readonly clientStatusLabel = clientStatusLabel;
  public readonly clientStatusSeverity = clientStatusSeverity;

  public isLoading = signal(true);
  public isNotFound = signal(false);
  public isSavingRole = signal<string | null>(null);
  public group = signal<GroupDetailDto | null>(null);
  public agencyName = signal('—');

  /** Jeton de rechargement : chaque écriture réussie le fait avancer. */
  private readonly _reloadToken = signal(0);

  public pendingAction = signal<PendingReasonAction | null>(null);
  public reasonModel = signal(ReasonFormModel.instantiate());
  public reasonForm = form(this.reasonModel, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
  });

  public readonly isDissolved = computed(() => isDissolvedGroup(this.group()?.status));
  public readonly isSuspended = computed(() => isSuspendedGroup(this.group()?.status));
  public readonly isForming = computed(() => isFormingGroup(this.group()?.status));

  public readonly activeMembers = computed(() =>
    (this.group()?.members ?? []).filter((member) => !member.leftAt),
  );
  public readonly formerMembers = computed(() =>
    (this.group()?.members ?? []).filter((member) => !!member.leftAt),
  );

  /** Le bureau : les trois rôles uniques, pourvus ou à pourvoir. */
  public readonly board = computed(() => {
    const group = this.group();
    const holderIdByRole: Record<string, string | null | undefined> = {
      President: group?.presidentClientId,
      Treasurer: group?.treasurerClientId,
      Secretary: group?.secretaryClientId,
    };
    return OFFICE_BOARD_ROLES.map((role) => {
      const clientId = holderIdByRole[role] ?? null;
      const holder = clientId
        ? (this.activeMembers().find((member) => member.clientId === clientId) ?? null)
        : null;
      return {
        role,
        label: officeRoleLabel(role),
        clientId,
        holderName: holder?.displayName ?? null,
        holderNumber: holder?.clientNumber ?? null,
      };
    });
  });

  public readonly minimumSize = computed(() => this.group()?.minimumSize ?? 0);
  public readonly maximumSize = computed(() => this.group()?.maximumSize ?? 0);
  public readonly memberCount = computed(() => this.group()?.activeMemberCount ?? 0);

  /** Remplissage de la jauge, borné à 100 % pour un groupe au-delà du plafond. */
  public readonly gaugePercent = computed(() => {
    const max = this.maximumSize();
    if (max <= 0) return 0;
    return Math.min(100, Math.round((this.memberCount() / max) * 100));
  });
  /** Position du repère de taille minimale sur la jauge. */
  public readonly gaugeMinimumPercent = computed(() => {
    const max = this.maximumSize();
    if (max <= 0) return 0;
    return Math.min(100, Math.round((this.minimumSize() / max) * 100));
  });
  public readonly isBelowMinimum = computed(
    () => this.minimumSize() > 0 && this.memberCount() < this.minimumSize(),
  );
  public readonly isAtMaximum = computed(
    () => this.maximumSize() > 0 && this.memberCount() >= this.maximumSize(),
  );

  /**
   * Liste de contrôle d'activation. Les deux premières conditions viennent du
   * contrat : « Forming -> Active once group-min-size-<type> active members AND
   * President + Treasurer + Secretary are filled ».
   *
   * La troisième — le KYC des membres — est une **déduction à confirmer côté
   * API** : `GroupMemberDto` ne porte pas de `kycStatus`, seulement un
   * `clientStatus`. On s'appuie donc sur ce statut (un client resté en
   * `PendingKyc` ou `Draft` n'est pas compté comme validé), ce qui approche la
   * règle sans la garantir. Le contrat, lui, ne refuse explicitement qu'un
   * client `KycRejected`, `Archived` ou `Merged` à l'ajout.
   */
  public readonly activationChecks = computed<ActivationCheck[]>(() => {
    const group = this.group();
    if (!group) return [];

    const minimum = this.minimumSize();
    const count = this.memberCount();
    // `clientStatus` revient tantôt nommé, tantôt sous forme d'index (précédent
    // `LeadDto.gender`, qui vaut '1') : « Active » est reconnu sous ses deux formes.
    const notValidated = this.activeMembers().filter((member) => {
      const status = String(member.clientStatus ?? '');
      return status !== 'Active' && status !== '2';
    });

    const checks: ActivationCheck[] = [
      {
        label: `Réunir au moins ${minimum} membre(s) actif(s)`,
        done: minimum > 0 && count >= minimum,
        detail: `${count} membre(s) actif(s) aujourd'hui`,
      },
    ];

    for (const seat of this.board()) {
      checks.push({
        label: `Désigner le ${seat.label.toLowerCase()}`,
        done: !!seat.clientId,
        detail: seat.holderName ?? 'Siège à pourvoir',
      });
    }

    checks.push({
      label: 'Valider le KYC de tous les membres',
      done: notValidated.length === 0,
      detail:
        notValidated.length === 0
          ? 'Tous les membres actifs ont un dossier en règle'
          : `${notValidated.length} membre(s) au dossier incomplet`,
    });

    return checks;
  });

  public readonly remainingChecks = computed(
    () => this.activationChecks().filter((check) => !check.done).length,
  );

  /**
   * Historique des adhésions : le contrat conserve les adhésions closes
   * (`leftAt` / `leaveReason`) plutôt que de les supprimer, à condition de
   * demander `includeFormerMembers=true`. Une adhésion donne donc jusqu'à deux
   * évènements, entrée et sortie, présentés du plus récent au plus ancien.
   */
  public readonly membershipHistory = computed<MembershipEvent[]>(() => {
    const events: MembershipEvent[] = [];
    for (const member of this.group()?.members ?? []) {
      const memberName = member.displayName ?? member.clientNumber ?? '—';
      if (member.joinedAt) {
        events.push({
          date: member.joinedAt,
          kind: 'join',
          memberName,
          officeRole: member.officeRole ? officeRoleLabel(member.officeRole) : null,
          reason: null,
        });
      }
      if (member.leftAt) {
        events.push({
          date: member.leftAt,
          kind: 'leave',
          memberName,
          officeRole: null,
          reason: member.leaveReason ?? null,
        });
      }
    }
    return events.sort((a, b) => b.date.localeCompare(a.date));
  });

  constructor() {
    effect(() => {
      const groupId = this.groupId();
      this._reloadToken();

      this.isLoading.set(true);
      this.isNotFound.set(false);

      this._clientGroupsApiService
        // `includeFormerMembers` est indispensable : sans lui l'historique des
        // adhésions closes n'arrive jamais.
        .getClientGroup(groupId, true)
        .pipe(
          catchError((err: HttpErrorResponse) => {
            // Un groupe hors périmètre renvoie 404 et jamais 403, pour ne pas
            // divulguer son existence : on affiche donc le même écran.
            if (err.status === 404) {
              this.isNotFound.set(true);
            } else {
              this._snackbarService.error('Erreur', 'Impossible de charger le groupe.');
            }
            this.isLoading.set(false);
            return EMPTY;
          }),
        )
        .subscribe((group) => {
          this.group.set(group);
          this._breadcrumbService.set([
            { label: 'Clients', link: ['/customers'] },
            { label: 'Groupes', link: ['/customers/groupes'] },
            { label: group.name ?? 'Groupe' },
          ]);
          this.isLoading.set(false);
          this._loadAgencyName(group.agencyId);
        });
    });
  }

  public formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  public backToList(): void {
    this._router.navigate(['/customers/groupes']);
  }

  public openMember(member: GroupMemberDto): void {
    if (!member.clientId) return;
    this._router.navigate(['/customers', member.clientId]);
  }

  public openAddMemberDrawer(): void {
    const group = this.group();
    if (!group?.id) return;

    const data: AddGroupMemberDrawerData = {
      groupId: group.id,
      groupName: group.name ?? 'ce groupe',
      agencyId: group.agencyId,
      version: group.version,
      memberClientIds: this.activeMembers()
        .map((member) => member.clientId)
        .filter((clientId): clientId is string => !!clientId),
    };

    const ref = this._sideDrawerService.open(AddGroupMemberDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((changed) => {
      if (changed) this.reload();
    });
  }

  public changeRole(member: GroupMemberDto, role: string | null): void {
    const group = this.group();
    if (!group?.id || !member.clientId || !role) return;
    if (officeRoleName(member.officeRole) === role) return;

    this.isSavingRole.set(member.clientId);
    this._clientGroupsApiService
      .assignClientGroupOfficeRole(group.id, member.clientId, {
        // Ici le contrat attend le nom du rôle, alors que l'ajout d'un membre
        // attend son index : la conversion vit dans `group-labels.ts`.
        officeRole: role as AssignOfficeRoleRequestOfficeRoleEnum,
        expectedVersion: group.version ?? null,
      })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbarService.error(
            'Erreur',
            err.error?.detail ?? err.error?.title ?? 'Impossible de changer ce rôle.',
          );
          this.isSavingRole.set(null);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.isSavingRole.set(null);
        if (result.activated) {
          this._snackbarService.success(
            'Groupe activé',
            'Le dernier siège manquant est pourvu : le groupe passe en actif.',
          );
        } else if (result.previousHolderClientId) {
          this._snackbarService.info(
            'Rôle transféré',
            'Le titulaire précédent redevient simple membre.',
          );
        } else {
          this._snackbarService.success('Rôle enregistré', 'Le bureau est à jour.');
        }
        // Le serveur peut avoir démis un autre titulaire et réévalué le statut :
        // on recharge plutôt que de recomposer la fiche de mémoire.
        this.reload();
      });
  }

  public askSuspend(): void {
    this._openReasonPanel({
      kind: 'suspend',
      title: 'Suspendre le groupe',
      hint: 'La suspension gèle le groupe sans toucher à ses adhésions. Elle est réversible.',
      confirmLabel: 'Suspendre le groupe',
    });
  }

  public askDissolve(): void {
    this._openReasonPanel({
      kind: 'dissolve',
      title: 'Dissoudre le groupe',
      hint: 'La dissolution est définitive : toutes les adhésions encore ouvertes sont closes avec ce motif.',
      confirmLabel: 'Dissoudre le groupe',
    });
  }

  public askRemoveMember(member: GroupMemberDto): void {
    if (!member.clientId) return;
    this._openReasonPanel({
      kind: 'removeMember',
      clientId: member.clientId,
      title: `Retirer ${member.displayName ?? 'ce membre'} du groupe`,
      hint: "L'adhésion est close, jamais supprimée : l'historique de caution solidaire reste consultable.",
      confirmLabel: 'Retirer du groupe',
    });
  }

  public cancelPendingAction(): void {
    this.pendingAction.set(null);
    this.reasonModel.set(ReasonFormModel.instantiate());
  }

  public handleReasonSubmit(): void {
    const action = this.pendingAction();
    const group = this.group();
    if (!action || !group?.id) return;

    submit(this.reasonForm, async (field) => {
      const reason = field()?.value().reason ?? '';
      const groupId = group.id as string;
      const version = group.version ?? null;

      const failure = (message: string) => (err: HttpErrorResponse) => {
        // INVALID_STATUS_TRANSITION et CONCURRENCY_CONFLICT arrivent en 409 avec
        // un libellé précis : le remonter évite de chercher à l'aveugle.
        this._snackbarService.error(
          'Erreur',
          err.error?.detail ?? err.error?.title ?? message,
        );
        return EMPTY;
      };

      let result: unknown;
      if (action.kind === 'suspend') {
        result = await firstValueFrom(
          this._clientGroupsApiService
            .suspendClientGroup(groupId, { reason, expectedVersion: version })
            .pipe(catchError(failure('Impossible de suspendre le groupe.'))),
        );
        if (result) {
          this._snackbarService.success('Groupe suspendu', 'Le groupe est gelé.');
        }
      } else if (action.kind === 'dissolve') {
        result = await firstValueFrom(
          this._clientGroupsApiService
            .dissolveClientGroup(groupId, { reason, expectedVersion: version })
            .pipe(catchError(failure('Impossible de dissoudre le groupe.'))),
        );
        if (result) {
          this._snackbarService.success(
            'Groupe dissous',
            'Les adhésions encore ouvertes ont été closes.',
          );
        }
      } else {
        const removal = await firstValueFrom(
          this._clientGroupsApiService
            .removeClientGroupMember(
              groupId,
              action.clientId as string,
              reason,
              version ?? undefined,
            )
            .pipe(catchError(failure('Impossible de retirer ce membre.'))),
        );
        result = removal;
        if (removal) {
          if (removal.belowMinimumSize) {
            // Pas de `warning` sur `SnackbarService` : `info` porte l'alerte.
            this._snackbarService.info(
              'Sous la taille minimale',
              'Le groupe passe sous sa taille minimale. Son statut reste inchangé.',
            );
          } else {
            this._snackbarService.success('Membre retiré', "L'adhésion est close.");
          }
        }
      }

      if (result) {
        this.cancelPendingAction();
        this.reload();
      }
    });
  }

  public reload(): void {
    this._reloadToken.update((token) => token + 1);
  }

  private _openReasonPanel(action: PendingReasonAction): void {
    this.reasonModel.set(ReasonFormModel.instantiate());
    this.pendingAction.set(action);
  }

  private _loadAgencyName(agencyId: string | null | undefined): void {
    if (!agencyId) {
      this.agencyName.set('—');
      return;
    }
    this._agenciesApiService
      .getAgency(agencyId)
      .pipe(catchError(() => EMPTY))
      .subscribe((agency) => this.agencyName.set(agency.name ?? agency.code ?? '—'));
  }
}

export default ClientGroupDetailPage;
