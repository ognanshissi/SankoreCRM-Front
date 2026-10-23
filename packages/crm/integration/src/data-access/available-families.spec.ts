import { describe, expect, it } from 'vitest';
import { availableFamilies } from './integration-referential';

/** Même règle que `ConnectionFamilyModules` côté serveur. */
describe('availableFamilies', () => {
  const families = (modules: string[]) => availableFamilies(new Set(modules)).map((f) => f.value);

  it('propose toujours la téléphonie, même au socle seul', () => {
    expect(families([])).toEqual(['Telephony']);
  });

  it('ne propose pas le core banking à un tenant qui n’a que l’assurance', () => {
    expect(families(['Insurance'])).toEqual(['Insurance', 'Telephony']);
  });

  it('propose le core banking avec « Banking - Microfinance »', () => {
    expect(families(['BankingMicrofinance'])).toEqual(['CoreBanking', 'Telephony']);
  });
});
