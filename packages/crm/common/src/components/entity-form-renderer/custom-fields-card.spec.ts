import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntityFormDto, FormFieldTypeEnum, FormsApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { CustomFieldsCard } from './custom-fields-card';
import { EntityFormRenderer } from './entity-form-renderer';
import { EntityFormReferences } from './entity-form-references.service';
import { WireValue } from './entity-form-values';

const FORM: EntityFormDto = {
  version: 2,
  sections: [{ key: 'company', title: 'Entreprise', order: 1, visibleWhen: { fieldKey: 'prospectType', values: ['Corporate'] } }],
  fields: [
    { key: 'prospectType', type: FormFieldTypeEnum.SingleChoice, label: 'Type', order: 1, isNative: true,
      options: [{ value: 'Individual', label: 'Particulier' }, { value: 'Corporate', label: 'Entreprise' }] },
    { key: 'segment', type: FormFieldTypeEnum.Text, label: 'Segment', order: 2, isNative: false },
    { key: 'sector', type: FormFieldTypeEnum.Text, label: "Secteur d'activité", order: 1, sectionKey: 'company', isNative: false },
    { key: 'legacy', type: FormFieldTypeEnum.Text, label: 'Ancien code', order: 3, isNative: false, isArchived: true },
  ],
};

@Component({
  imports: [CustomFieldsCard],
  template: `
    <custom-fields-card entity="Lead" [values]="values()" [context]="{ prospectType: type() }"
                        [canEdit]="true" [save]="save" (saved)="savedCount = savedCount + 1" />
  `,
})
class Host {
  public readonly values = signal<Record<string, unknown>>({ segment: 'Commerçant', legacy: 'X-12' });
  public readonly type = signal('Individual');
  public readonly sent: Record<string, WireValue>[] = [];
  public savedCount = 0;
  public readonly save = (payload: Record<string, WireValue>) => {
    this.sent.push(payload);
    return of(null);
  };
  public readonly card = viewChild.required(CustomFieldsCard);
}

describe('CustomFieldsCard', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: FormsApiService, useValue: { getEntityForm: () => of(FORM) } },
        { provide: EntityFormReferences, useValue: { options: () => of([]), currencies: [] } },
        { provide: SnackbarService, useValue: { success: () => undefined, error: () => undefined, info: () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const renderer = () => fixture.debugElement.query((d) => d.componentInstance instanceof EntityFormRenderer)
      ?.componentInstance as EntityFormRenderer;
    return { fixture, host: fixture.componentInstance, renderer, text: () => fixture.nativeElement.textContent as string };
  }

  it('shows custom values only, hides the company section of a person, and lists archived values', () => {
    const { text } = render();

    expect(text()).toContain('Commerçant');
    expect(text()).not.toContain('Type');
    expect(text()).not.toContain("Secteur d'activité");
    expect(text()).toContain('Ancien code');
    expect(text()).toContain('X-12');
  });

  it('shows the company field when the record is a company', () => {
    const { fixture, host, text } = render();
    host.type.set('Corporate');
    fixture.detectChanges();
    expect(text()).toContain("Secteur d'activité");
  });

  it('saves only what changed, then tells the host to reload', () => {
    const { fixture, host, renderer } = render();
    host.card().startEdit();
    fixture.detectChanges();

    renderer().entry('segment').text().value.set('Salarié');
    host.card().submit();

    expect(host.sent).toEqual([{ segment: 'Salarié' }]);
    expect(host.savedCount).toBe(1);
    expect(host.card().editing()).toBe(false);
  });

  it('sends nothing when nothing changed, and cancelling restores the record', () => {
    const { fixture, host, renderer } = render();
    host.card().startEdit();
    fixture.detectChanges();
    host.card().submit();
    expect(host.sent).toEqual([]);

    host.card().startEdit();
    fixture.detectChanges();
    renderer().entry('segment').text().value.set('Brouillon');
    host.card().cancel();
    fixture.detectChanges();

    expect(renderer().wireValues()['segment']).toBe('Commerçant');
  });
});
