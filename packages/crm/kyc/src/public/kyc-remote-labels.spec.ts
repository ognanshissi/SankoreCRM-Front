import { describe, expect, it } from 'vitest';
import { kycQualityCauseLabel } from './kyc-remote-labels';

/**
 * La traduction des verdicts qualité vers des consignes (KRM-F-04/F-05).
 *
 * Un spec ici, comme pour `kyc-referential`, parce que la règle qui compte est le repli :
 * le service biométrique « peut renvoyer d'autres codes, passés tels quels » d'après son
 * propre contrat, et ce qu'il ne faut jamais afficher à un client c'est le code lui-même.
 * Un `?? cause` au lieu d'un `?? GENERIC_CAUSE` passerait inaperçu en relecture et
 * mettrait « IMAGE_QUALITY_TOO_LOW » sous les yeux de quelqu'un qui tient sa carte
 * d'identité.
 */
describe('kycQualityCauseLabel', () => {
  it('traduit les codes documentés du service', () => {
    expect(kycQualityCauseLabel('IMAGE_QUALITY_TOO_LOW')).toContain('floue');
    expect(kycQualityCauseLabel('NO_FACE_DETECTED')).toContain('visage');
    expect(kycQualityCauseLabel('MULTIPLE_FACES_DETECTED')).toContain('Plusieurs visages');
  });

  it('traduit les causes de détail du champ libre', () => {
    expect(kycQualityCauseLabel('glare')).toContain('reflet');
    expect(kycQualityCauseLabel('underexposed')).toContain('sombre');
  });

  it('tolère les casses et les séparateurs que le service mélange', () => {
    // Le code arrive en MAJUSCULES_AVEC_UNDERSCORES, le détail en minuscules, et parfois
    // avec des espaces ou des tirets selon le champ.
    const expected = kycQualityCauseLabel('low_resolution');

    expect(kycQualityCauseLabel('LOW_RESOLUTION')).toBe(expected);
    expect(kycQualityCauseLabel('low resolution')).toBe(expected);
    expect(kycQualityCauseLabel('low-resolution')).toBe(expected);
    expect(kycQualityCauseLabel('  low_resolution  ')).toBe(expected);
  });

  it('ne montre JAMAIS le code brut pour une cause inconnue', () => {
    // La propriété qui justifie ce fichier.
    const unknown = 'SOME_FUTURE_SERVICE_CODE';
    const label = kycQualityCauseLabel(unknown);

    expect(label).not.toContain(unknown);
    expect(label).not.toContain('_');
    expect(label).toContain('Reprenez-la');
  });

  it('donne une consigne utilisable pour une cause absente', () => {
    // Le serveur renvoie un refus sans détail quand le service n'en donne pas : l'écran
    // doit tout de même dire quoi refaire.
    expect(kycQualityCauseLabel(null)).toContain('Reprenez-la');
    expect(kycQualityCauseLabel(undefined)).toContain('Reprenez-la');
    expect(kycQualityCauseLabel('')).toContain('Reprenez-la');
  });
});
