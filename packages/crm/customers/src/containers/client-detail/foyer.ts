import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Button } from '@talisoft/ui/button';
import { catchError, EMPTY, firstValueFrom, of } from 'rxjs';
import { form, submit } from '@angular/forms/signals';
import { FormRoot } from '@angular/forms/signals';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import {
  ComplianceConfigService,
  designationRoleLabel,
  designationStatusLabel,
  HouseholdDesignationView,
  HouseholdMemberDrawer,
  HouseholdMemberDrawerData,
  householdMemberFromClient,
  HouseholdMembersList,
  HouseholdMemberView,
  isDesignationToReview,
  PepExposureBadge,
  PepFieldset,
  PepFormModel,
  pepFormToStatus,
  pepSchema,
  pepToDto,
  PermissionsService,
  productCategoryLabel,
} from '@sankore/crm/common';
import {
  ClientHouseholdApiService,
  HoldingDto,
  ProductHoldingsApiService,
  RemoveHouseholdMemberResult,
} from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';
import { ClientHouseholdStore } from '../../models/client-household.store';
import {
  RemoveHouseholdMemberDrawer,
  RemoveHouseholdMemberDrawerData,
} from './remove-household-member-drawer';

/** Sujet du bloc PPE ouvert : le client lui-même ou l'un des membres du foyer. */
interface PepSubject {
  kind: 'principal' | 'member';
  memberId: string | null;
  label: string;
}

/**
 * Onglet « Foyer » de la fiche client (BNF-F-09).
 *
 * La liste des membres et le drawer d'ajout/modification viennent du socle partagé
 * (`household-members-list`, `HouseholdMemberDrawer` en `scope: 'client'`) : le
 * critère d'acceptation demande explicitement les mêmes composants que l'onglet
 * Foyer du lead. Seules les trois choses réellement propres au client vivent ici —
 * les désignations produit par membre, le retrait motivé avec son avertissement, et
 * le statut PPE écrit par `ClientHouseholdApiService`.
 */
@Component({
  selector: 'client-foyer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './foyer.html',
  imports: [
    FormRoot,
    TasCard,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
    HouseholdMembersList,
    PepExposureBadge,
    PepFieldset,
  ],
})
export class ClientFoyer {
  protected readonly householdStore = inject(ClientHouseholdStore);
  protected readonly clientStore = inject(ClientDetailStore);
  private readonly _householdApi = inject(ClientHouseholdApiService);
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _complianceConfig = inject(ComplianceConfigService);

  /** Sans ce droit, seule l'exposition est montrée — jamais la fonction exercée. */
  protected readonly canReadPep = this._permissions.can('customers:pep_read');
  /**
   * Vigilance PPE du tenant (`pepEnabled` des réglages de conformité). Désactivée, aucun bloc
   * PPE n'est proposé : ni badge, ni détail, ni saisie.
   */
  protected readonly pepEnabled = this._complianceConfig.pepEnabled;


  private readonly _holdings = signal<HoldingDto[]>([]);
  private readonly _designationsLoading = signal(false);
  private readonly _designationsFailed = signal(false);

  protected readonly designationsFailed = this._designationsFailed.asReadonly();
  protected readonly designationsLoading = this._designationsLoading.asReadonly();

  protected readonly clientId = computed(() => this.clientStore.clientId() ?? '');

  /**
   * L'écriture suppose les deux : `canEdit` est la règle d'habilitation décidée par
   * l'API, `isReadOnly` l'état de la fiche (archivée ou fusionnée). L'une sans
   * l'autre laisserait des boutons que le serveur refuserait.
   */
  protected readonly canEdit = computed(
    () => this.householdStore.canEdit() && !this.clientStore.isReadOnly(),
  );

