import { describe, expect, it } from 'vitest';
import { visibleCatalog } from './settings-catalog';

/**
 * Le catalogue filtre sur deux axes indépendants : la permission dit QUI peut ouvrir un écran,
 * le module payant dit si l'écran existe pour l'institution. Une entrée sans module est du socle.
 */
describe('visibleCatalog', () => {
  const everyPermission = new Set([
    'Integration.Mapping.Manage',
    'Integration.Command.View',
    'Integration.Reconciliation.View',
    'Telephony.Call.View',
    'Integration.Connection.View',
    'Ins.Product.Manage',
    'Ins.Statement.View',
  ]);
  const ids = (modules: string[]) =>
    visibleCatalog(everyPermission, new Set(modules)).flatMap((g) => g.entries.map((e) => e.id));

  it('retire les écrans partagés core banking / assurance au socle seul, garde la téléphonie', () => {
    const socle = ids([]);

    expect(socle).not.toContain('mappings');
    expect(socle).not.toContain('commands');
    expect(socle).not.toContain('batch-files');
    expect(socle).not.toContain('reconciliation');
    expect(socle).toContain('telephony');
  });

  it('ouvre les écrans partagés avec l’un ou l’autre module', () => {
    expect(ids(['BankingMicrofinance'])).toContain('reconciliation');
    expect(ids(['Insurance'])).toContain('reconciliation');
  });

  it('réserve les écrans assurance au module « Assurance »', () => {
    const insurance = ['insurance-products', 'insurance-connections', 'insurance-statements'];

    for (const id of insurance) {
      expect(ids(['BankingMicrofinance'])).not.toContain(id);
      expect(ids(['Insurance'])).toContain(id);
    }
    expect(ids([])).toContain('connections');
  });

  it('ne montre toujours rien sans la permission, module ou pas', () => {
    const none = visibleCatalog(new Set(), new Set(['BankingMicrofinance', 'Insurance']));
    expect(none.flatMap((g) => g.entries.map((e) => e.id))).not.toContain('mappings');
  });
});
