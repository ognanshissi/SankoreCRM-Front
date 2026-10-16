import { TelephonyDirectoryDto, TelephonyUserLinkDto, UserDto } from '@sankore/crm-api';
import {
  agencyOptions,
  brokenLinkCount,
  buildUserLinkRows,
  filterUserLinkRows,
  isProposalApplicable,
  isValidCallerNumber,
  userLinkStateLabel,
} from './user-link-presentation';

/**
 * Le recoupement « rattachements + annuaire » porte quatre règles dont aucune ne doit
 * régresser, parce que chacune a une conséquence visible et fausse si elle lâche :
 *
 * 1. Sans annuaire (fournisseur injoignable), les rattachements restent affichés. Une
 *    liste construite depuis l'annuaire seul affichait une page vide, dont on concluait
 *    que tous les postes étaient détachés.
 * 2. Un compte déjà rattaché ne produit qu'UNE ligne, pas deux (la nôtre et celle de
 *    l'annuaire).
 * 3. Une proposition vers un compte CRM désactivé n'est jamais validable : le serveur la
 *    refuse, et le bouton transformerait l'explication en 422.
 * 4. Le badge compte les rattachements CASSÉS, jamais les comptes non liés de l'annuaire.
 */

const link = (over: Partial<TelephonyUserLinkDto> = {}): TelephonyUserLinkDto => ({
  id: 'link-1',
  crmUserId: 'user-1',
  crmUserName: 'Awa Koné',
  externalUserId: 'ext-1',
  externalEmail: 'awa@banque.ci',
  defaultCallerNumber: '+2252012345678',
  status: 'Active',
  statusReason: null,
  linkedAt: '2026-01-05T08:00:00Z',
  version: 1,
  ...over,
});

const directory = (over: Partial<TelephonyDirectoryDto> = {}): TelephonyDirectoryDto => ({
  entries: [],
  ambiguousEmails: [],
  ...over,
});

const users: Record<string, UserDto> = {
  'user-1': { id: 'user-1', fullName: 'Awa Koné', agencyName: 'Agence Plateau' },
  'user-2': { id: 'user-2', fullName: 'Bakary Traoré', agencyName: 'Agence Cocody' },
};

describe('buildUserLinkRows', () => {
  it('garde les rattachements quand l’annuaire est indisponible', () => {
    const rows = buildUserLinkRows({
      links: [link(), link({ id: 'link-2', crmUserId: 'user-2', externalUserId: 'ext-2', status: 'Broken' })],
      directory: null,
      usersById: users,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].state).toBe('Linked');
    expect(rows[1].state).toBe('Broken');
    // Ni « actif chez le fournisseur » ni « inconnu du fournisseur » : on n'a pas pu demander.
    expect(rows[0].isActiveAtProvider).toBeNull();
    expect(rows[0].knownAtProvider).toBeNull();
  });

  it('ne duplique pas un compte déjà rattaché présent dans l’annuaire', () => {
    const rows = buildUserLinkRows({
      links: [link()],
      directory: directory({
        entries: [
          {
            externalUserId: 'ext-1',
            email: 'awa@banque.ci',
            displayName: 'Awa K.',
            isActiveAtProvider: true,
            linkedCrmUserId: 'user-1',
          },
        ],
      }),
      usersById: users,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].linkId).toBe('link-1');
    expect(rows[0].isActiveAtProvider).toBe(true);
    expect(rows[0].agencyName).toBe('Agence Plateau');
  });

  it('signale un rattachement que le fournisseur ne liste plus', () => {
    const rows = buildUserLinkRows({
      links: [link({ status: 'Broken', statusReason: 'Compte absent du fournisseur' })],
      directory: directory({ entries: [] }),
      usersById: users,
    });

    expect(rows[0].knownAtProvider).toBe(false);
    expect(rows[0].isActiveAtProvider).toBe(false);
    expect(rows[0].statusReason).toBe('Compte absent du fournisseur');
  });

  it('distingue proposition, proposition inexploitable et compte non lié', () => {
    const rows = buildUserLinkRows({
      links: [],
      directory: directory({
        entries: [
          {
            externalUserId: 'ext-2',
            email: 'bakary@banque.ci',
            isActiveAtProvider: true,
            proposedCrmUserId: 'user-2',
            proposedCrmUserName: 'Bakary Traoré',
            proposedCrmUserIsDisabled: false,
          },
          {
            externalUserId: 'ext-3',
            email: 'parti@banque.ci',
            isActiveAtProvider: true,
            proposedCrmUserId: 'user-9',
            proposedCrmUserName: 'Compte parti',
            proposedCrmUserIsDisabled: true,
          },
          { externalUserId: 'ext-4', email: 'standard@banque.ci', isActiveAtProvider: true },
        ],
        ambiguousEmails: ['standard@banque.ci'],
      }),
      usersById: users,
    });

    expect(rows.map((row) => row.state)).toEqual(['Proposed', 'Proposed', 'Unlinked']);
    expect(isProposalApplicable(rows[0])).toBe(true);
    expect(isProposalApplicable(rows[1])).toBe(false);
    expect(isProposalApplicable(rows[2])).toBe(false);
    // L'e-mail que le serveur a refusé de deviner est marqué sur la ligne.
    expect(rows[2].isAmbiguous).toBe(true);
    expect(rows[0].isAmbiguous).toBe(false);
  });

  it('masque le numéro d’appelant et conserve la valeur brute pour la saisie', () => {
    const rows = buildUserLinkRows({ links: [link()], directory: null, usersById: {} });

    expect(rows[0].callerNumber).toBe('•••• 5678');
    expect(rows[0].rawCallerNumber).toBe('+2252012345678');
  });

  it('rend un statut serveur inédit comme un rattachement à vérifier', () => {
    const rows = buildUserLinkRows({
      links: [link({ status: 'Quarantined' as never })],
      directory: null,
      usersById: {},
    });

    expect(rows[0].state).toBe('Broken');
    // Et la table de libellés reste tolérante pour tout autre code.
    expect(userLinkStateLabel('Quarantined')).toBe('Point à vérifier');
  });
});

