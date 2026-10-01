import {
  isBlockingFlag,
  kycConfidenceMeta,
  kycFlagMeta,
  kycStatusMeta,
  kycVigilanceMeta,
} from './kyc-referential';

/**
 * Le référentiel porte deux règles du cahier qui ne doivent jamais régresser, parce qu'elles
 * concernent la robustesse de l'interface face au serveur :
 *
 * 1. « Un code inconnu du frontend est affiché avec un libellé générique "Point à vérifier" et la
 *    gravité Attention, sans bloquer l'écran » — c'est ce qui permet au service biométrique d'ajouter
 *    un flag sans livraison front.
 * 2. Un niveau de confiance non reconnu retombe sur « À revoir », le cas prudent : il laisse soumettre
 *    avec un avertissement, au lieu de bloquer à tort ou d'autoriser à tort.
 */
describe('Référentiel KYC — flags', () => {
  it('traduit les huit codes connus', () => {
    expect(kycFlagMeta('MRZ_CHECKSUM_FAILED').label).toBe(
      'La zone codée de la pièce est invalide',
    );
    expect(kycFlagMeta('DOCUMENT_EXPIRED').severity).toBe('blocking');
    expect(kycFlagMeta('LOW_FACE_QUALITY').severity).toBe('warning');
    expect(kycFlagMeta('IMAGE_PREPROCESSED').severity).toBe('info');
  });

  it('affiche un code inconnu en « Point à vérifier », gravité Attention', () => {
    const meta = kycFlagMeta('UN_FLAG_QUE_LE_FRONT_NE_CONNAIT_PAS');
    expect(meta.label).toBe('Point à vérifier');
    expect(meta.severity).toBe('warning');
  });

  it('ne rend jamais bloquant un code inconnu', () => {
    expect(isBlockingFlag('UN_FLAG_INEDIT')).toBe(false);
    expect(isBlockingFlag(null)).toBe(false);
    expect(isBlockingFlag(undefined)).toBe(false);
    expect(isBlockingFlag('FACE_MISMATCH')).toBe(true);
  });
});

describe('Référentiel KYC — niveau de confiance', () => {
  it('pilote la soumission selon les trois niveaux', () => {
    expect(kycConfidenceMeta('Validated')).toMatchObject({ canSubmit: true, warnOnSubmit: false });
    expect(kycConfidenceMeta('Review')).toMatchObject({ canSubmit: true, warnOnSubmit: true });
    expect(kycConfidenceMeta('Rejected')).toMatchObject({ canSubmit: false });
  });

  it('retombe sur « À revoir » quand le niveau est inconnu ou absent', () => {
    expect(kycConfidenceMeta('QuelqueChoseDeNouveau').label).toBe('À revoir');
    expect(kycConfidenceMeta(null).label).toBe('À revoir');
    expect(kycConfidenceMeta(undefined).warnOnSubmit).toBe(true);
  });

  it('accepte aussi la forme entière, que le contrat utilise en écriture', () => {
    // `confidenceLevel` est une chaîne en lecture et un entier 0..3 en écriture : les deux doivent
    // être acceptés faute de documentation côté contrat.
    expect(kycConfidenceMeta(0).label).toBe('Rejeté');
    expect(kycConfidenceMeta(2).label).toBe('Validé');
  });
});

describe('Référentiel KYC — statuts et vigilance', () => {
  it('traduit les dix statuts anglais du contrat', () => {
    expect(kycStatusMeta('Collecting').label).toBe('En cours de saisie');
    expect(kycStatusMeta('ComplementRequired').label).toBe('Complément requis');
    expect(kycStatusMeta('UnderReview').label).toBe('Revue en cours');
    expect(kycStatusMeta('Full').label).toBe('KYC complet');
  });

  it('rend un statut inconnu tel quel, sans casser l’écran', () => {
    expect(kycStatusMeta('Archived').label).toBe('Archived');
    expect(kycStatusMeta(null).label).toBe('—');
  });

  it('déclenche l’étape conformité sur la vigilance renforcée', () => {
    expect(kycVigilanceMeta('Enhanced').requiresCompliance).toBe(true);
    expect(kycVigilanceMeta('Standard').requiresCompliance).toBe(false);
    expect(kycVigilanceMeta('ValeurInconnue').requiresCompliance).toBe(false);
  });
});
