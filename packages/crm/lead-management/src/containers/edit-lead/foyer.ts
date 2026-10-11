import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import {
  HouseholdMemberDrawer,
  HouseholdMemberDrawerData,
  HouseholdMemberView,
  HouseholdMembersList,
  PepExposureBadge,
  PERMISSIONS,
  PermissionsService,
  householdMemberFromLead,
  pepFromDto,
  pepLinkLabel,
} from '@sankore/crm/common';
import { LeadComplianceStore } from './lead-compliance-store';
import { LeadEditContext } from './lead-edit-context';
import {
  PepDrawer,
  PepDrawerData,
  PepDrawerResult,
  PepPropagationDrawer,
  PepPropagationDrawerData,
} from './pep-drawer';
import {
  RemoveHouseholdMemberDrawer,
  RemoveHouseholdMemberDrawerData,
} from './remove-household-member-drawer';

/**
 * Onglet « Foyer » de la fiche lead : conjoint, enfants et statut PPE de chaque
 * personne (BNF-F-03 et BNF-F-04).
 *
 * L'écran n'apporte aucune règle métier : `maxChildren` et `childMaxAge` viennent de
 * la ligne de produit via `LeadHouseholdDto`, et c'est l'API qui refuse un second
 * conjoint ou un enfant de trop. Le front ne fait que ne pas proposer ce qui est de
 * toute façon refusé.
 *
 * Il n'y a plus de `householdEnabled` : le foyer se saisit sur n'importe quel lead,
 * quelle que soit sa ligne de produit.
 *
 * La liste, le drawer d'ajout/modification et le bloc PPE sont ceux du socle
 * `@sankore/crm/common`, partagés avec la fiche client : les dupliquer ici
 * dupliquerait la règle « type d'union obligatoire » et la case « même adresse ».
 */
@Component({
  selector: 'lead-foyer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './foyer.html',
  imports: [
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    HouseholdMembersList,
    PepExposureBadge,
  ],
})
export class LeadFoyer {
  protected readonly compliance = inject(LeadComplianceStore);
  private readonly _leadEditContext = inject(LeadEditContext);
  private readonly _permissions = inject(PermissionsService);
  private readonly _sideDrawer = inject(SideDrawerService);

  private readonly _canUpdateLead = this._permissions.can(PERMISSIONS.LEAD_UPDATE);

  /** Sans `customers:pep_read`, seul le badge d'exposition est montré (BNF-F-04). */
  public readonly canReadPep = this._permissions.can(PERMISSIONS.CUSTOMERS_PEP_READ);

  /** Un lead converti est figé : son foyer se modifie depuis la fiche client. */
  public readonly canEdit = computed(
    () => this._canUpdateLead() && !this._leadEditContext.isReadOnly(),
  );

  public readonly readOnlyBecauseConverted = computed(() =>
    this._leadEditContext.isConverted(),
  );

  /**
   * Le détail PPE ne se modifie qu'avec le droit de lecture : l'API masque la
   * fonction exercée sans ce droit, et enregistrer depuis un formulaire qui ne
   * l'a jamais reçue l'effacerait côté serveur.
   */
  public readonly canEditPep = computed(() => this.canEdit() && this.canReadPep());

  public readonly activeMembers = computed<HouseholdMemberView[]>(() =>
    this.compliance.members().map(householdMemberFromLead),
  );

  public readonly removedMembers = computed<HouseholdMemberView[]>(() =>
    this.compliance.removedMembers().map(householdMemberFromLead),
  );

  public readonly principalPep = computed(() =>
    pepFromDto(this.compliance.household()?.principalPep),
  );

  public readonly principalAddressLabel = computed(() => {
    const identity = this.compliance.principal();
    const parts = [
      identity?.addressLine,
      [identity?.postalCode, identity?.city].filter((p) => !!p).join(' '),
      identity?.countryCode,
    ].filter((part) => !!part && part.trim().length > 0);
    return parts.length > 0 ? parts.join(', ') : 'Adresse non renseignée';
  });

  private readonly _maxChildren = computed(
    () => this.compliance.household()?.maxChildren ?? null,
  );
  private readonly _childMaxAge = computed(
    () => this.compliance.household()?.childMaxAge ?? null,
  );

  public readonly childrenLimitReached = computed(() => {
    const max = this._maxChildren();
    return max !== null && this.compliance.children().length >= max;
  });

