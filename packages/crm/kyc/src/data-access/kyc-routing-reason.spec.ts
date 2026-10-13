import { describe, expect, it } from 'vitest';
import { kycRoutingReasonLabel } from './kyc-referential';

/**
 * La traduction des motifs de routage (KRM-F-08).
 *
 * Un spec ici pour la même raison que `kyc-remote-labels.spec.ts` côté client : la règle qui
 * compte est le repli. Le serveur renvoie un **code** — c'est voulu, il est compté dans le
 * reporting conformité et il voyage dans l'email envoyé à l'agent — et la liste des codes bougera
 * avant cet écran. Un `?? reason` au lieu d'un `?? FALLBACK` passerait inaperçu en relecture et
 * mettrait « QUALITY_RETRIES_EXCEEDED » sous les yeux d'un chef d'agence.
 */
describe('kycRoutingReasonLabel', () => {
  it('traduit chacun des motifs du serveur', () => {
    // La liste complète de KycRoutingReasons. Si le serveur en ajoute un, ce test ne le voit pas —
    // mais le cas suivant garantit que l'écran reste lisible en attendant.
    const codes = [
      'PRODUCT_POLICY',
      'AUTO_APPROVAL_DISABLED',
      'TIER_ABOVE_AUTO_LIMIT',
      'SCORE_BELOW_THRESHOLD',
      'BLOCKING_FLAG',
      'IDENTITY_MISMATCH',
      'PEP',
      'HIGH_VIGILANCE',
      'FACE_RETRY',
      'MISSING_DOCUMENT',
      'QUALITY_RETRIES_EXCEEDED',
      'PROOF_OF_ADDRESS_REQUIRED',
    ];

    for (const code of codes) {
      const label = kycRoutingReasonLabel(code);

      expect(label, code).not.toContain('_');
      expect(label, code).not.toContain(code);
    }
  });

  it('distingue les motifs qui envoient le validateur à des écrans différents', () => {
    // Les deux qu'il serait tentant de confondre, et qui n'appellent pas la même action : l'un se
    // règle sur la fiche produit, l'autre sur les paramètres de conformité du tenant.
    expect(kycRoutingReasonLabel('TIER_ABOVE_AUTO_LIMIT')).toContain('plafond');
    expect(kycRoutingReasonLabel('AUTO_APPROVAL_DISABLED')).toContain("établissement");
  });

  it('ne montre JAMAIS le code brut pour un motif inconnu', () => {
    const unknown = 'SOME_FUTURE_ROUTING_REASON';
    const label = kycRoutingReasonLabel(unknown);

    expect(label).not.toContain(unknown);
    expect(label).not.toContain('_');
    expect(label).toContain('décision humaine');
  });

  it('donne une consigne utilisable quand le motif est absent', () => {
    // Un dossier approuvé automatiquement n'a pas de motif : le bandeau affiche sa propre phrase
    // dans ce cas, mais la fonction doit rester lisible si elle est appelée quand même.
    expect(kycRoutingReasonLabel(null)).toContain('décision humaine');
    expect(kycRoutingReasonLabel(undefined)).toContain('décision humaine');
    expect(kycRoutingReasonLabel('')).toContain('décision humaine');
  });

  it('tolère la casse et les espaces', () => {
    expect(kycRoutingReasonLabel('  score_below_threshold  ')).toBe(
      kycRoutingReasonLabel('SCORE_BELOW_THRESHOLD'),
    );
  });
});
