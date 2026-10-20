import { EntityFormDto, FormField, FormFieldTypeEnum, FormSection } from '@sankore/crm-api';
import {
  customPayload,
  formSteps,
  isFieldVisible,
  sameWire,
  toEntries,
  toEntry,
  toWire,
  validateEntry,
  VisibilityContext,
} from './entity-form-values';

const field = (key: string, type: FormFieldTypeEnum, over: Partial<FormField> = {}): FormField => ({
  key,
  type,
  label: key,
  order: 1,
  isNative: false,
  ...over,
});

const ctx = (fields: FormField[], values: Record<string, unknown>, sections: FormSection[] = []): VisibilityContext => {
  const form: EntityFormDto = { fields, sections };
  const entries = toEntries(form, values as never);
  return {
    fields: new Map(fields.map((f) => [f.key!, f])),
    entries: new Map(entries.map((e) => [e.key, e])),
    sections: new Map(sections.map((s) => [s.key!, s])),
  };
};

describe('entity form values', () => {
  it('round-trips every type between the contract and the form model', () => {
    const cases: [FormField, unknown][] = [
      [field('a', FormFieldTypeEnum.Text), 'Treichville'],
      [field('b', FormFieldTypeEnum.Integer), 3],
      [field('c', FormFieldTypeEnum.Money), { amount: 1500000, currency: 'XOF' }],
      [field('d', FormFieldTypeEnum.Date), '2026-03-01'],
      [field('e', FormFieldTypeEnum.Boolean), true],
      [field('f', FormFieldTypeEnum.MultiChoice), ['x', 'y']],
      [field('g', FormFieldTypeEnum.SingleChoice), 'B'],
    ];
    for (const [f, value] of cases) {
      expect(toWire(f, toEntry(f, value as never))).toEqual(value);
    }
  });

  it('reads a decimal typed with a French comma', () => {
    const f = field('rate', FormFieldTypeEnum.Decimal);
    expect(toWire(f, { ...toEntry(f, null), text: '12,5' })).toBe(12.5);
  });

  it('applies the default value to a new record only', () => {
    const f = field('segment', FormFieldTypeEnum.SingleChoice, { defaultValue: 'A' });
    expect(toEntry(f, undefined).text).toBe('A');
    expect(toEntry(f, null).text).toBe('');
  });

  it('shows a company-only field only when the type says company, section conditions included', () => {
    const type = field('prospectType', FormFieldTypeEnum.SingleChoice, { isNative: true });
    const sector = field('sector', FormFieldTypeEnum.Text, {
      visibleWhen: { fieldKey: 'prospectType', values: ['Corporate'] },
    });
    const inSection = field('capital', FormFieldTypeEnum.Money, { sectionKey: 'company' });
    const company: FormSection = { key: 'company', title: 'Entreprise', visibleWhen: { fieldKey: 'prospectType', values: ['Corporate'] } };

    const person = ctx([type, sector, inSection], { prospectType: 'Individual' }, [company]);
    const corporate = ctx([type, sector, inSection], { prospectType: 'Corporate' }, [company]);

    expect(isFieldVisible(sector, person)).toBe(false);
    expect(isFieldVisible(inSection, person)).toBe(false);
    expect(isFieldVisible(sector, corporate)).toBe(true);
    expect(isFieldVisible(inSection, corporate)).toBe(true);
  });

  it('requires a visible required field and never a hidden one', () => {
    const f = field('segment', FormFieldTypeEnum.Text, { isRequired: true });
    const empty = toEntry(f, null);
    expect(validateEntry(f, empty, true)).toBe('Ce champ est obligatoire');
    expect(validateEntry(f, empty, false)).toBeNull();
  });

  it('mirrors the server limits', () => {
    const percent = field('rate', FormFieldTypeEnum.Percent);
    const count = field('count', FormFieldTypeEnum.Integer, { min: 1, max: 10 });
    const mail = field('mail', FormFieldTypeEnum.Email);
    const code = field('code', FormFieldTypeEnum.Text, { pattern: '^CI[0-9]{4}$' });

    expect(validateEntry(percent, { ...toEntry(percent, null), text: '120' }, true)).toBe('Entre 0 et 100');
    expect(validateEntry(count, { ...toEntry(count, null), text: '2.5' }, true)).toBe('Nombre entier attendu');
    expect(validateEntry(count, { ...toEntry(count, null), text: '11' }, true)).toBe('Au plus 10');
    expect(validateEntry(count, { ...toEntry(count, null), text: 'abc' }, true)).toBe('Nombre attendu');
    expect(validateEntry(mail, { ...toEntry(mail, null), text: 'awa@' }, true)).toBe('Adresse e-mail invalide');
    expect(validateEntry(code, { ...toEntry(code, null), text: 'CI12' }, true)).toBe('Format non respecté');
    expect(validateEntry(code, { ...toEntry(code, null), text: 'CI1234' }, true)).toBeNull();
  });

  it('sends every typed custom value on a creation, and only what changed on an edit', () => {
    const form: EntityFormDto = {
      fields: [
        field('phoneNumber', FormFieldTypeEnum.Phone, { isNative: true }),
        field('segment', FormFieldTypeEnum.Text),
        field('note', FormFieldTypeEnum.Text),
        field('old', FormFieldTypeEnum.Text, { isArchived: true }),
      ],
    };

    expect(customPayload(form, { phoneNumber: '07', segment: 'A', note: null, old: 'x' }, null)).toEqual({ segment: 'A' });

    const initial = { phoneNumber: '07', segment: 'A', note: 'n', old: 'x' };
    expect(customPayload(form, { ...initial, segment: 'B', note: null }, initial)).toEqual({ segment: 'B', note: null });
    expect(customPayload(form, initial, initial)).toEqual({});
  });

  it('treats an unticked box as no value, so an untouched edit sends nothing', () => {
    expect(sameWire(false, null)).toBe(true);
    expect(sameWire(true, null)).toBe(false);
  });

  it('cuts a wizard into one step per section, skipping sections that belong to the other type', () => {
    const form: EntityFormDto = {
      sections: [
        { key: 'identity', title: 'Identité', order: 1, visibleWhen: { fieldKey: 'clientType', values: ['Individual'] } },
        { key: 'company', title: 'Identification', order: 2, visibleWhen: { fieldKey: 'clientType', values: ['Legal'] } },
        { key: 'contact', title: 'Coordonnées', order: 3 },
        { key: 'origin', title: 'Origine', order: 4 },
      ],
      fields: [
        field('clientType', FormFieldTypeEnum.SingleChoice, { isNative: true, quickAdd: true, sectionKey: 'identity' }),
        field('lastName', FormFieldTypeEnum.Text, { isNative: true, quickAdd: true, sectionKey: 'identity' }),
        field('legalName', FormFieldTypeEnum.Text, { isNative: true, quickAdd: true, sectionKey: 'company' }),
        field('email', FormFieldTypeEnum.Email, { isNative: true, quickAdd: true, sectionKey: 'contact' }),
        // Une section sans champ de création rapide ne devient pas une étape vide.
        field('campaign', FormFieldTypeEnum.Text, { isNative: true, quickAdd: false, sectionKey: 'origin' }),
      ],
    };

    const steps = formSteps(form, 'quick', { clientType: 'Legal' }, ['clientType']);

    expect(steps.map((s) => [s.label, s.fieldKeys])).toEqual([
      ['Identification', ['legalName']],
      ['Coordonnées', ['email']],
    ]);
  });
});
