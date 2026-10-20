import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntityFormDto, FormFieldTypeEnum, FormsApiService } from '@sankore/crm-api';
import { CustomFieldFilters } from './custom-field-filters';

const FORM: EntityFormDto = {
  fields: [
    { key: 'prospectType', type: FormFieldTypeEnum.SingleChoice, label: 'Type', isNative: true, options: [{ value: 'Corporate' }] },
    { key: 'segment', type: FormFieldTypeEnum.SingleChoice, label: 'Segment', isNative: false, options: [{ value: 'A', label: 'A' }] },
    { key: 'vip', type: FormFieldTypeEnum.Boolean, label: 'VIP', isNative: false },
    { key: 'note', type: FormFieldTypeEnum.Text, label: 'Note', isNative: false },
    { key: 'spouse', type: FormFieldTypeEnum.SingleChoice, label: 'Conjoint', isNative: false, isSensitive: true, options: [{ value: 'x' }] },
    { key: 'legacy', type: FormFieldTypeEnum.SingleChoice, label: 'Ancien', isNative: false, isArchived: true, options: [{ value: 'y' }] },
  ],
};

describe('CustomFieldFilters', () => {
  function render(value: string[] = []) {
    TestBed.configureTestingModule({
      imports: [CustomFieldFilters],
      providers: [{ provide: FormsApiService, useValue: { getEntityForm: () => of(FORM) } }],
    });
    const fixture = TestBed.createComponent(CustomFieldFilters);
    fixture.componentRef.setInput('entity', 'Lead');
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('offers only custom choice and yes/no fields that are neither sensitive nor archived', () => {
    expect(render().fields().map((f) => f.key)).toEqual(['segment', 'vip']);
  });

  it('emits filters the way the server reads them, and clearing one removes only it', () => {
    const filters = render(['segment:A']);
    const emitted: string[][] = [];
    filters.valueChange.subscribe((v) => emitted.push(v));

    filters.select('vip', 'true');
    filters.select('segment', null);

    expect(emitted).toEqual([['segment:A', 'vip:true'], []]);
  });
});
