import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasTag } from '@talisoft/ui/tag';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  CustomersHouseholdMemberDto,
  DesignationDto,
  DesignationInput,
  DesignationRoleDefinition,
} from '@sankore/crm-api';
import {
  HouseholdMemberDrawer,
  HouseholdMemberDrawerData,
  designationRoleLabel,
  designationStatusLabel,
  identityLabel,
  isDesignationToReview,
} from '@sankore/crm/common';
import { ClientHouseholdStore } from '../../models/client-household.store';

/**
 * Ce que l'éditeur rend à son appelant : la clause prête à partir, et de quoi
 * décider si le bouton d'enregistrement s'active.
 */
export interface DesignationsDraft {
  designations: DesignationInput[];
  isValid: boolean;
  /** Phrases en français, affichables telles quelles sous le formulaire. */
  problems: string[];
}

/**
 * Totaux par rang, affichés et contrôlés à 100 % (BNF-F-11).
 *
 * L'arbitrage final reste au serveur : ce contrôle n'est là que pour éviter
 * d'envoyer une clause qu'on sait déjà fausse.
 */
export interface RankTotal {
  rank: number;
  total: number;
  isComplete: boolean;
}

/** Une personne désignable, cochée ou non. */
interface SubjectRow {
  /** Clé stable de la ligne : identifiant du membre, du client, ou `ext:n`. */
  key: string;
  label: string;
  sublabel: string | null;
  subjectType: string;
  subjectId: string | null;
  isExternal: boolean;
  externalFullName: string;
  externalRelationship: string;
  selected: boolean;
  roleCode: string;
  /** Saisis en chaîne : les `input` rendent du texte, la conversion se fait à l'envoi. */
  rank: string;
  sharePercent: string;
  /** Statut renvoyé par l'API pour une désignation déjà enregistrée. */
  status: string | null;
  statusReason: string | null;
  /** La personne n'est plus dans le foyer mais reste désignée. */
  isOrphan: boolean;
}

/** Les deux conventions possibles d'identification d'un sujet, cf. `_inferSubjectTypes`. */
const DEFAULT_MEMBER_SUBJECT_TYPE = 'HouseholdMember';
const DEFAULT_CLIENT_SUBJECT_TYPE = 'Client';
const DEFAULT_EXTERNAL_SUBJECT_TYPE = 'External';

/**
 * Éditeur de clause bénéficiaire, partagé par la souscription (BNF-F-11) et par
 * l'avenant d'un produit actif (BNF-F-12).
 *
 * Deux choses sont volontairement absentes :
 *
 * 1. **Aucun rôle en dur.** Les rôles proposés sont ceux de la politique de la
 *    ligne de produit (`BeneficiaryPolicy.allowedRoles`), avec leurs cardinalités
 *    et leur drapeau « les quotes-parts doivent totaliser 100 % ». Le front n'en
 *    invente aucun et n'en masque aucun.
 * 2. **Aucune signal form.** C'est l'exception prévue : un éditeur de collection
 *    dynamique dont les lignes naissent et meurent au fil des cases cochées se
 *    pilote en signaux, pas en `form()` — le schéma devrait être reconstruit à
 *    chaque ajout de membre.
 *
 * Le foyer vient de `ClientHouseholdStore`, fourni par la coquille de la fiche :
 * « Ajouter au foyer » ouvre le drawer partagé puis recharge le store, et la
 * nouvelle personne apparaît dans les cases à cocher sans quitter le parcours.
 *
 * Il n'y a **pas** d'entrée `householdEnabled` : « Ajouter au foyer » s'affiche quelle
 * que soit la ligne de produit. Elle existait et masquait les deux boutons quand
 * `beneficiaryPolicy.householdEnabled` était faux — c'est-à-dire par défaut, la case
 * n'étant pas cochée à la création d'une politique — alors qu'aucun contrôle serveur ne
 * s'y rattache : `DesignationSubjectValidator` vérifie que le sujet est un membre actif
 * du foyer ou un client du tenant, et rien de plus. Les boutons étaient donc cachés sans
 * que l'écriture correspondante soit refusée. Ne remets pas de condition de produit ici.
 */
