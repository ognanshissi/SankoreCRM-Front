import { LeadDto } from '@sankore/crm-api';
import { ageOf, formatAmount, initials, intentOption, isConsentGap, originLabel, originPhrase } from './lead-view.models';

describe('lead view models', () => {
  it('reads the intent level the API sends, not the indices the old header compared it to', () => {
    expect(intentOption('Warm').label).toBe('Tiède');
    expect(intentOption('Hot').label).toBe('Chaud');
    expect(intentOption(null).label).toBe('Pas encore évalué');
    expect(intentOption('2').label).toBe('Pas encore évalué');
  });

  it('says where the lead came from, the configured source first, then the channel, then the source', () => {
    expect(originLabel({ leadSourceLabel: 'Salon de l’habitat', channel: 'Web' } as LeadDto)).toBe('Salon de l’habitat');
    expect(originLabel({ channel: 'CallCenter', source: 'Web' } as LeadDto)).toBe("Centre d'appels");
    expect(originPhrase({ channel: 'CallCenter' } as LeadDto)).toBe("par le centre d'appels");
    expect(originPhrase({ channel: 'Agency' } as LeadDto)).toBe("par l'agence");
    expect(originPhrase({} as LeadDto)).toBe('');
  });

  it('computes an age in completed years and initials from a name', () => {
    const today = new Date();
    const birthday = `${today.getFullYear() - 49}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(ageOf(birthday)).toBe(49);
    expect(ageOf(null)).toBeNull();
    expect(initials('Didier Gbagbo')).toBe('DG');
    expect(initials('Awa')).toBe('AW');
  });

  it('formats an amount in FCFA with French grouping', () => {
    expect(formatAmount(2_800_000, 'XOF').replace(/\s/g, ' ')).toBe('2 800 000 FCFA');
    expect(formatAmount(1500, 'EUR').replace(/\s/g, ' ')).toBe('1 500 EUR');
  });

  it('recognises the completeness gaps that are consents', () => {
    expect(isConsentGap('CONSENT_MISSING')).toBe(true);
    expect(isConsentGap('HEALTH_CONSENT_MISSING')).toBe(true);
    expect(isConsentGap('ADDRESS_MISSING')).toBe(false);
  });
});
