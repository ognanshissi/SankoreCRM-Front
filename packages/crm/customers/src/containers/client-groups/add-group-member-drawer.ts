import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { Subject, catchError, debounceTime, EMPTY, firstValueFrom } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ClientGroupsApiService, ClientSearchItemDto, ClientsApiService } from '@sankore/crm-api';

import {
  clientStatusLabel,
  clientStatusSeverity,
  clientTypeLabel,
  isArchivedStatus,
  isMergedStatus,
  kycStatusLabel,
} from '../../models/client-labels';
import { OFFICE_ROLE_OPTIONS, officeRoleToNumeric } from './group-labels';

export interface AddGroupMemberDrawerData {
  groupId: string;
  groupName: string;
  /** Agence du groupe : sert à repérer les clients d'un autre rattachement. */
  agencyId: string | null | undefined;
  /** `GroupDetailDto.version`, renvoyée en `expectedVersion` sur l'écriture. */
  version: number | null | undefined;
  /** Identifiants des membres actifs, pour ne pas les proposer deux fois. */
  memberClientIds: string[];
}

/** Un résultat de recherche accompagné de la raison qui le rend inéligible. */
interface MemberCandidate {
  client: ClientSearchItemDto;
  /** `null` quand le client peut être ajouté. */
  blockedReason: string | null;
}

class AddMemberFormModel {
  public clientId!: string;
  public officeRole!: string;

  public static instantiate(): AddMemberFormModel {
    const model = new AddMemberFormModel();
    model.clientId = '';
    model.officeRole = 'Member';
    return model;
  }
}

