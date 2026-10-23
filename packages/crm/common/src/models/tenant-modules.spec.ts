import { describe, expect, it } from 'vitest';
import { ProductDtoCategoryEnum } from '@sankore/crm-api';
import { isCategoryOpen, PRODUCT_CATEGORY_MODULE } from './tenant-modules';

describe('isCategoryOpen', () => {
  it('place chaque catégorie du contrat dans un module ou dans le socle', () => {
    // Une catégorie ajoutée au contrat sans être placée ici serait ouverte à tous en silence.
    for (const category of Object.values(ProductDtoCategoryEnum)) {
      expect(PRODUCT_CATEGORY_MODULE, category).toHaveProperty(category);
    }
  });

  it('ouvre Standard à tous, une catégorie bancaire avec son seul module', () => {
    const socle = new Set<string>();
    expect(isCategoryOpen('Standard', socle)).toBe(true);
    expect(isCategoryOpen('Tontine', socle)).toBe(false);
    expect(isCategoryOpen('Tontine', new Set(['Insurance']))).toBe(false);
    expect(isCategoryOpen('Tontine', new Set(['BankingMicrofinance']))).toBe(true);
  });
});
