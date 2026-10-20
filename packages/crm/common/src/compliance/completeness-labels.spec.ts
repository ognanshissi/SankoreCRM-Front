import { completenessGapSection } from './completeness-gauge';
import { completenessGapLabel, completenessGapTitle } from './compliance-labels';

describe('completeness gap labels', () => {
  it('names the required consent or field instead of showing its code', () => {
    expect(completenessGapTitle({ code: 'CONSENT_MISSING', detail: 'CONSENT_CREDIT_BUREAU' }))
      .toBe("Consentement : Bureau d'Information sur le Crédit");
    expect(completenessGapTitle({ code: 'MISSING_REQUIRED_FIELD', detail: 'BIRTH_DATE' })).toBe('Date de naissance');
    expect(completenessGapTitle({ code: 'MISSING_QUESTIONNAIRE', detail: 'Questionnaire santé' })).toBe('Questionnaire santé');
    expect(completenessGapTitle({ code: 'PEP_NOT_DECLARED', detail: null })).toBe('Statut PPE non déclaré');
  });

  it('knows the codes the server actually produces', () => {
    expect(completenessGapLabel('MISSING_REQUIRED_FIELD')).toBe('Champ obligatoire manquant');
    expect(completenessGapLabel('PRODUCT_LINE_NOT_RESOLVED')).toBe('Produit à rattacher au catalogue');
  });

  it('sends a missing consent to the consents tab and a health consent to the questionnaires', () => {
    expect(completenessGapSection('CONSENT_MISSING')).toBe('consentement');
    expect(completenessGapSection('HEALTH_CONSENT_MISSING')).toBe('questionnaires');
    expect(completenessGapSection('MISSING_QUESTIONNAIRE')).toBe('questionnaires');
    expect(completenessGapSection('CUSTOMER_KYC_EXPIRED')).toBe('client');
  });
});
