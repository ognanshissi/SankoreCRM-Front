import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TasCard } from '@talisoft/ui/card';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { FatcaDeclarationDto, MissingFatcaDeclaration } from '@sankore/crm-api';
import {
  ComplianceConfigService,
  fatcaDocumentationLabel,
  fatcaIndiciaLabel,
  FatcaStatusBadge,
  householdMemberTypeLabel,
  identityLabel,
  isFatcaActionable,
  PepExposureBadge,
  pepFromDto,
  pepLinkLabel,
  PERMISSIONS,
  PermissionsService,
} from '@sankore/crm/common';
import { LeadComplianceStore } from './lead-compliance-store';
import { LeadEditContext } from './lead-edit-context';
import {
  FatcaDeclarationDrawer,
  FatcaDeclarationDrawerData,
} from './fatca-declaration-drawer';

/** Une personne du dossier et sa position FATCA, telle que l'onglet l'affiche. */
export interface FatcaSubjectRow {
  rowId: string;
  /** Code de sujet attendu par l'API en écriture. */
  subjectType: string;
  subjectId: string;
  label: string;
  roleLabel: string;
  declaration: FatcaDeclarationDto | null;
  status: string | null;
  documentationLabel: string;
  declaredIndicia: string[];
  signedAt: string | null;
  requiresComplianceReview: boolean;
  missingReason: string | null;
  isPrincipal: boolean;
  /** L'API n'attend pas de déclaration pour cette personne. */
  notRequired: boolean;
}

/**
 * Onglet « Conformité » de la fiche lead : la déclaration FATCA de chaque
 * personne du dossier (BNF-F-05), et le rappel en lecture seule du statut PPE du
 * principal (BNF-F-04, saisi dans l'onglet Foyer).
 *
 * L'écran ne calcule aucun statut : il affiche ce que `GET /leads/{id}/fatca`
 * renvoie et recharge après chaque écriture. La seule règle qu'il porte est une
 * règle d'interface — ouvrir le parcours de documentation dès qu'un indice est
 * déclaré — et elle vit dans le drawer.
 */
@Component({
  selector: 'lead-conformite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './conformite.html',
  imports: [
    DatePipe,
    RouterLink,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    TasTable,
    Button,
    Anchor,
    FatcaStatusBadge,
    PepExposureBadge,
  ],
})
export class LeadConformite {
  protected readonly compliance = inject(LeadComplianceStore);
  private readonly _leadEditContext = inject(LeadEditContext);
  private readonly _permissions = inject(PermissionsService);
  private readonly _complianceConfig = inject(ComplianceConfigService);
  private readonly _sideDrawerService = inject(SideDrawerService);

  private readonly _canUpdate = this._permissions.can(PERMISSIONS.LEAD_UPDATE);

  /** Le détail de la fonction PPE est protégé ; l'exposition, elle, est toujours visible. */
  public readonly canReadPep = this._permissions.can(PERMISSIONS.CUSTOMERS_PEP_READ);
  /**
   * Vigilance PPE du tenant (`pepEnabled` des réglages de conformité). Désactivée, aucun bloc
   * PPE n'est proposé : ni badge, ni détail, ni saisie.
   */
  public readonly pepEnabled = this._complianceConfig.pepEnabled;


  public readonly canDeclare = computed(
    () => this._canUpdate() && !this._leadEditContext.isReadOnly(),
  );

  public readonly isRetrying = signal(false);

  public readonly fatcaEnabled = computed(() => this.compliance.fatcaEnabled());

  /**
   * Le store retombe sur `null` quand une ressource échoue sans emporter les
   * autres : FATCA peut donc être indisponible alors que l'onglet s'affiche.
   */
  public readonly fatcaUnavailable = computed(
    () => !this.compliance.isLoading() && this.compliance.fatca() === null,
  );

  public readonly isComplete = computed(() => this.compliance.fatca()?.isComplete === true);
  public readonly requiredAtEnrichment = computed(
    () => this.compliance.fatca()?.requiredAtEnrichment === true,
  );

