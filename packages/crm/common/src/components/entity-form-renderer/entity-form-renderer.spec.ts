import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EntityFormDto, FormFieldTypeEnum } from '@sankore/crm-api';
import { EntityFormRenderer } from './entity-form-renderer';
import { EntityFormReferences } from './entity-form-references.service';
import { RenderMode, WireValues } from './entity-form-values';

const LEAD_FORM: EntityFormDto = {
  version: 1,
  sections: [
    { key: 'identity', title: 'Identité', order: 1, quickAdd: true },
    {
      key: 'company',
      title: 'Entreprise',
      order: 2,
      quickAdd: true,
      visibleWhen: { fieldKey: 'prospectType', values: ['Corporate'] },
    },
    { key: 'origin', title: 'Origine', order: 3, quickAdd: false },
  ],
  fields: [
    {
      key: 'prospectType', type: FormFieldTypeEnum.SingleChoice, label: 'Type de prospect', order: 1,
      sectionKey: 'identity', quickAdd: true, isRequired: true, isNative: true, isRequiredLocked: true,
      options: [{ value: 'Individual', label: 'Particulier' }, { value: 'Corporate', label: 'Entreprise' }],
      defaultValue: 'Individual',
    },
    { key: 'lastName', type: FormFieldTypeEnum.Text, label: 'Nom', order: 2, sectionKey: 'identity', quickAdd: true, isRequired: true, isNative: true },
    { key: 'companyName', type: FormFieldTypeEnum.Text, label: "Nom de l'entreprise", order: 1, sectionKey: 'company', quickAdd: true, isNative: true },
    { key: 'campaign', type: FormFieldTypeEnum.Text, label: 'Campagne', order: 1, sectionKey: 'origin', quickAdd: false, isNative: true },
    { key: 'segment', type: FormFieldTypeEnum.SingleChoice, label: 'Segment', order: 2, sectionKey: 'origin', quickAdd: true, isNative: false,
      options: [{ value: 'A', label: 'Segment A' }] },
  ],
};

@Component({
  imports: [EntityFormRenderer],
  template: `<entity-form-renderer [form]="form" [mode]="mode()" [values]="values()" [prefill]="prefill()" [exclude]="exclude()" />`,
})
class Host {
  public readonly form = LEAD_FORM;
  public readonly mode = signal<RenderMode>('quick');
  public readonly values = signal<WireValues | null>(null);
  public readonly prefill = signal<WireValues | null>(null);
  public readonly exclude = signal<string[]>([]);
  public readonly renderer = viewChild.required(EntityFormRenderer);
}

describe('EntityFormRenderer', () => {
  function render() {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: EntityFormReferences, useValue: { options: () => of([]), currencies: [] } }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, host: fixture.componentInstance, text: () => fixture.nativeElement.textContent as string };
  }

  it('shows in quick mode only the ticked fields, and a section title only when the section asks for it', () => {
    const { text } = render();

    expect(text()).toContain('Nom');
    expect(text()).not.toContain('Campagne');
    // « Segment » est en création rapide, dans « Origine » dont le titre ne l'est pas.
    expect(text()).toContain('Segment');
    expect(text()).not.toContain('Origine');
  });

  it('reveals the company section when the type becomes Corporate', () => {
    const { fixture, host, text } = render();
    expect(text()).not.toContain("Nom de l'entreprise");

    host.renderer().entry('prospectType').text().value.set('Corporate');
    fixture.detectChanges();

    expect(text()).toContain("Nom de l'entreprise");
  });

  it('is invalid until the required field is filled, and returns contract values', () => {
    const { host } = render();
    const renderer = host.renderer();

    expect(renderer.valid()).toBe(false);

    renderer.entry('lastName').text().value.set('Ouattara');
    expect(renderer.valid()).toBe(true);
    expect(renderer.wireValues()).toMatchObject({ prospectType: 'Individual', lastName: 'Ouattara', campaign: null });
  });

  it('sends only the changed custom values on an existing record', () => {
    const { fixture, host } = render();
    host.mode.set('full');
    host.values.set({ prospectType: 'Individual', lastName: 'Koné', campaign: null, companyName: null, segment: null });
    fixture.detectChanges();

    const renderer = host.renderer();
    expect(renderer.customFieldsPayload()).toEqual({});

    renderer.entry('segment').text().value.set('A');
    expect(renderer.customFieldsPayload()).toEqual({ segment: 'A' });
  });

  it('keeps what was typed when a wizard moves to another step, and validates only the step shown', () => {
    const { fixture, host } = render();
    const renderer = host.renderer();

    // Étape 1 : seulement le type et le nom.
    host.exclude.set(['companyName', 'campaign', 'segment']);
    fixture.detectChanges();
    expect(renderer.valid()).toBe(false);
    renderer.entry('lastName').text().value.set('Ouattara');
    expect(renderer.valid()).toBe(true);

    // Étape 2 : le nom n'est plus rendu, sa saisie reste.
    host.exclude.set(['prospectType', 'lastName']);
    fixture.detectChanges();
    expect(renderer.wireValues()['lastName']).toBe('Ouattara');
  });

  it('treats a prefill as a new record: defaults still apply and everything typed is sent', () => {
    const { fixture, host } = render();
    host.prefill.set({ lastName: 'Koné', segment: 'A' });
    fixture.detectChanges();

    const renderer = host.renderer();
    expect(renderer.wireValues()).toMatchObject({ prospectType: 'Individual', lastName: 'Koné' });
    expect(renderer.customFieldsPayload()).toEqual({ segment: 'A' });
  });
});
