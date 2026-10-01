import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { TableConfig, TasTable } from '@talisoft/ui/table';

/**
 * Ce que `tas-table` rend réellement quand un écran lui passe UNE page serveur.
 *
 * Le spec voisin couvre `TableDataSource` en isolation. Celui-ci couvre la question qui restait
 * ouverte : `TasTable._updateDatasource` lit `this.config()` depuis `ngOnChanges`, et l'ordre de mise
 * à jour des entrées décidait si `pageIndex` était déjà le nouveau au moment du découpage. Autrement
 * dit, c'est ce spec — et non un raisonnement — qui dit si les écrans paginés côté serveur étaient
 * vides au-delà de la première page.
 */
@Component({
  imports: [TasTable],
  template: `
    <tas-table [data]="rows()" identifierField="id" [config]="config()">
      <ng-template #body let-row>
        <tr class="row"><td>{{ row.id }}</td></tr>
      </ng-template>
    </tas-table>
  `,
})
class Host {
  public readonly rows = signal<{ id: number }[]>([]);
  public readonly config = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: true, pageIndex: 0, pageSize: 20, pageSizeOptions: [20], totalElements: 0 },
  });

  /** Ce que fait un écran paginé côté serveur : la page demandée, et le total du serveur. */
  public showServerPage(pageIndex: number, rows: { id: number }[], totalElements: number): void {
    this.config.set({
      property: 'id',
      pagination: { serverSide: true, pageIndex, pageSize: 20, pageSizeOptions: [20], totalElements },
    });
    this.rows.set(rows);
  }
}

describe('tas-table avec une pagination serveur', () => {
  let fixture: ComponentFixture<Host>;

  const page = (index: number) =>
    Array.from({ length: 20 }, (_, i) => ({ id: index * 20 + i }));

  const renderedIds = () =>
    Array.from(fixture.nativeElement.querySelectorAll('tr.row')).map((tr) =>
      Number((tr as HTMLElement).textContent?.trim()),
    );

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
  });

  it('rend la première page', () => {
    fixture.componentInstance.showServerPage(0, page(0), 137);
    fixture.detectChanges();

    expect(renderedIds()).toHaveLength(20);
    expect(renderedIds()[0]).toBe(0);
  });

  it('rend la DEUXIÈME page au lieu d’un tableau vide', () => {
    fixture.componentInstance.showServerPage(1, page(1), 137);
    fixture.detectChanges();

    // La régression que ce spec garde : le data source tranchait `splice(20, 20)` sur les 20 lignes
    // de la page, et l'écran affichait zéro ligne tout en annonçant 137 résultats.
    expect(renderedIds()).toHaveLength(20);
    expect(renderedIds()[0]).toBe(20);
  });

  /**
   * La séquence qu'un écran réel suit, et la seule qui dise ce que l'utilisateur voyait :
   * la configuration existe dès la construction (valeur initiale du signal, avec la bonne taille de
   * page), les données arrivent plus tard avec la réponse HTTP, et le changement de page est un
   * second aller-retour. Régler les deux dans le même cycle — ce que font les cas ci-dessus — fait
   * passer le paginateur par ses valeurs par défaut et donne un symptôme qui n'est pas celui des
   * écrans.
   */
  it('suit la séquence réelle d’un écran : première page, puis seconde', () => {
    // 1. construction : configuration en place, aucune donnée.
    fixture.detectChanges();

    // 2. première réponse.
    fixture.componentInstance.showServerPage(0, page(0), 137);
    fixture.detectChanges();
    expect(renderedIds()).toHaveLength(20);
    expect(renderedIds()[0]).toBe(0);

    // 3. l'utilisateur passe en page 2 : nouvel appel, nouvelle page.
    fixture.componentInstance.showServerPage(1, page(1), 137);
    fixture.detectChanges();
    expect(renderedIds()).toHaveLength(20);
    expect(renderedIds()[0]).toBe(20);
  });

  it('rend une page lointaine, celle où le bug était le plus visible', () => {
    fixture.componentInstance.showServerPage(6, page(6), 137);
    fixture.detectChanges();

    expect(renderedIds()).toHaveLength(20);
    expect(renderedIds()[0]).toBe(120);
  });
});