  public readonly rows = computed<FatcaSubjectRow[]>(() => {
    const fatca = this.compliance.fatca();
    if (!fatca) return [];

    // Seules les déclarations actives comptent : une déclaration remplacée reste
    // dans la charge utile et afficherait un statut périmé.
    const declarations = (fatca.declarations ?? []).filter((d) => d.isActive !== false);
    const missing = fatca.missing ?? [];
    const leadId = this.compliance.leadId() ?? '';
    const rows: FatcaSubjectRow[] = [];
    const seen = new Set<string>();

    const principalDeclaration =
      declarations.find((d) => d.subjectType === 'Principal') ?? null;
    const principalMissing = missing.find((m) => m.subjectType === 'Principal') ?? null;
    rows.push(
      this._buildRow({
        roleLabel: 'Prospect principal',
        fallbackLabel: this.compliance.principalLabel(),
        // `Principal` est le code que l'API renvoie pour le sujet principal ; son
        // identifiant, lui, n'est connu qu'une fois une déclaration ou un
        // manquant reçu — avant ça on repart de l'identifiant du lead.
        fallbackSubjectType: 'Principal',
        fallbackSubjectId: leadId,
        declaration: principalDeclaration,
        missing: principalMissing,
        isPrincipal: true,
      }),
    );
    if (principalDeclaration?.subjectId) seen.add(principalDeclaration.subjectId);
    if (principalMissing?.subjectId) seen.add(principalMissing.subjectId);

    for (const member of this.compliance.members()) {
      const memberId = member.memberId ?? '';
      rows.push(
        this._buildRow({
          roleLabel: householdMemberTypeLabel(member.type),
          fallbackLabel: identityLabel(member.identity),
          fallbackSubjectType: member.type ?? '',
          fallbackSubjectId: memberId,
          declaration: declarations.find((d) => d.subjectId === memberId) ?? null,
          missing: missing.find((m) => m.subjectId === memberId) ?? null,
        }),
      );
      if (memberId) seen.add(memberId);
    }

    // Un sujet que l'API déclare et que le foyer ne porte pas — co-titulaire,
    // membre retiré encore suivi — ne doit pas disparaître de l'écran.
    for (const entry of [...declarations, ...missing]) {
      const subjectId = entry.subjectId ?? '';
      if (!subjectId || seen.has(subjectId)) continue;
      seen.add(subjectId);
      rows.push(
        this._buildRow({
          roleLabel: householdMemberTypeLabel(entry.subjectType),
          fallbackLabel: entry.subjectLabel ?? 'Personne sans nom',
          fallbackSubjectType: entry.subjectType ?? '',
          fallbackSubjectId: subjectId,
          declaration: declarations.find((d) => d.subjectId === subjectId) ?? null,
          missing: missing.find((m) => m.subjectId === subjectId) ?? null,
        }),
      );
    }

    return rows;
  });

  public readonly missingCount = computed(
    () => this.rows().filter((r) => !r.declaration && !r.notRequired).length,
  );
  public readonly actionableCount = computed(
    () => this.rows().filter((r) => isFatcaActionable(r.status)).length,
  );

  public readonly principalFatcaStatus = computed(() => this.compliance.principalFatcaStatus());

  // ——— Rappel PPE du principal, en lecture seule ———

  public readonly principalPep = computed(() =>
    pepFromDto(this.compliance.household()?.principalPep),
  );
  public readonly principalPepExposed = computed(
    () => this.compliance.household()?.principalIsPepExposed === true,
  );
  public readonly principalPepLinkLabel = computed(() =>
    pepLinkLabel(this.principalPep().link),
  );
  public readonly foyerLink = computed(() => ['/leads', this.compliance.leadId() ?? '', 'identite']);

  /**
   * Pagination désactivée : un dossier tient sur un écran et l'API renvoie
   * toutes les personnes d'un coup.
   */
  public readonly tableConfig: TableConfig = {
    property: 'rows',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 50,
      pageSizeOptions: [50],
    },
  };

  public retry(): void {
    this.isRetrying.set(true);
    this.compliance.reloadFatca().subscribe({
      next: () => this.isRetrying.set(false),
      error: () => this.isRetrying.set(false),
      complete: () => this.isRetrying.set(false),
    });
  }

  public openDeclaration(row: FatcaSubjectRow): void {
    const leadId = this.compliance.leadId();
    if (!leadId || !row.subjectType || !row.subjectId) return;

    const data: FatcaDeclarationDrawerData = {
      leadId,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectLabel: row.label,
      declaration: row.declaration,
    };

    const ref = this._sideDrawerService.open(FatcaDeclarationDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((saved) => {
      if (!saved) return;
      // Deux rechargements et non un : le badge de l'en-tête lit `fatca()`, la
      // jauge de complétude lit `completeness()`, et le statut FATCA est calculé
      // par l'API — un 201 ne dit rien de ce qu'elle a conclu.
      this.compliance.reloadFatca().subscribe();
      this.compliance.reloadCompleteness().subscribe();
    });
  }

  public indiciaLabel(key: string): string {
    return fatcaIndiciaLabel(key);
  }

  private _buildRow(input: {
    roleLabel: string;
    fallbackLabel: string;
    fallbackSubjectType: string;
    fallbackSubjectId: string;
    declaration: FatcaDeclarationDto | null;
    missing: MissingFatcaDeclaration | null;
    isPrincipal?: boolean;
  }): FatcaSubjectRow {
    const { declaration, missing } = input;
    const subjectType =
      declaration?.subjectType ?? missing?.subjectType ?? input.fallbackSubjectType;
    const subjectId = declaration?.subjectId ?? missing?.subjectId ?? input.fallbackSubjectId;
    const label =
      declaration?.subjectLabel?.trim() ||
      missing?.subjectLabel?.trim() ||
      input.fallbackLabel;

    return {
      rowId: `${subjectType}:${subjectId}`,
      subjectType: subjectType ?? '',
      subjectId: subjectId ?? '',
      label,
      roleLabel: input.roleLabel,
      declaration,
      status: declaration?.status ?? null,
      documentationLabel: fatcaDocumentationLabel(declaration?.documentation),
      declaredIndicia: declaration?.declaredIndicia ?? [],
      signedAt: declaration?.signedAt ?? null,
      requiresComplianceReview: declaration?.requiresComplianceReview === true,
      missingReason: missing?.reason ?? null,
      isPrincipal: input.isPrincipal === true,
      // Ni déclaration ni manquant : l'API n'attend rien pour cette personne. Le
      // principal échappe à la règle — FATCA activé, sa déclaration est l'objet
      // même de l'onglet, et l'API peut ne la réclamer qu'à la conversion.
      notRequired: !declaration && !missing && input.isPrincipal !== true,
    };
  }
}

export default LeadConformite;