@Component({
  selector: 'add-group-member-drawer',
  templateUrl: './add-group-member-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    FormsModule,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
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
export class AddGroupMemberDrawer {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _clientsApiService = inject(ClientsApiService);
  private readonly _clientGroupsApiService = inject(ClientGroupsApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly data = inject<AddGroupMemberDrawerData>(DIALOG_DATA);

  public readonly roleOptions = OFFICE_ROLE_OPTIONS;
  public readonly clientStatusLabel = clientStatusLabel;
  public readonly clientStatusSeverity = clientStatusSeverity;
  public readonly clientTypeLabel = clientTypeLabel;

  public searchTerm = signal('');
  public isSearching = signal(false);
  public hasSearched = signal(false);
  public candidates = signal<MemberCandidate[]>([]);
  public selectedClient = signal<ClientSearchItemDto | null>(null);

  public readonly eligibleCount = computed(
    () => this.candidates().filter((candidate) => !candidate.blockedReason).length,
  );

  public model = signal(AddMemberFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.clientId, { message: 'Sélectionnez un client dans la liste' });
  });

  /** Frappes de recherche, regroupées avant l'appel réseau. */
  private readonly _search$ = new Subject<void>();

  constructor() {
    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._search());
  }

  public onSearchChange(value: string | null): void {
    this.searchTerm.set(value ?? '');
    this._search$.next();
  }

  /** Une ligne inéligible se grise et ne réagit plus au survol ni au clic. */
  public candidateRowClass(candidate: MemberCandidate): string {
    if (candidate.blockedReason) return 'opacity-50 cursor-not-allowed';
    const selected = candidate.client.id === this.selectedClient()?.id;
    return `cursor-pointer hover:bg-slate-50${selected ? ' bg-slate-50' : ''}`;
  }

  public selectClient(candidate: MemberCandidate): void {
    if (candidate.blockedReason) return;
    this.selectedClient.set(candidate.client);
    this.model.update((previous) => {
      const next = new AddMemberFormModel();
      next.clientId = candidate.client.id ?? '';
      next.officeRole = previous.officeRole;
      return next;
    });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();

      const result = await firstValueFrom(
        this._clientGroupsApiService
          .addClientGroupMember(this.data.groupId, {
            clientId: value.clientId,
            // Le contrat attend ici l'entier du rôle, alors que
            // `assignClientGroupOfficeRole` attend son nom : la conversion est
            // centralisée dans `group-labels.ts`.
            officeRole: officeRoleToNumeric(value.officeRole) ?? null,
            expectedVersion: this.data.version ?? null,
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              // Le serveur nomme précisément le refus (GROUP_SIZE_LIMIT_REACHED,
              // GROUP_MEMBER_NOT_ELIGIBLE, ALREADY_IN_SOLIDARITY_GROUP,
              // CONCURRENCY_CONFLICT) : son message vaut mieux qu'un texte générique.
              this._snackbarService.error(
                'Ajout refusé',
                err.error?.detail ??
                  err.error?.title ??
                  "Impossible d'ajouter ce client au groupe.",
              );
              return EMPTY;
            }),
          ),
      );

      if (result) {
        if (result.activated) {
          this._snackbarService.success(
            'Groupe activé',
            'Le groupe réunit sa taille minimale et son bureau est complet.',
          );
        } else {
          this._snackbarService.success('Membre ajouté', 'Le client rejoint le groupe.');
        }
        this._dialogRef.close(true);
      }
    });
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _search(): void {
    const term = this.searchTerm().trim();
    if (term.length < 2) {
      this.candidates.set([]);
      this.hasSearched.set(false);
      return;
    }

    this.isSearching.set(true);
    this._clientsApiService
      .searchClients(
        undefined,
        undefined,
        undefined,
        term,
        undefined,
        // Volontairement sans filtre d'agence : un client d'un autre
        // rattachement doit apparaître grisé avec sa raison, et non disparaître.
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        25,
      )
      .pipe(
        catchError(() => {
          this._snackbarService.error('Erreur', 'La recherche de clients a échoué.');
          this.isSearching.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.candidates.set(
          (result.items ?? []).map((client) => ({
            client,
            blockedReason: this._blockedReason(client),
          })),
        );
        this.hasSearched.set(true);
        this.isSearching.set(false);
      });
  }

  /**
   * Règles d'éligibilité appliquées côté client — **déduction à confirmer côté
   * API**. Le contrat n'expose aucun endpoint d'éligibilité : il décrit
   * seulement les refus du POST members (409 GROUP_MEMBER_NOT_ELIGIBLE pour un
   * client KycRejected, Archived ou Merged ; ALREADY_IN_SOLIDARITY_GROUP selon
   * le réglage `solidarity-single-group-rule` ; GROUP_SIZE_LIMIT_REACHED).
   *
   * On reproduit donc ici ce qui est vérifiable avec `ClientSearchItemDto` :
   * appartenance au groupe, statut archivé ou fusionné, agence différente de
   * celle du groupe, KYC non validé. Deux écarts connus et assumés :
   * l'appartenance à un autre groupe solidaire n'est pas lisible depuis ce DTO,
   * et le contrat refuse seulement `KycRejected` là où l'on grise tout KYC non
   * validé — un ajout resté possible côté serveur est donc masqué ici, ce qui
   * reste le sens prudent. Le serveur garde le dernier mot : son refus est
   * remonté tel quel.
   */
  private _blockedReason(client: ClientSearchItemDto): string | null {
    if (client.id && this.data.memberClientIds.includes(client.id)) {
      return 'Déjà membre de ce groupe';
    }
    if (isArchivedStatus(client.status)) return 'Client archivé';
    if (isMergedStatus(client.status)) return 'Client fusionné';
    if (this.data.agencyId && client.agencyId && client.agencyId !== this.data.agencyId) {
      return "Rattaché à une autre agence que le groupe";
    }
    // `kycStatus` revient tantôt nommé, tantôt sous forme d'index (précédent
    // `LeadDto.gender`, qui vaut '1') : les deux formes de « Validated » comptent.
    const kyc = String(client.kycStatus ?? '');
    if (kyc !== 'Validated' && kyc !== '2') {
      return `KYC non validé (${kycStatusLabel(client.kycStatus)})`;
    }
    return null;
  }
}
