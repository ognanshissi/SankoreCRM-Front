import { COUNTRIES, nationalNumber, readTypedPhone } from '../input-phone/src/countries';

/**
 * Le champ téléphone, touche par touche : chaque caractère arrive sur le texte déjà nettoyé, comme
 * dans un navigateur. Avant, taper « +225 07… » perdait le « + » à la première touche et gardait
 * « 225 » devant le numéro (+225225…) ; seul le collage d'un numéro entier marchait.
 */
function typeInto(keys: string): ReturnType<typeof readTypedPhone> & { country: { dial: string } | null } {
  let text = '';
  let country: { dial: string } | null = null;
  let last = readTypedPhone('');
  for (const key of keys) {
    last = readTypedPhone(text + key);
    text = last.text;
    if (last.country) country = last.country;
  }
  return { ...last, country };
}

describe('readTypedPhone', () => {
  it('reconnaît un indicatif tapé touche par touche et le sort du numéro', () => {
    const read = typeInto('+225 07 00 00 00 03');

    expect(read.country?.dial).toBe('+225');
    expect(read.text.replace(/\s/g, '')).toBe('0700000003');
    expect(read.pendingDial).toBe(false);
  });

  it('garde le « + » tant que l’indicatif n’est pas complet', () => {
    const read = typeInto('+22');

    expect(read.text).toBe('+22');
    expect(read.pendingDial).toBe(true);
    expect(read.country).toBeNull();
  });

  it('reconnaît aussi un numéro collé en entier', () => {
    const read = readTypedPhone('+221 77 123 45 67');

    expect(read.country?.dial).toBe('+221');
    expect(read.text.replace(/\s/g, '')).toBe('771234567');
  });

  it('laisse un numéro national tel quel, lettres et tirets en moins', () => {
    expect(readTypedPhone('07-00 ab 00').text).toBe('0700 00');
  });
});

describe('nationalNumber', () => {
  const country = (code: string) => COUNTRIES.find((c) => c.code === code)!;

  it('retire le « 0 » national d’un numéro français, qui passe alors le format', () => {
    const fr = country('FR');

    expect(nationalNumber(fr, '0769738964')).toBe('769738964');
    expect(fr.pattern.test(nationalNumber(fr, '0769738964'))).toBe(true);
    expect(nationalNumber(fr, '769738964')).toBe('769738964');
  });

  it('garde le « 0 » ivoirien, qui fait partie du numéro', () => {
    expect(nationalNumber(country('CI'), '0700000003')).toBe('0700000003');
  });
});