@Component({
  selector: 'designations-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './designations-editor.html',
  imports: [
    FormsModule,
    Button,
    TasIcon,
    TasInput,
    TasSelect,
    TasTag,
    TasFormField,
    TasLabel,
  ],
})
export class DesignationsEditor {
  private readonly _household = inject(ClientHouseholdStore);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _injector = inject(Injector);

  public readonly clientId = input.required<string>();
  /** Rôles autorisés par la ligne de produit. Vide = politique non chargée. */
  public readonly roles = input<DesignationRoleDefinition[]>([]);
  /** Clause en vigueur, rejouée à l'ouverture (avenant) ou vide (souscription). */
  public readonly initial = input<DesignationDto[]>([]);
  public readonly readOnly = input(false);

  public readonly members = computed(() => this._household.members());
  public readonly principalLabel = computed(() => this._household.principalLabel());

  private readonly _externalSeq = signal(0);

  /**
   * Les lignes survivent à un rechargement du foyer : `linkedSignal` reçoit l'état
   * précédent et le reporte ligne par ligne. Sans cela, « Ajouter au foyer » —
   * qui recharge le store — effacerait les cases déjà cochées et les quotes-parts
   * déjà saisies, c'est-à-dire exactement le parcours que l'US veut fluide.
   */
  private readonly _rows = linkedSignal<
    {
      members: CustomersHouseholdMemberDto[];
      initial: DesignationDto[];
      clientId: string;
      principalLabel: string;
    },
    SubjectRow[]
  >({
    source: () => ({
      members: this.members(),
      initial: this.initial(),
      clientId: this.clientId(),
      principalLabel: this.principalLabel(),
    }),
    computation: (source, previous) => this._buildRows(source, previous?.value),
  });

  public readonly rows = this._rows.asReadonly();

  public readonly roleOptions = computed(() =>
    this.roles().map((role) => ({
      label: role.label?.trim() || designationRoleLabel(role.code),
      value: role.code ?? '',
    })),
  );

  public readonly selectedRows = computed(() => this._rows().filter((row) => row.selected));

