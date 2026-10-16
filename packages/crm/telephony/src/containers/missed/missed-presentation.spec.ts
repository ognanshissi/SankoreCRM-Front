import { HttpErrorResponse } from '@angular/common/http';
import {
  MISSED_DEFAULT_SINCE,
  attemptCountLabel,
  attemptWindowLabel,
  knownSinceDays,
  missedContextOf,
  missedErrorMessage,
  missedSinceIso,
} from './missed-presentation';

/**
 * Les trois règles de cet écran qui ne se voient pas en lisant le composant :
 *
 * 1. Une ligne est un GROUPE de tentatives, et son libellé doit distinguer l'appelant qui
 *    a essayé une fois de celui qui a essayé cinq fois en dix minutes — c'est l'ordre de
 *    rappel.
 * 2. `since` ne part pas au serveur quand il vaut déjà son défaut de sept jours : un
 *    paramètre redondant ferait diverger l'URL de la liste sans rien changer.
 * 3. Le contexte est la SEULE source de nom, et un candidat hors périmètre n'en porte
 *    délibérément aucun : la ligne doit le dire au lieu de rester vide.
 */
describe('Appels manqués — regroupement', () => {
  it('nomme le nombre de tentatives au singulier et au pluriel', () => {
    expect(attemptCountLabel(1)).toBe('1 tentative');
    expect(attemptCountLabel(3)).toBe('3 tentatives');
    // Un compteur absent ou absurde ne doit pas rendre « 0 tentatives » ni « NaN ».
    expect(attemptCountLabel(0)).toBe('1 tentative');
    expect(attemptCountLabel(null)).toBe('1 tentative');
    expect(attemptCountLabel(undefined)).toBe('1 tentative');
  });

  it('ne décrit une fenêtre que lorsqu’il y a plusieurs tentatives', () => {
    expect(
      attemptWindowLabel({
        attemptCount: 1,
        firstAttemptAt: '2026-03-12T10:00:00Z',
        lastAttemptAt: '2026-03-12T10:00:00Z',
      }),
    ).toBe('');
  });

  it('échelonne la fenêtre en minutes, heures puis jours', () => {
    expect(
      attemptWindowLabel({
        attemptCount: 3,
        firstAttemptAt: '2026-03-12T10:00:00Z',
        lastAttemptAt: '2026-03-12T10:00:20Z',
      }),
    ).toBe('en moins d’une minute');

    expect(
      attemptWindowLabel({
        attemptCount: 3,
        firstAttemptAt: '2026-03-12T10:00:00Z',
        lastAttemptAt: '2026-03-12T10:12:00Z',
      }),
    ).toBe('sur 12 min');

    expect(
      attemptWindowLabel({
        attemptCount: 4,
        firstAttemptAt: '2026-03-12T08:00:00Z',
        lastAttemptAt: '2026-03-12T13:00:00Z',
      }),
    ).toBe('sur 5 h');

    expect(
      attemptWindowLabel({
        attemptCount: 4,
        firstAttemptAt: '2026-03-10T08:00:00Z',
        lastAttemptAt: '2026-03-13T08:00:00Z',
      }),
    ).toBe('sur 3 j');
  });

  it('ne décrit pas de fenêtre à partir de dates inutilisables', () => {
    expect(attemptWindowLabel({ attemptCount: 3 })).toBe('');
    expect(
      attemptWindowLabel({ attemptCount: 3, firstAttemptAt: 'n’importe quoi', lastAttemptAt: '' }),
    ).toBe('');
    // Dates inversées : on se taît plutôt que d'afficher une durée négative.
    expect(
      attemptWindowLabel({
        attemptCount: 3,
        firstAttemptAt: '2026-03-12T10:00:00Z',
        lastAttemptAt: '2026-03-12T09:00:00Z',
      }),
    ).toBe('');
  });
});

describe('Appels manqués — fenêtre de lecture', () => {
  it('n’envoie pas de `since` quand la valeur est déjà le défaut du serveur', () => {
    expect(missedSinceIso(MISSED_DEFAULT_SINCE)).toBeUndefined();
    expect(missedSinceIso(null)).toBeUndefined();
    expect(missedSinceIso('pas un nombre')).toBeUndefined();
  });

  it('calcule une borne dans le passé pour les autres fenêtres', () => {
    const iso = missedSinceIso('30');
    expect(iso).toBeDefined();
    const days = (Date.now() - Date.parse(iso as string)) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it('retombe sur sept jours pour une valeur d’URL inconnue', () => {
    expect(knownSinceDays('30')).toBe('30');
    expect(knownSinceDays('365')).toBe('7');
    expect(knownSinceDays(undefined)).toBe('7');
  });
});

describe('Appels manqués — nom de l’appelant', () => {
  it('rend le nom quand une seule fiche est nommée', () => {
    const context = missedContextOf({
      callId: 'c1',
      candidates: [{ entityType: 'Lead', entityId: 'l1', displayName: 'Awa Diallo' }],
    });
    expect(context.label).toBe('Awa Diallo');
    expect(context.names).toEqual(['Awa Diallo']);
  });

  it('compte les fiches quand plusieurs correspondent', () => {
    const context = missedContextOf({
      callId: 'c1',
      candidates: [
        { entityType: 'Lead', entityId: 'l1', displayName: 'Awa Diallo' },
        { entityType: 'Customer', entityId: 'c2', displayName: 'Moussa Diallo' },
      ],
    });
    expect(context.label).toBe('2 fiches possibles');
  });

  it('dit qu’une fiche existe hors périmètre, au lieu de laisser la cellule vide', () => {
    // Le contrat est explicite : un candidat `outOfPerimeter` ne porte AUCUN nom.
    const context = missedContextOf({
      callId: 'c1',
      candidates: [{ entityType: 'Customer', entityId: 'c2', outOfPerimeter: true }],
    });
    expect(context.label).toBe('Fiche hors de votre périmètre');
    expect(context.names).toEqual([]);
    expect(context.hasHiddenCandidate).toBe(true);
  });

  it('dit « non identifié » quand le serveur n’a trouvé personne', () => {
    expect(missedContextOf({ callId: 'c1', candidates: [] }).label).toBe('Appelant non identifié');
    expect(missedContextOf({ callId: 'c1' }).label).toBe('Appelant non identifié');
  });
});

describe('Appels manqués — messages d’erreur', () => {
  it('explique le refus d’une clôture sur un appel qui n’est pas manqué', () => {
    const raw = {
      status: 422,
      error: { error: 'TELEPHONY_CALL_NOT_MISSED' },
    } as unknown as HttpErrorResponse;
    expect(missedErrorMessage(raw, 'repli')).toContain('se qualifie');
  });

  it('explique un créneau de numéro vide plutôt que de parler de panne', () => {
    const raw = {
      status: 422,
      error: { error: 'LEAD_PHONE_SLOT_EMPTY' },
    } as unknown as HttpErrorResponse;
    expect(missedErrorMessage(raw, 'repli')).toContain('autre numéro');
  });

  it('délègue au référentiel les refus qu’il connaît', () => {
    const raw = {
      status: 422,
      error: { error: 'TELEPHONY_USER_NOT_LINKED' },
    } as unknown as HttpErrorResponse;
    expect(missedErrorMessage(raw, 'repli')).toContain('Rattachement des postes');
  });
});