  /**
   * Désignations par identifiant de sujet.
   *
   * Le contrat relie une désignation à son sujet par `DesignationDto.subjectId`, un
   * uuid, et par `subjectType` — dont il n'énumère aucune valeur. Le rapprochement
   * se fait donc sur l'égalité d'uuid avec `memberId` et sur rien d'autre : pas de
   * rapprochement par nom, qui confondrait deux homonymes du foyer.
   */
  private readonly _designationsBySubject = computed(() => {
    const map = new Map<string, HouseholdDesignationView[]>();
    for (const holding of this._holdings()) {
      const productLabel =
        holding.productCode?.trim() || productCategoryLabel(holding.productCategory);
      for (const designation of holding.designations ?? []) {
        const subjectId = designation.subjectId;
        if (!subjectId) continue;
        const list = map.get(subjectId) ?? [];
        list.push({
          holdingId: holding.holdingId ?? '',
          productLabel,
          roleLabel: designationRoleLabel(designation.roleCode),
          statusLabel: designationStatusLabel(designation.status),
          toReview: isDesignationToReview(designation.status),
        });
        map.set(subjectId, list);
      }
    }
    return map;
  });

  protected readonly members = computed<HouseholdMemberView[]>(() =>
    this.householdStore
      .members()
      .map((dto) =>
        householdMemberFromClient(
          dto,
          this._designationsBySubject().get(dto.memberId ?? '') ?? [],
        ),
      ),
  );

  protected readonly removedMembers = computed<HouseholdMemberView[]>(() =>
    this.householdStore
      .removedMembers()
      .map((dto) =>
        householdMemberFromClient(
          dto,
          this._designationsBySubject().get(dto.memberId ?? '') ?? [],
        ),
      ),
  );

  /**
   * Le client est lui aussi un sujet de désignation possible (souscripteur,
   * assuré) : son `subjectId` est alors son propre identifiant de client.
   */
  protected readonly principalDesignations = computed(
    () => this._designationsBySubject().get(this.clientId()) ?? [],
  );

  protected readonly hasActiveSpouse = computed(
    () => this.householdStore.activeSpouse() !== null,
  );

  protected readonly childrenCount = computed(
    () => this.members().filter((m) => m.type === 'Child').length,
  );

  /** Adresse du principal, affichée en lecture seule dans le drawer du socle. */
  protected readonly principalAddressLabel = computed(() => {
    const identity = this.householdStore.principal();
    const parts = [
      identity?.addressLine,
      [identity?.postalCode, identity?.city].filter((p) => !!p).join(' '),
      identity?.countryCode,
    ].filter((p) => !!p && `${p}`.trim().length > 0);
    return parts.length > 0 ? parts.join(', ') : 'Adresse du principal non renseignée';
  });

  // ——— Bloc PPE par personne ———

  protected readonly pepPanelOpen = signal(false);
  protected readonly pepSubject = signal<PepSubject>({
    kind: 'principal',
    memberId: null,
    label: 'le client',
  });

  protected pepModel = signal(PepFormModel.empty());
  protected pepForm = form(this.pepModel, pepSchema);

  protected readonly principalPepExposed = computed(
    () => this.householdStore.household()?.principalIsPepExposed === true,
  );

  constructor() {
    // Les désignations ne viennent pas du foyer mais des produits détenus : c'est le
    // seul endroit du contrat qui dit sur quels produits un membre est désigné.
    effect(() => {
      const clientId = this.clientId();
      if (!clientId) return;
      this._loadDesignations(clientId);
    });
  }

  // ——— Membres ———

  protected addSpouse(): void {
    this._openMemberDrawer('Spouse', null);
  }

  protected addChild(): void {
    this._openMemberDrawer('Child', null);
  }

  protected editMember(member: HouseholdMemberView): void {
    this._openMemberDrawer(member.type === 'Spouse' ? 'Spouse' : 'Child', member);
  }