describe('brokenLinkCount', () => {
  it('ne compte que les rattachements cassés', () => {
    expect(
      brokenLinkCount([
        link(),
        link({ id: 'link-2', status: 'Broken' }),
        link({ id: 'link-3', status: 'Disabled' }),
        link({ id: 'link-4', status: 'Broken' }),
      ]),
    ).toBe(2);
    expect(brokenLinkCount([])).toBe(0);
  });
});

describe('isValidCallerNumber', () => {
  it('accepte le vide, qui efface la surcharge', () => {
    expect(isValidCallerNumber('')).toBe(true);
    expect(isValidCallerNumber('   ')).toBe(true);
    expect(isValidCallerNumber(null)).toBe(true);
  });

  it('n’accepte que du E.164', () => {
    expect(isValidCallerNumber('+2252012345678')).toBe(true);
    expect(isValidCallerNumber('+33123456789')).toBe(true);
    expect(isValidCallerNumber('0701020304')).toBe(false);
    expect(isValidCallerNumber('+225 20 12 34 56')).toBe(false);
    expect(isValidCallerNumber('+0123456789')).toBe(false);
    expect(isValidCallerNumber('+1234567')).toBe(false);
    expect(isValidCallerNumber('+1234567890123456')).toBe(false);
  });
});

describe('filtres et agences', () => {
  const rows = buildUserLinkRows({
    links: [link(), link({ id: 'link-2', crmUserId: 'user-2', externalUserId: 'ext-2', externalEmail: 'bakary@banque.ci', crmUserName: 'Bakary Traoré', status: 'Broken' })],
    directory: null,
    usersById: users,
  });

  it('filtre sur l’état, l’agence et la recherche', () => {
    expect(filterUserLinkRows(rows, { state: 'Broken', agency: null, search: '' })).toHaveLength(1);
    expect(filterUserLinkRows(rows, { state: null, agency: 'Agence Cocody', search: '' })).toHaveLength(1);
    expect(filterUserLinkRows(rows, { state: null, agency: null, search: 'awa@' })).toHaveLength(1);
    expect(filterUserLinkRows(rows, { state: null, agency: null, search: 'INTROUVABLE' })).toHaveLength(0);
    expect(filterUserLinkRows(rows, { state: null, agency: null, search: '  ' })).toHaveLength(2);
  });

  it('ne propose que les agences réellement présentes', () => {
    expect(agencyOptions(rows).map((option) => option.value)).toEqual([
      'Agence Cocody',
      'Agence Plateau',
    ]);
    expect(agencyOptions([])).toEqual([]);
  });
});
