import { HttpErrorResponse } from '@angular/common/http';
import {
  JOURNAL_DIRECTIONS,
  JOURNAL_STATUSES,
  callDurationLabel,
  endOfDayIso,
  isAttachmentSettled,
  isUuid,
  journalErrorMessage,
  knownFilterValue,
  looksQualifiable,
  parsedErrorBody,
  secondsLabel,
  startOfDayIso,
} from './journal-presentation';

/**
 * Seules les fonctions PURES de présentation sont testées : l'écran lui-même n'a pas de
 * spec, comme le reste du dépôt. Ce qui est vérifié ici est ce qui se casse sans bruit.
 *
 * 1. Une durée nulle, négative ou absente ne doit jamais rendre « NaN » ni « 0:0 » dans
 *    une cellule, et la sonnerie ne doit jamais être confondue avec la conversation.
 * 2. Un paramètre d'URL hors vocabulaire est écarté au lieu de partir au serveur, qui
 *    refuserait la requête entière et ferait paraître le filtre actif.
 * 3. Le refus de l'export arrive avec un corps TEXTE et non JSON, parce que le contrat
 *    annonce `text/csv` : sans relecture, chaque refus tomberait dans le message de repli.
 */
describe('Journal — durées', () => {
  it('rend les trois paliers de secondes', () => {
    expect(secondsLabel(0)).toBe('0 s');
    expect(secondsLabel(45)).toBe('45 s');
    expect(secondsLabel(59)).toBe('59 s');
    // « 1 min » et non « 1 min 00 s » : la mise en forme est désormais celle du référentiel,
    // partagée par les trois écrans, et elle élide un reste de zéro seconde. Avant la mise en
    // commun, la même durée s'affichait « 2 min » sur le tableau de bord et « 2 min 00 s »
    // ici — un superviseur comparant un chiffre avec la ligne qui le produit voyait deux
    // écritures.
    expect(secondsLabel(60)).toBe('1 min');
    expect(secondsLabel(65)).toBe('1 min 05 s');
    expect(secondsLabel(185)).toBe('3 min 05 s');
    // « 1 h » et non « 1 h 00 min », par la même élision du reste nul qu'aux minutes.
    expect(secondsLabel(3600)).toBe('1 h');
    expect(secondsLabel(3660)).toBe('1 h 01 min');
    expect(secondsLabel(3725)).toBe('1 h 02 min');
  });

  it('ne rend jamais NaN ni une durée négative', () => {
    expect(secondsLabel(null)).toBe('—');
    expect(secondsLabel(undefined)).toBe('—');
    expect(secondsLabel(Number.NaN)).toBe('—');
    expect(secondsLabel(-5)).toBe('—');
  });

  it('affiche la conversation quand il y en a eu une', () => {
    expect(callDurationLabel({ talkSeconds: 95, ringSeconds: 12 })).toBe('1 min 35 s');
  });

  it('affiche la sonnerie quand personne n’a décroché', () => {
    expect(callDurationLabel({ talkSeconds: 0, ringSeconds: 22 })).toBe('sonnerie 22 s');
    expect(callDurationLabel({ talkSeconds: null, ringSeconds: 0 })).toBe('sonnerie 0 s');
  });

  it('ne rend rien d’inventé quand le serveur n’a donné aucune durée', () => {
    expect(callDurationLabel({ talkSeconds: null, ringSeconds: null })).toBe('—');
    expect(callDurationLabel({})).toBe('—');
  });
});

