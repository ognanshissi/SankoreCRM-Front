import {
  DEFAULT_DATE_RANGE_PRESETS,
  maskRange,
  monthGrid,
  parseRange,
  presetRange,
} from '../date-range-picker/src/date-range.utils';

/**
 * Le sélecteur de période : la frappe au clavier, la lecture de ce qui est tapé, les raccourcis
 * bornés par min/max, et la grille d'un mois. Chaque caractère arrive sur la valeur déjà masquée,
 * comme dans un navigateur.
 */
function type(text: string, from = ''): string {
  let value = from;
  for (const char of text) value = maskRange(value + char);
  return value;
}

function backspace(value: string, times: number): string {
  let out = value;
  for (let i = 0; i < times; i++) out = maskRange(out.slice(0, -1));
  return out;
}

describe('maskRange', () => {
  it('tape une période entière, chiffre par chiffre', () => {
    expect(type('0110202627102026')).toBe('01/10/2026 – 27/10/2026');
  });

  it("n'ajoute le séparateur qu'avec le neuvième chiffre", () => {
    expect(type('01102026')).toBe('01/10/2026');
    expect(type('011020262')).toBe('01/10/2026 – 2');
  });

  it('laisse effacer à travers le séparateur', () => {
    const typed = type('011020262');
    expect(backspace(typed, 1)).toBe('01/10/2026');
    expect(backspace(typed, 2)).toBe('01/10/202');
  });

  it('garde les deux moitiés d’une période collée, en complétant les jours', () => {
    expect(maskRange('2/3/2026 - 5/3/2026')).toBe('02/03/2026 – 05/03/2026');
    expect(maskRange('02/03/2026 au 05/03/2026')).toBe('02/03/2026 – 05/03/2026');
  });

  it('ignore les lettres et coupe au-delà de seize chiffres', () => {
    expect(type('01a10b2026c27102026999')).toBe('01/10/2026 – 27/10/2026');
  });
});

describe('parseRange', () => {
  it('lit une période complète et remet dans l’ordre deux jours inversés', () => {
    expect(parseRange('01/10/2026 – 27/10/2026')).toEqual({ value: { start: '2026-10-01', end: '2026-10-27' } });
    expect(parseRange('27/10/2026 – 01/10/2026')).toEqual({ value: { start: '2026-10-01', end: '2026-10-27' } });
  });

  it('refuse une moitié manquante ou un jour qui n’existe pas', () => {
    expect(parseRange('01/10/2026')).toEqual({ problem: 'format' });
    expect(parseRange('31/02/2026 – 05/03/2026')).toEqual({ problem: 'format' });
  });

  it('dit de quel côté la période dépasse', () => {
    expect(parseRange('01/09/2026 – 05/10/2026', '2026-10-01')).toEqual({ problem: 'min' });
    expect(parseRange('01/10/2026 – 30/10/2026', null, '2026-10-27')).toEqual({ problem: 'max' });
  });
});

describe('presetRange', () => {
  const today = new Date(2026, 9, 27); // mardi 27 octobre 2026
  const preset = (label: string) => DEFAULT_DATE_RANGE_PRESETS.find((p) => p.label === label)!;

  it('calcule les raccourcis à partir d’aujourd’hui', () => {
    expect(presetRange(preset('Hier'), today)).toEqual({ start: '2026-10-26', end: '2026-10-26' });
    expect(presetRange(preset('7 derniers jours'), today)).toEqual({ start: '2026-10-21', end: '2026-10-27' });
    expect(presetRange(preset('30 derniers jours'), today)).toEqual({ start: '2026-09-28', end: '2026-10-27' });
    expect(presetRange(preset('Mois dernier'), today)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('arrête « Ce mois-ci » à max au lieu de le refuser', () => {
    expect(presetRange(preset('Ce mois-ci'), today, null, '2026-10-27')).toEqual({ start: '2026-10-01', end: '2026-10-27' });
  });

  it('désactive un raccourci dont il ne reste rien', () => {
    expect(presetRange(preset('Mois dernier'), today, '2026-10-01')).toBeNull();
  });
});

describe('monthGrid', () => {
  it('commence la semaine le lundi et complète en semaines entières', () => {
    const october = monthGrid(2026, 9); // le 1er octobre 2026 est un jeudi
    expect(october.slice(0, 4).map((c) => c.iso)).toEqual([null, null, null, '2026-10-01']);
    expect(october.length % 7).toBe(0);
    expect(october.filter((c) => c.iso).length).toBe(31);
  });
});
