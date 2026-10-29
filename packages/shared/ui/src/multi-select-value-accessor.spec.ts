import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TasMultiSelect } from '@talisoft/ui/multi-select';

/**
 * Régression : une valeur écrite depuis le modèle doit COCHER les options, sans notifier en retour.
 *
 * `writeValue` passait par le setter `value` : il notifiait le modèle de sa propre valeur et ne
 * touchait pas la sélection affichée. Les rôles enregistrés d'une étape de parcours (ou d'une
 * politique de bénéficiaires) n'apparaissaient donc pas, et cocher un rôle remplaçait la liste.
 */
@Component({
  standalone: true,
  imports: [FormsModule, TasMultiSelect],
  template: `
    <tas-multi-select [options]="options()" [ngModel]="value()" (ngModelChange)="record($event)"></tas-multi-select>
  `,
})
class HostComponent {
  public options = signal([
    { label: 'Chef d’agence', value: 'BranchManager' },
    { label: 'Administrateur', value: 'Administrator' },
    { label: 'Agent', value: 'Agent' },
  ]);
  public value = signal<string[] | null>(null);
  public emitted: (string[] | null)[] = [];

  public record(next: string[] | null): void {
    this.emitted.push(next);
    this.value.set(next);
  }
}

describe('TasMultiSelect — contrat ControlValueAccessor', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let select: TasMultiSelect<unknown>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    select = fixture.debugElement.children[0].componentInstance;
  });

  const selected = () => select.selectionModel.selected.map((o) => o['value']);

  it('coche les options de la valeur écrite, sans rien émettre', async () => {
    host.value.set(['Administrator', 'Agent']);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(selected()).toEqual(['Administrator', 'Agent']);
    expect(host.emitted).toEqual([]);
  });

  it('recoche la valeur quand les options arrivent après elle', async () => {
    host.options.set([]);
    host.value.set(['BranchManager']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(selected()).toEqual([]);

    host.options.set([{ label: 'Chef d’agence', value: 'BranchManager' }]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(selected()).toEqual(['BranchManager']);
    expect(host.emitted).toEqual([]);
  });

  it('ajoute une option cochée à la valeur existante', async () => {
    host.value.set(['Administrator']);
    fixture.detectChanges();
    await fixture.whenStable();

    select.toggleSelection(host.options()[2]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.emitted.at(-1)).toEqual(['Administrator', 'Agent']);
  });
});