describe('Journal — paramètres d’URL', () => {
  it('ne retient qu’une valeur du vocabulaire', () => {
    expect(knownFilterValue('Inbound', JOURNAL_DIRECTIONS)).toBe('Inbound');
    expect(knownFilterValue('Completed', JOURNAL_STATUSES)).toBe('Completed');
  });

  it('écarte une valeur inconnue, vide ou prise dans une autre liste', () => {
    expect(knownFilterValue('Rejected', JOURNAL_STATUSES)).toBeNull();
    expect(knownFilterValue('Inbound', JOURNAL_STATUSES)).toBeNull();
    expect(knownFilterValue('', JOURNAL_DIRECTIONS)).toBeNull();
    expect(knownFilterValue(undefined, JOURNAL_DIRECTIONS)).toBeNull();
  });

  it('valide la forme d’un uuid avant de l’envoyer', () => {
    expect(isUuid('0b7d1f1a-2c3b-4d5e-8f90-1a2b3c4d5e6f')).toBe(true);
    expect(isUuid('  0B7D1F1A-2C3B-4D5E-8F90-1A2B3C4D5E6F ')).toBe(true);
    expect(isUuid('pas-un-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it('borne la journée aux deux extrémités', () => {
    // Sans ces bornes, « au 12 mars » exclurait toute la journée du 12.
    const from = startOfDayIso('2026-03-12');
    const to = endOfDayIso('2026-03-12');
    expect(from).toBeDefined();
    expect(to).toBeDefined();
    expect(Date.parse(to as string) - Date.parse(from as string)).toBe(86_399_999);
    expect(startOffDay()).toBeUndefined();
  });
});

function startOffDay(): string | undefined {
  return startOfDayIso(null);
}

describe('Journal — état d’une ligne', () => {
  it('ne considère tranché qu’un rattachement effectif ou un appel interne', () => {
    expect(isAttachmentSettled({ matchStatus: 'Matched', entityId: 'x' })).toBe(true);
    expect(isAttachmentSettled({ matchStatus: 'Internal' })).toBe(true);
    // Un `Matched` sans identifiant est exactement le cas qu'il ne faut pas tenir pour
    // réglé : la ligne resterait sans action alors qu'elle en demande une.
    expect(isAttachmentSettled({ matchStatus: 'Matched' })).toBe(false);
    expect(isAttachmentSettled({ matchStatus: 'Ambiguous', entityId: 'x' })).toBe(false);
    expect(isAttachmentSettled({ matchStatus: 'Unknown' })).toBe(false);
    expect(isAttachmentSettled({})).toBe(false);
  });

  it('ne propose la qualification que sur un appel terminé et non traité', () => {
    expect(looksQualifiable({ endedAt: '2026-03-12T10:00:00Z' })).toBe(true);
    expect(looksQualifiable({})).toBe(false);
    expect(
      looksQualifiable({ endedAt: '2026-03-12T10:00:00Z', wrappedUpAt: '2026-03-12T10:05:00Z' }),
    ).toBe(false);
    expect(
      looksQualifiable({ endedAt: '2026-03-12T10:00:00Z', dismissedAt: '2026-03-12T10:05:00Z' }),
    ).toBe(false);
  });
});

describe('Journal — messages d’erreur', () => {
  it('relit un corps d’erreur arrivé en texte', () => {
    const raw = { error: JSON.stringify({ error: 'TELEPHONY_CALL_NOT_FOUND' }) } as HttpErrorResponse;
    const parsed = parsedErrorBody(raw);
    expect((parsed.error as { error: string }).error).toBe('TELEPHONY_CALL_NOT_FOUND');
  });

  it('laisse intact un corps qui n’est pas du JSON', () => {
    const raw = { error: 'Bad Gateway' } as HttpErrorResponse;
    expect(parsedErrorBody(raw).error).toBe('Bad Gateway');
  });

  it('traduit le refus de l’export en « resserrez la période », pas en panne', () => {
    const raw = {
      status: 422,
      error: JSON.stringify({ error: 'TELEPHONY_EXPORT_TOO_LARGE' }),
    } as HttpErrorResponse;
    const message = journalErrorMessage(raw, 'repli');
    expect(message).toContain('20 000');
    expect(message).toContain('Resserrez');
    expect(message).not.toBe('repli');
  });

  it('délègue au référentiel pour les refus qu’il connaît déjà', () => {
    const raw = {
      status: 404,
      error: { error: 'TELEPHONY_CALL_NOT_FOUND' },
    } as unknown as HttpErrorResponse;
    expect(journalErrorMessage(raw, 'repli')).toContain("Cet appel n'existe pas");
  });

  it('retombe sur le message de repli de l’appelant pour un code inédit', () => {
    const raw = { status: 500, error: { error: 'TELEPHONY_SOMETHING_NEW' } } as HttpErrorResponse;
    expect(journalErrorMessage(raw, 'repli')).toBe('repli');
  });
});
