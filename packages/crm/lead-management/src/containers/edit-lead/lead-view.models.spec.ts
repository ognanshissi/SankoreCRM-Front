import { LeadDto } from '@sankore/crm-api';
import {
  ageOf, countryFromPhone, formatAmount, initials, intentOption, isConsentGap, missingAddressParts, nameNeedsCheck,
  originLabel, originPhrase, householdBudget, parseAmount,
} from './lead-view.models';

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

describe('identity view models', () => {
  it('lists the address parts still missing, with the points the server gives them', () => {
    expect(missingAddressParts(null).map((p) => p.points)).toEqual([2, 8, 6, 2]);
    expect(missingAddressParts({ countryCode: 'CI', city: ' ', neighbourhood: 'Cocody' }).map((p) => p.key))
      .toEqual(['city', 'landmark']);
  });

  it('asks to check a name typed in capitals over USSD, until somebody confirmed it', () => {
    const ussd = { channel: 'Ussd', firstName: 'KOFFI', lastName: 'BROU' } as LeadDto;
    expect(nameNeedsCheck(ussd)).toBe(true);
    expect(nameNeedsCheck({ ...ussd, nameVerifiedAt: '2026-10-20T10:00:00Z' })).toBe(false);
    expect(nameNeedsCheck({ ...ussd, firstName: 'Koffi', lastName: 'Brou' })).toBe(false);
    expect(nameNeedsCheck({ ...ussd, channel: 'Agency', source: 'Agency' })).toBe(false);
  });

  it('reads the country from an international dialling code', () => {
    expect(countryFromPhone('+225 07 00 00 00 01')).toEqual({ dial: '225', country: 'CI' });
    expect(countryFromPhone('00221770000000')).toEqual({ dial: '221', country: 'SN' });
    expect(countryFromPhone('0700000001')).toBeNull();
  });
});

describe('household budget', () => {
  it('reads amounts the way agents type them', () => {
    expect(parseAmount('450 000')).toBe(450000);
    expect(parseAmount('450 000 FCFA')).toBe(450000);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('-5')).toBeNaN();
    expect(parseAmount('beaucoup')).toBeNaN();
  });

  it('computes what is left each month and the share already committed', () => {
    expect(householdBudget(450000, 120000, 60000)).toEqual({ disposable: 270000, commitmentPercent: 40 });
    expect(householdBudget(450000, null, null)).toEqual({ disposable: 450000, commitmentPercent: 0 });
    expect(householdBudget(null, 120000, 0)).toBeNull();
  });
});