  protected removeMember(member: HouseholdMemberView): void {
    const clientId = this.clientId();
    if (!clientId) return;

    const data: RemoveHouseholdMemberDrawerData = { clientId, member };
    const ref = this._sideDrawer.open<
      RemoveHouseholdMemberResult | null,
      RemoveHouseholdMemberDrawerData,
      RemoveHouseholdMemberDrawer
    >(RemoveHouseholdMemberDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((result) => {
      if (!result) return;
      const toReview = result.designationsToReview ?? 0;
      this._snackbar.success(
        'Membre retiré',
        toReview > 0
          ? `${member.displayName} ne fait plus partie du foyer. ${toReview} ` +
              `${toReview > 1 ? 'désignations sont passées' : 'désignation est passée'} ` +
              '« À revoir ».'
          : `${member.displayName} ne fait plus partie du foyer. Aucune désignation n'est ` +
              'à revoir.',
      );
      this._afterWrite();
    });
  }

  private _openMemberDrawer(
    memberType: 'Spouse' | 'Child',
    member: HouseholdMemberView | null,
  ): void {
    const clientId = this.clientId();
    if (!clientId) return;

    const data: HouseholdMemberDrawerData = {
      scope: 'client',
      ownerId: clientId,
      memberType,
      member,
      principalAddressLabel: this.principalAddressLabel(),
    };

    const ref = this._sideDrawer.open<
      boolean,
      HouseholdMemberDrawerData,
      HouseholdMemberDrawer
    >(HouseholdMemberDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((saved) => {
      if (saved !== true) return;
      this._afterWrite();
    });
  }

  // ——— PPE ———

  protected openPrincipalPep(): void {
    this.pepSubject.set({
      kind: 'principal',
      memberId: null,
      label: this.householdStore.principalLabel(),
    });
    this.pepModel.set(PepFormModel.fromDto(this.householdStore.household()?.principalPep));
    this.pepPanelOpen.set(true);
  }

  protected openMemberPep(member: HouseholdMemberView): void {
    this.pepSubject.set({
      kind: 'member',
      memberId: member.memberId,
      label: member.displayName,
    });
    this.pepModel.set(PepFormModel.fromStatus(member.pep));
    this.pepPanelOpen.set(true);
  }

  protected closePepPanel(): void {
    this.pepPanelOpen.set(false);
  }

  protected savePep(): void {
    const clientId = this.clientId();
    const subject = this.pepSubject();
    if (!clientId) return;

    submit(this.pepForm, async (field) => {
      const body = pepToDto(pepFormToStatus(field().value()));

      const request$ =
        subject.kind === 'principal'
          ? this._householdApi.setClientPepStatus(clientId, body)
          : this._householdApi.setClientHouseholdMemberPepStatus(
              clientId,
              subject.memberId ?? '',
              body,
            );

      const done = await firstValueFrom(
        request$.pipe(
          catchError(() => {
            this._snackbar.error(
              'Erreur',
              `Impossible d'enregistrer le statut PPE de ${subject.label}.`,
            );
            return EMPTY;
          }),
        ),
      );

      if (done !== undefined) {
        this._snackbar.success(
          'Statut PPE enregistré',
          `L'exposition politique de ${subject.label} a été mise à jour.`,
        );
        this.pepPanelOpen.set(false);
        this._afterWrite();
      }
    });
  }

  // ——— Chargement et rechargement ———

  protected reload(): void {
    this.householdStore.reload().subscribe();
    const clientId = this.clientId();
    if (clientId) this._loadDesignations(clientId);
  }

  /**
   * Un 200 ne prouve rien sur une écriture composée : on recharge le foyer, et la
   * fiche avec lui puisque le nombre de personnes à charge en dépend côté serveur.
   */
  private _afterWrite(): void {
    this.householdStore.reload().subscribe();
    this.clientStore.reload().subscribe();
  }

  private _loadDesignations(clientId: string): void {
    this._designationsLoading.set(true);
    this._designationsFailed.set(false);
    this._holdingsApi
      .listClientHoldings(clientId, undefined, undefined, 1, 100)
      .pipe(
        catchError(() => {
          this._designationsFailed.set(true);
          return of(null);
        }),
      )
      .subscribe((page) => {
        this._holdings.set(page?.items ?? []);
        this._designationsLoading.set(false);
      });
  }
}

export default ClientFoyer;