  /**
   * Totaux par rang, limités aux rôles dont la politique dit que les quotes-parts
   * doivent totaliser 100 %. Un rôle sans ce drapeau n'a pas de total à afficher.
   */
  public readonly rankTotals = computed<RankTotal[]>(() => {
    const totals = new Map<number, number>();
    for (const row of this.selectedRows()) {
      if (!this._roleRequiresShares(row.roleCode)) continue;
      const rank = this._toInt(row.rank) ?? 1;
      const share = this._toNumber(row.sharePercent) ?? 0;
      totals.set(rank, (totals.get(rank) ?? 0) + share);
    }
    return [...totals.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, total]) => ({
        rank,
        total: Math.round(total * 100) / 100,
        isComplete: Math.abs(total - 100) < 0.01,
      }));
  });

  public readonly draft = computed<DesignationsDraft>(() => {
    const selected = this.selectedRows();
    const problems: string[] = [];

    for (const row of selected) {
      const name = row.isExternal ? row.externalFullName.trim() || 'Personne hors foyer' : row.label;
      if (!row.roleCode) {
        problems.push(`Choisissez un rôle pour ${name}.`);
      }
      if (row.isExternal && !row.externalFullName.trim()) {
        problems.push('Renseignez le nom de la personne hors foyer désignée.');
      }
      const rank = this._toInt(row.rank);
      if (rank === null || rank < 1) {
        problems.push(`Le rang de ${name} doit être un entier supérieur ou égal à 1.`);
      }
      if (this._roleRequiresShares(row.roleCode)) {
        const share = this._toNumber(row.sharePercent);
        if (share === null || share <= 0 || share > 100) {
          problems.push(`La quote-part de ${name} doit être comprise entre 1 et 100 %.`);
        }
      }
    }

    for (const total of this.rankTotals()) {
      if (!total.isComplete) {
        problems.push(
          `Le total du rang ${total.rank} est de ${total.total} % : il doit faire exactement 100 %.`,
        );
      }
    }

    // Cardinalités : elles viennent de la politique, le front ne les devine pas.
    for (const role of this.roles()) {
      const code = role.code ?? '';
      const count = selected.filter((row) => row.roleCode === code).length;
      const label = role.label?.trim() || designationRoleLabel(code);
      if (role.minCount !== undefined && count < role.minCount) {
        problems.push(
          `Le rôle « ${label} » attend au moins ${role.minCount} personne(s) ; ${count} désignée(s).`,
        );
      }
      if (role.maxCount !== null && role.maxCount !== undefined && count > role.maxCount) {
        problems.push(
          `Le rôle « ${label} » n'accepte que ${role.maxCount} personne(s) ; ${count} désignée(s).`,
        );
      }
    }

    const designations: DesignationInput[] = selected.map((row) => ({
      roleCode: row.roleCode || null,
      subjectType: row.subjectType,
      subjectId: row.isExternal ? null : row.subjectId,
      externalFullName: row.isExternal ? row.externalFullName.trim() : null,
      externalRelationship: row.externalRelationship.trim() || null,
      rank: this._toInt(row.rank) ?? 1,
      sharePercent: this._roleRequiresShares(row.roleCode)
        ? this._toNumber(row.sharePercent)
        : null,
    }));

    // Dédoublonnage des messages : une clause à cinq lignes fausses ne doit pas
    // afficher cinq fois « le total du rang 1 … ».
    return { designations, isValid: problems.length === 0, problems: [...new Set(problems)] };
  });

  public roleRequiresShares(code: string): boolean {
    return this._roleRequiresShares(code);
  }

  public roleLabel(code: string | null | undefined): string {
    const role = this.roles().find((r) => r.code === code);
    return role?.label?.trim() || designationRoleLabel(code);
  }

  public statusLabel(code: string | null | undefined): string {
    return designationStatusLabel(code);
  }

  public toReview(code: string | null | undefined): boolean {
    return isDesignationToReview(code);
  }

  public toggle(key: string, selected: boolean): void {
    this._patch(key, (row) => ({
      ...row,
      selected,
      // Premier cochage : on pose le rôle s'il n'y en a qu'un, et un rang par défaut.
      roleCode: row.roleCode || this._defaultRoleCode(),
      rank: row.rank || '1',
    }));
  }

  public setRole(key: string, roleCode: string): void {
    this._patch(key, (row) => ({
      ...row,
      roleCode,
      sharePercent: this._roleRequiresShares(roleCode) ? row.sharePercent : '',
    }));
  }

  public setRank(key: string, rank: string): void {
    this._patch(key, (row) => ({ ...row, rank }));
  }

  public setShare(key: string, sharePercent: string): void {
    this._patch(key, (row) => ({ ...row, sharePercent }));
  }

  public setExternalName(key: string, externalFullName: string): void {
    this._patch(key, (row) => ({ ...row, externalFullName }));
  }

  public setExternalRelationship(key: string, externalRelationship: string): void {
    this._patch(key, (row) => ({ ...row, externalRelationship }));
  }

  /** Répartit également les quotes-parts du rang, bouton de confort. */
  public splitRank(rank: number): void {
    const concerned = this.selectedRows().filter(
      (row) => this._roleRequiresShares(row.roleCode) && (this._toInt(row.rank) ?? 1) === rank,
    );
    if (concerned.length === 0) return;
    const share = Math.floor((100 / concerned.length) * 100) / 100;
    const keys = new Set(concerned.map((row) => row.key));
    this._rows.update((rows) =>
      rows.map((row, index) => {
        if (!keys.has(row.key)) return row;
        // Le reste des arrondis va à la première ligne pour que le total fasse 100.
        const isFirst = concerned[0].key === row.key;
        const value = isFirst
          ? Math.round((100 - share * (concerned.length - 1)) * 100) / 100
          : share;
        return { ...row, sharePercent: String(value), rank: String(rank) } as SubjectRow;
      }),
    );
  }

  public addExternal(): void {
    const seq = this._externalSeq() + 1;
    this._externalSeq.set(seq);
    this._rows.update((rows) => [
      ...rows,
      {
        key: `ext:${seq}`,
        label: 'Personne hors foyer',
        sublabel: 'Saisie libre',
        subjectType: DEFAULT_EXTERNAL_SUBJECT_TYPE,
        subjectId: null,
        isExternal: true,
        externalFullName: '',
        externalRelationship: '',
        selected: true,
        roleCode: this._defaultRoleCode(),
        rank: '1',
        sharePercent: '',
        status: null,
        statusReason: null,
        isOrphan: false,
      },
    ]);
  }

  public removeExternal(key: string): void {
    this._rows.update((rows) => rows.filter((row) => row.key !== key));
  }

  /**
   * « Ajouter au foyer » sans quitter le parcours : le drawer partagé de
   * `@sankore/crm/common` écrit le membre, puis le store est rechargé et la
   * personne apparaît dans les cases à cocher — tout est en signaux.
   */
  public openAddMember(memberType: 'Spouse' | 'Child'): void {
    const ref = this._sideDrawer.open<
      boolean,
      HouseholdMemberDrawerData,
      HouseholdMemberDrawer
    >(HouseholdMemberDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: {
        scope: 'client',
        ownerId: this.clientId(),
        memberType,
        member: null,
        principalAddressLabel: this._principalAddressLabel(),
      },
      injector: this._injector,
    });

    ref.closed.subscribe((added) => {
      if (added) this._household.reload().subscribe();
    });
  }

  public hasSpouse(): boolean {
    return this._household.activeSpouse() !== null;
  }

  private _patch(key: string, change: (row: SubjectRow) => SubjectRow): void {
    this._rows.update((rows) => rows.map((row) => (row.key === key ? change(row) : row)));
  }

  private _defaultRoleCode(): string {
    const roles = this.roles();
    return roles.length === 1 ? (roles[0].code ?? '') : '';
  }

  private _roleRequiresShares(code: string | null | undefined): boolean {
    if (!code) return false;
    return this.roles().find((role) => role.code === code)?.sharesMustTotal100 === true;
  }

  private _toInt(value: string): number | null {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private _toNumber(value: string): number | null {
    if (!value?.trim()) return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private _principalAddressLabel(): string {
    const identity = this._household.principal();
    if (!identity) return 'Adresse du client';
    return (
      [identity.addressLine, identity.postalCode, identity.city, identity.countryCode]
        .filter((part) => !!part?.trim())
        .join(', ') || 'Adresse non renseignée'
    );
  }

  /**
   * Le contrat déclare `subjectType` en chaîne libre, sans énumération : on reprend
   * donc celle que l'API a renvoyée pour une désignation existante, et on ne tombe
   * sur une valeur par défaut que pour une personne jamais encore désignée.
   */
  private _inferSubjectTypes(
    initial: DesignationDto[],
    clientId: string,
    memberIds: Set<string>,
  ): { member: string; client: string; external: string } {
    let member = DEFAULT_MEMBER_SUBJECT_TYPE;
    let client = DEFAULT_CLIENT_SUBJECT_TYPE;
    let external = DEFAULT_EXTERNAL_SUBJECT_TYPE;

    for (const designation of initial) {
      const type = designation.subjectType?.trim();
      if (!type) continue;
      if (!designation.subjectId) {
        external = type;
      } else if (designation.subjectId === clientId) {
        client = type;
      } else if (memberIds.has(designation.subjectId)) {
        member = type;
      }
    }

    return { member, client, external };
  }

  private _buildRows(
    source: {
      members: CustomersHouseholdMemberDto[];
      initial: DesignationDto[];
      clientId: string;
      principalLabel: string;
    },
    previous: SubjectRow[] | undefined,
  ): SubjectRow[] {
    const { members, initial, clientId, principalLabel } = source;
    const memberIds = new Set(
      members.map((member) => member.memberId ?? '').filter((id) => !!id),
    );
    const subjectTypes = this._inferSubjectTypes(initial, clientId, memberIds);
    const keep = new Map((previous ?? []).map((row) => [row.key, row]));

    const fromInitial = (subjectId: string | null): DesignationDto | undefined =>
      initial.find(
        (designation) =>
          (designation.subjectId ?? null) === subjectId && designation.validTo == null,
      );

    const rows: SubjectRow[] = [];

    const push = (base: Omit<SubjectRow, 'selected' | 'roleCode' | 'rank' | 'sharePercent'>) => {
      const previousRow = keep.get(base.key);
      const designation = fromInitial(base.subjectId);
      rows.push({
        ...base,
        selected: previousRow?.selected ?? !!designation,
        roleCode: previousRow?.roleCode ?? designation?.roleCode ?? '',
        rank: previousRow?.rank ?? String(designation?.rank ?? 1),
        sharePercent:
          previousRow?.sharePercent ??
          (designation?.sharePercent != null ? String(designation.sharePercent) : ''),
      });
    };

    // Le client lui-même peut porter un rôle (souscripteur, assuré…).
    push({
      key: clientId,
      label: principalLabel || 'Le client',
      sublabel: 'Titulaire',
      subjectType: subjectTypes.client,
      subjectId: clientId,
      isExternal: false,
      externalFullName: '',
      externalRelationship: '',
      status: fromInitial(clientId)?.status ?? null,
      statusReason: fromInitial(clientId)?.statusReason ?? null,
      isOrphan: false,
    });

    for (const member of members) {
      const memberId = member.memberId ?? '';
      if (!memberId) continue;
      const designation = fromInitial(memberId);
      push({
        key: memberId,
        label: member.displayName?.trim() || identityLabel(member.identity),
        sublabel: [member.type, member.age != null ? `${member.age} ans` : null]
          .filter((part) => !!part)
          .join(' · '),
        subjectType: subjectTypes.member,
        subjectId: memberId,
        isExternal: false,
        externalFullName: '',
        externalRelationship: '',
        status: designation?.status ?? null,
        statusReason: designation?.statusReason ?? null,
        isOrphan: false,
      });
    }

    // Désignations en vigueur dont le sujet n'est plus dans le foyer : elles
    // restent affichées — les perdre silencieusement les supprimerait de la clause
    // au prochain enregistrement, puisque l'API remplace la clause entière.
    for (const designation of initial) {
      if (designation.validTo != null) continue;
      const subjectId = designation.subjectId ?? null;
      if (subjectId && rows.some((row) => row.subjectId === subjectId)) continue;
      const key = subjectId ?? `kept:${designation.designationId ?? rows.length}`;
      const previousRow = keep.get(key);
      rows.push({
        key,
        label: designation.subjectLabel?.trim() || 'Personne désignée',
        sublabel: subjectId ? 'Hors foyer actuel' : 'Personne hors foyer',
        subjectType: designation.subjectType?.trim() || subjectTypes.external,
        subjectId,
        isExternal: !subjectId,
        externalFullName:
          previousRow?.externalFullName ?? (subjectId ? '' : designation.subjectLabel ?? ''),
        externalRelationship:
          previousRow?.externalRelationship ?? designation.externalRelationship ?? '',
        selected: previousRow?.selected ?? true,
        roleCode: previousRow?.roleCode ?? designation.roleCode ?? '',
        rank: previousRow?.rank ?? String(designation.rank ?? 1),
        sharePercent:
          previousRow?.sharePercent ??
          (designation.sharePercent != null ? String(designation.sharePercent) : ''),
        status: designation.status ?? null,
        statusReason: designation.statusReason ?? null,
        isOrphan: !!subjectId,
      });
    }

    // Lignes « hors foyer » ajoutées à la main pendant la session.
    for (const row of previous ?? []) {
      if (row.key.startsWith('ext:') && !rows.some((existing) => existing.key === row.key)) {
        rows.push(row);
      }
    }

    return rows;
  }
}
