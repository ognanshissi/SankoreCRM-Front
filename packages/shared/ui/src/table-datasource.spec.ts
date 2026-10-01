import { MatPaginator } from '@angular/material/paginator';
import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { TableDataSource } from '@talisoft/ui/table';

/**
 * Le découpage est la seule chose que ce data source décide, et il décidait mal.
 *
 * En mode `serverSide`, les lignes reçues SONT la page : les retrancher par
 * `pageIndex * pageSize` donne un tableau vide dès la page 2. Trois écrans passaient déjà une page
 * serveur avec le vrai `pageIndex` et étaient donc vides au-delà de la première ; deux autres
 * contournaient en fournissant tout. Ce spec existe pour qu'un « nettoyage » ne réintroduise pas le
 * découpage.
 */
describe('TableDataSource pagination', () => {
  const rows = (count: number, offset = 0) =>
    Array.from({ length: count }, (_, i) => ({ id: i + offset }));

  // `page` doit être un VRAI Observable : `connect()` le passe à `merge`, qui rejette tout le reste.
  // Un faux « assez proche » laissait passer les assertions et polluait la sortie d'une erreur rxjs.
  const paginatorAt = (pageIndex: number, pageSize: number) =>
    ({ pageIndex, pageSize, page: new Subject<unknown>() } as unknown as MatPaginator);

  const render = <T>(source: TableDataSource<T>) => {
    let rendered: T[] = [];
    source.connect().subscribe((items) => (rendered = items));
    return rendered;
  };

  it('ne redécoupe pas une page déjà paginée par le serveur', () => {
    const page2 = rows(20, 20);
    const source = new TableDataSource(page2, true);
    source.paginator = paginatorAt(1, 20);

    // Sans le drapeau, splice(20, 20) sur 20 éléments rendait [].
    expect(render(source)).toHaveLength(20);
    expect(render(source)[0]).toEqual({ id: 20 });
  });

  it('découpe toujours en pagination cliente', () => {
    const source = new TableDataSource(rows(50), false);
    source.paginator = paginatorAt(1, 20);

    const rendered = render(source);
    expect(rendered).toHaveLength(20);
    expect(rendered[0]).toEqual({ id: 20 });
  });

  it('rend la première page à l’identique dans les deux modes', () => {
    const client = new TableDataSource(rows(20), false);
    client.paginator = paginatorAt(0, 20);

    const server = new TableDataSource(rows(20), true);
    server.paginator = paginatorAt(0, 20);

    expect(render(server)).toEqual(render(client));
  });
});
