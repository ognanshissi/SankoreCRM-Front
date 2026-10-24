import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { form, FormField, FormRoot, readonly, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { HouseholdResourcesDto, LeadsApiService } from '@sankore/crm-api';
import {
  ComplianceConfigService,
  currencyUnit,
  HouseholdMemberDrawer,
  HouseholdMemberDrawerData,
  householdMemberFromLead,
  HouseholdMembersList,
  HouseholdMemberView,
  pepFromDto,
  PERMISSIONS,
  PermissionsService,
  TenantProvider,
} from '@sankore/crm/common';
import { interestedProductLabel } from '../../components/interested-product';
import { LeadComplianceStore } from './lead-compliance-store';
import { LeadEditContext } from './lead-edit-context';
import {
  ageOf,
  amountText,
  displayName,
  formatAmount,
  formatDay,
  householdBudget,
  initials,
  missingAddressParts,
  parseAmount,
} from './lead-view.models';
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

/** Les ressources du foyer telles que l'onglet les saisit : du texte, converti à l'envoi. */
class HouseholdResourcesFormModel {
  public monthlyIncome!: string;
  public housingCost!: string;
  public otherDebts!: string;

  public static fromDto(dto: HouseholdResourcesDto | null | undefined): HouseholdResourcesFormModel {
    const m = new HouseholdResourcesFormModel();
    m.monthlyIncome = amountText(dto?.monthlyIncome);
    m.housingCost = amountText(dto?.housingCost);
    m.otherDebts = amountText(dto?.otherDebts);
    return m;
  }
}

const AMOUNT_ERROR = { kind: 'amount', message: 'Saisissez un montant positif, en chiffres' };

/**
 * Onglet « Foyer » de la fiche lead : qui vit avec le prospect (BNF-F-03), le statut PPE de
 * chacun (BNF-F-04), et ce que le foyer gagne et doit déjà chaque mois.
 *
 * L'écran n'apporte aucune règle métier : `maxChildren` et `childMaxAge` viennent de la ligne de
 * produit via `LeadHouseholdDto`, et c'est l'API qui refuse un second conjoint ou un enfant de
 * trop. Le front ne propose simplement pas ce qui serait refusé.
 *
 * Les personnes sont des cartes et non une `tas-table` : le foyer est une composition bornée — le
 * principal, un conjoint, les enfants que la ligne autorise — qui se lit d'un coup d'œil, pas une
 * collection qu'on pagine ou qu'on filtre. L'historique des retraits, lui, reste la liste partagée.
 */
@Component({
  selector: 'lead-foyer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './foyer.html',
  imports: [
    RouterLink,
    FormRoot,
    FormField,
    TasCard,
    TasSpinner,
    TasIcon,
    TasInput,
    TasFormField,
    TasLabel,
    TasError,
    TasSuffix,
    Button,
    HouseholdMembersList,
  ],
})
export class LeadFoyer {
  protected readonly compliance = inject(LeadComplianceStore);
  private readonly _context = inject(LeadEditContext);
  private readonly _permissions = inject(PermissionsService);
  private readonly _complianceConfig = inject(ComplianceConfigService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _tenant = inject(TenantProvider);

  public readonly formatAmount = formatAmount;
  public readonly formatDay = formatDay;
  public readonly initials = initials;

  /**
   * Le droit que le serveur exige sur toutes les écritures du foyer. L'écran demandait `lead:update`,
   * si bien qu'un rôle qui ne l'avait pas voyait les boutons et recevait un 403 à l'enregistrement.
   */
  private readonly _canManageHousehold = this._permissions.can(PERMISSIONS.LEAD_HOUSEHOLD_MANAGE);
  private readonly _canUpdateLead = this._permissions.can(PERMISSIONS.LEAD_UPDATE);

  /** Sans `customers:pep_read`, seul le badge d'exposition est montré (BNF-F-04). */
  public readonly canReadPep = this._permissions.can(PERMISSIONS.CUSTOMERS_PEP_READ);
  /** Vigilance PPE du tenant. Désactivée, aucun statut PPE n'est proposé. */
  public readonly pepEnabled = this._complianceConfig.pepEnabled;

  /** Un lead converti est figé : son foyer se modifie depuis la fiche client. */
  public readonly canEdit = computed(() => this._canManageHousehold() && !this._context.isReadOnly());
  public readonly canEditAddress = computed(() => this._canUpdateLead() && !this._context.isReadOnly());
  public readonly readOnlyBecauseConverted = this._context.isConverted;

  /**
   * Le détail PPE ne se modifie qu'avec le droit de lecture : l'API masque la fonction exercée sans
   * ce droit, et enregistrer depuis un formulaire qui ne l'a jamais reçue l'effacerait.
   */
  public readonly canEditPep = computed(() => this.canEdit() && this.canReadPep());

  // ——— Les personnes ———

  public readonly lead = this._context.lead;
  public readonly principalName = computed(() => displayName(this.lead()));
  /** « Didier » — le prénom pour le titre et les phrases, le nom complet à défaut. */
  public readonly firstName = computed(() => this.lead()?.firstName?.trim() || this.principalName());
  public readonly principalAge = computed(() => ageOf(this.lead()?.dateOfBirth));

  /** « emprunteur principal » pour un crédit, « titulaire principal » pour le reste. */
  public readonly principalRole = computed(() => {
    const product = interestedProductLabel(this.lead()?.interestedProduct) ?? '';
    return /cr[ée]dit|pr[êe]t|financement/i.test(product) ? 'emprunteur principal' : 'titulaire principal';
  });

  public readonly principalPep = computed(() => pepFromDto(this.compliance.household()?.principalPep));
  public readonly principalIsPep = computed(() => this.compliance.household()?.principalIsPepExposed === true);

  public readonly principalAddressMissing = computed(() => missingAddressParts(this.lead()?.address).length > 0);
  public readonly principalPlace = computed(() => {
    const address = this.lead()?.address;
    return [address?.neighbourhood, address?.city].filter((p) => !!p?.trim()).join(', ');
  });

  public readonly activeMembers = computed<HouseholdMemberView[]>(() =>
    this.compliance.members().map(householdMemberFromLead),
  );
  public readonly removedMembers = computed<HouseholdMemberView[]>(() =>
    this.compliance.removedMembers().map(householdMemberFromLead),
  );

  public readonly peopleCount = computed(() => 1 + this.activeMembers().length);
  public readonly dependentsCount = computed(() => this.compliance.children().length);

  /** « Didier vit seul pour l'instant… » / « Didier vit avec son conjoint et 2 enfants. » */
  public readonly summary = computed(() => {
    const first = this.firstName();
    const spouse = this.compliance.activeSpouse();
    const children = this.dependentsCount();
    if (!spouse && children === 0) {
      const alone = this.lead()?.gender === 'Female' ? 'seule' : 'seul';
      const invite = this.canEdit()
        ? ' Ajoutez son conjoint et ses enfants : ils comptent pour la capacité de remboursement.'
        : '';
      return `${first} vit ${alone} pour l'instant d'après sa fiche.${invite}`;
    }
    const parts = [
      spouse ? 'son conjoint' : null,
      children > 0 ? `${children} enfant${children > 1 ? 's' : ''}` : null,
    ].filter(Boolean);
    return `${first} vit avec ${parts.join(' et ')}.`;
  });

  private readonly _maxChildren = computed(() => this.compliance.household()?.maxChildren ?? null);
  private readonly _childMaxAge = computed(() => this.compliance.household()?.childMaxAge ?? null);

  public readonly canAddSpouse = computed(() => this.compliance.activeSpouse() === null);
  public readonly childrenLimitReached = computed(() => {
    const max = this._maxChildren();
    return max !== null && this.dependentsCount() >= max;
  });

  /** « Autant que nécessaire », ou ce que la ligne de produit autorise encore. */
  public readonly childLimitHint = computed(() => {
    const max = this._maxChildren();
    const maxAge = this._childMaxAge();
    const count = max === null ? 'Autant que nécessaire' : `Encore ${max - this.dependentsCount()} sur ${max}`;
    return maxAge === null ? count : `${count} · moins de ${maxAge} ans`;
  });

  public memberLine(member: HouseholdMemberView): string {
    const parts = [member.type === 'Spouse' ? 'Conjoint' : member.typeLabel];
    if (member.type === 'Spouse' && member.unionLabel) parts.push(member.unionLabel.toLowerCase());
    if (member.age !== null) parts.push(`${member.age} ans`);
    return parts.join(' · ');
  }

  // ——— Ressources du foyer ———

  public readonly resources = computed(() => this.compliance.household()?.resources ?? null);
  /** La devise des ressources déjà déclarées, sinon la monnaie de l'institution. */
  public readonly resourcesCurrency = computed(() => this.resources()?.currency ?? this._tenant.currency());
  public readonly resourcesUnit = computed(() => currencyUnit(this.resourcesCurrency()));

  public resourcesModel = signal(HouseholdResourcesFormModel.fromDto(null));
  public resourcesForm = form(this.resourcesModel, (schema) => {
    readonly(schema, { when: () => !this.canEdit() });
    for (const path of [schema.monthlyIncome, schema.housingCost, schema.otherDebts]) {
      validate(path, (ctx) => (Number.isNaN(parseAmount(ctx.value())) ? AMOUNT_ERROR : null));
    }
  });

  /** Recalculé à la frappe : l'estimation se lit avant d'enregistrer. */
  public readonly budget = computed(() => {
    const value = this.resourcesModel();
    return householdBudget(
      parseAmount(value.monthlyIncome),
      parseAmount(value.housingCost),
      parseAmount(value.otherDebts),
    );
  });

  /** Moins d'un tiers engagé se lit bien, au-delà de la moitié le foyer est déjà chargé. */
  public readonly commitmentTone = computed(() => {
    const percent = this.budget()?.commitmentPercent ?? 0;
    if (percent > 50) return 'text-red-700';
    if (percent > 33) return 'text-amber-700';
    return 'text-green-700';
  });

  constructor() {
    // Reposé à chaque relecture du foyer, sauf pendant une saisie : la coque relit la fiche après
    // chaque action, et effacer ce que l'agent tape serait pire qu'afficher une valeur d'il y a 30 s.
    effect(() => {
      const resources = this.resources();
      untracked(() => {
        if (this.resourcesForm().dirty()) return;
        this.resourcesModel.set(HouseholdResourcesFormModel.fromDto(resources));
      });
    });
  }

  public cancelResources(): void {
    this.resourcesForm().reset(HouseholdResourcesFormModel.fromDto(this.resources()));
  }

  public saveResources(): void {
    submit(this.resourcesForm, async (field) => {
      const leadId = this.compliance.leadId();
      if (!leadId) return;
      const value = field().value();
      const saved = await firstValueFrom(
        this._leadsApi.setLeadHouseholdResources(leadId, {
          monthlyIncome: parseAmount(value.monthlyIncome),
          housingCost: parseAmount(value.housingCost),
          otherDebts: parseAmount(value.otherDebts),
          currency: this.resourcesCurrency(),
          expectedUpdatedAt: this.lead()?.updatedAt ?? null,
        }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!saved) return;
      this._snackbar.success('Ressources enregistrées', 'Les ressources du foyer sont à jour.');
      this.resourcesForm().reset();
      // Le foyer et le lead : le second porte le jeton de concurrence que la prochaine écriture enverra.
      this._context.reload();
    });
  }

  // ——— Actions sur les personnes ———

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

  private _principalAddressLabel(): string {
    const address = this.lead()?.address;
    const parts = [address?.addressLine, address?.neighbourhood, address?.city, address?.countryCode]
      .filter((part) => !!part?.trim());
    return parts.length > 0 ? parts.join(', ') : 'Adresse non renseignée';
  }

  private _openMemberDrawer(memberType: 'Spouse' | 'Child', member: HouseholdMemberView | null): void {
    const leadId = this.compliance.leadId();
    if (!leadId || !this.canEdit()) return;

    const data: HouseholdMemberDrawerData = {
      scope: 'lead',
      ownerId: leadId,
      memberType,
      member,
      principalAddressLabel: this._principalAddressLabel(),
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
   * Un principal déclaré PPE expose son foyer : BNF-F-04 veut qu'on le propose, pas qu'on
   * l'applique d'office — et le lien reste modifiable personne par personne.
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

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return "Vous n'êtes pas autorisé à modifier ce foyer : le lead doit vous être assigné ou délégué.";
    }
    if (error.status === 409) {
      return 'La fiche a été modifiée entre-temps. Rechargez la page avant de réessayer.';
    }
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors ? Object.values(validationErrors).flat()[0] : undefined;
    return firstError ?? error.error?.title ?? "Impossible d'enregistrer les ressources du foyer.";
  }
}

export default LeadFoyer;