  public readonly canAddSpouse = computed(() => this.compliance.activeSpouse() === null);

  public readonly limitsLabel = computed(() => {
    const max = this._maxChildren();
    const maxAge = this._childMaxAge();
    const parts: string[] = [
      `${this.compliance.children().length} enfant(s)` +
        (max !== null ? ` sur ${max} autorisé(s)` : ', sans limite de nombre'),
    ];
    if (maxAge !== null) parts.push(`âge maximal : ${maxAge} ans`);
    parts.push(this.compliance.activeSpouse() ? 'conjoint renseigné' : 'aucun conjoint');
    return parts.join(' · ');
  });

  public linkLabel(link: string | null): string {
    return pepLinkLabel(link);
  }

  public reload(): void {
    this.compliance.reloadHousehold().subscribe();
    this.compliance.reloadCompleteness().subscribe();
  }

  public addSpouse(): void {
    this._openMemberDrawer('Spouse', null);
  }

  public addChild(): void {
    this._openMemberDrawer('Child', null);
  }

  public editMember(member: HouseholdMemberView): void {
    this._openMemberDrawer(member.type === 'Spouse' ? 'Spouse' : 'Child', member);
  }

  public removeMember(member: HouseholdMemberView): void {
    const leadId = this.compliance.leadId();
    if (!leadId || !this.canEdit()) return;

    const data: RemoveHouseholdMemberDrawerData = { leadId, member };
    const ref = this._sideDrawer.open<boolean, RemoveHouseholdMemberDrawerData, RemoveHouseholdMemberDrawer>(
      RemoveHouseholdMemberDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );

    ref.closed.subscribe((removed) => {
      if (removed) this.compliance.reloadAfterWrite();
    });
  }

  public openPrincipalPep(): void {
    this._openPepDrawer(null, this.compliance.principalLabel(), this.principalPep());
  }

  public openMemberPep(member: HouseholdMemberView): void {
    this._openPepDrawer(member, member.displayName, member.pep);
  }

  private _openMemberDrawer(
    memberType: 'Spouse' | 'Child',
    member: HouseholdMemberView | null,
  ): void {
    const leadId = this.compliance.leadId();
    if (!leadId || !this.canEdit()) return;

    const data: HouseholdMemberDrawerData = {
      scope: 'lead',
      ownerId: leadId,
      memberType,
      member,
      principalAddressLabel: this.principalAddressLabel(),
    };

    const ref = this._sideDrawer.open<boolean, HouseholdMemberDrawerData, HouseholdMemberDrawer>(
      HouseholdMemberDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );

    ref.closed.subscribe((saved) => {
      if (saved) this.compliance.reloadAfterWrite();
    });
  }

  private _openPepDrawer(
    member: HouseholdMemberView | null,
    subjectLabel: string,
    initialPep: ReturnType<typeof pepFromDto>,
  ): void {
    const leadId = this.compliance.leadId();
    if (!leadId) return;

    const data: PepDrawerData = {
      leadId,
      member,
      subjectLabel,
      canReadDetails: this.canReadPep(),
      readOnly: !this.canEdit(),
      initialPep,
    };

    const ref = this._sideDrawer.open<PepDrawerResult | undefined, PepDrawerData, PepDrawer>(
      PepDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );

    ref.closed.subscribe((result) => {
      if (!result) return;
      this.compliance.reloadAfterWrite();
      if (result.isPrincipal && result.pep.isPep) {
        this._proposePropagation(leadId, result.pep);
      }
    });
  }

  /**
   * Un principal déclaré PPE expose son foyer : BNF-F-04 veut qu'on le propose,
   * pas qu'on l'applique d'office. La proposition n'a de sens qu'avec des membres
   * actifs à qui l'appliquer — et le lien reste modifiable personne par personne
   * dans le drawer.
   */
  private _proposePropagation(leadId: string, principalPep: PepDrawerResult['pep']): void {
    const members = this.activeMembers();
    if (members.length === 0) return;

    const data: PepPropagationDrawerData = {
      leadId,
      principalPep,
      principalLabel: this.compliance.principalLabel(),
      members,
    };

    const ref = this._sideDrawer.open<boolean, PepPropagationDrawerData, PepPropagationDrawer>(
      PepPropagationDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );

    ref.closed.subscribe((applied) => {
      if (applied) this.compliance.reloadAfterWrite();
    });
  }
}

export default LeadFoyer;
