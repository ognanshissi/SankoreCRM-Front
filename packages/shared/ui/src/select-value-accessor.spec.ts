import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TasSelect } from '@talisoft/ui/select';

/**
 * Régression : `writeValue` ne doit jamais notifier en retour.
 *
 * L'implémentation précédente passait par le setter `value`, qui appelle
 * `onChange`. Écrire la valeur depuis le modèle émettait donc un
 * `ngModelChange`, et tout écran dont le gestionnaire provoquait un nouveau
 * rendu du select (un rechargement affichant un spinner) partait en boucle
 * infinie d'appels HTTP.
 */
@Component({
  standalone: true,
  imports: [FormsModule, TasSelect],
  template: `
    <tas-select
      [options]="options"
      optionLabel="label"
      optionValue="value"
      [ngModel]="value()"
      (ngModelChange)="record($event)"
    ></tas-select>
  `,
})
class HostComponent {
  public options = [
    { label: 'Webhook serveur', value: 'ServerWebhook' },
    { label: 'Collecte planifiée', value: 'ScheduledPull' },
  ];
  public value = signal<string | null>(null);
  public emitted: (string | null)[] = [];

  public record(next: string | null): void {
    this.emitted.push(next);
    this.value.set(next);
  }
}

describe('TasSelect — contrat ControlValueAccessor', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await fixture.whenStable();
  });

  it("n'émet rien quand la valeur est écrite depuis le modèle", async () => {
    host.value.set('ServerWebhook');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.emitted).toEqual([]);
  });

  it('reflète malgré tout la valeur écrite', async () => {
    host.value.set('ServerWebhook');
    fixture.detectChanges();
    await fixture.whenStable();

    const select = fixture.debugElement.children[0].componentInstance as TasSelect<unknown>;
    expect(select.value).toBe('ServerWebhook');
    expect(select.selectionModel.isSelected('ServerWebhook')).toBe(true);
  });

  it('émet quand la sélection vient de l’utilisateur', async () => {
    const select = fixture.debugElement.children[0].componentInstance as TasSelect<unknown>;
    select.toggleSelection('ScheduledPull');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(host.emitted).toEqual(['ScheduledPull']);
  });

  it('honore une réinitialisation à null (filtre vidé)', async () => {
    host.value.set('ServerWebhook');
    fixture.detectChanges();
    await fixture.whenStable();

    host.emitted = [];
    host.value.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    const select = fixture.debugElement.children[0].componentInstance as TasSelect<unknown>;
    expect(select.value).toBeNull();
    expect(select.selectionModel.isSelected('ServerWebhook')).toBe(false);
    expect(host.emitted).toEqual([]);
  });
});
