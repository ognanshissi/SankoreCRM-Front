import { maskDate } from '../date-picker/src/date-picker';

/**
 * Régression : la saisie clavier du sélecteur de date.
 *
 * Le masque coupait chaque partie à deux chiffres : après « 15/03 », la frappe suivante donnait
 * « 15/032 », réduit à « 15/03 » — l'année ne pouvait jamais commencer. Le test rejoue la frappe
 * chiffre par chiffre, comme le fait un navigateur : chaque caractère arrive sur la valeur déjà
 * masquée.
 */
function typeDigits(text: string): string {
  let value = '';
  for (const char of text) value = maskDate(value + char);
  return value;
}

describe('maskDate', () => {
  it('tape une date entière, chiffre par chiffre', () => {
    expect(typeDigits('15032024')).toBe('15/03/2024');
    expect(typeDigits('21102026')).toBe('21/10/2026');
  });

  it('complète un jour ou un mois d’un seul chiffre suivi d’un séparateur', () => {
    expect(maskDate('1/3/2024')).toBe('01/03/2024');
    expect(maskDate('15/1/')).toBe('15/01');
  });

  it('ne garde que huit chiffres', () => {
    expect(typeDigits('150320245')).toBe('15/03/2024');
  });
});
