import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CurrentUserDto } from '@sankore/crm-api';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthenticationService } from './authentification.service';
import { TenantModulesService } from './tenant-modules.service';

/**
 * Une liste ABSENTE se lit comme « aucun module » (isolation du socle, lot 3, 2026-11-09). Le
 * serveur l'envoie toujours — un tenant antérieur aux modules y reçoit les deux — : absente, c'est
 * un profil pas encore chargé, et la lire comme « tous » montrait les écrans de crédit et
 * d'assurance à un tenant du socle. Les gardes de route attendent le profil.
 */
describe('TenantModulesService', () => {
  const user = signal<CurrentUserDto | null>(null);
  let service: TenantModulesService;

  beforeEach(() => {
    user.set(null);
    TestBed.configureTestingModule({
      providers: [{ provide: AuthenticationService, useValue: { connectedUser: user } }],
    });
    service = TestBed.inject(TenantModulesService);
  });

  it('lit une liste absente comme aucun module', () => {
    user.set({ activeModules: null });

    expect(service.has('BankingMicrofinance')).toBe(false);
    expect(service.has('Insurance')).toBe(false);
  });

  it('lit une liste vide comme le socle seul', () => {
    user.set({ activeModules: [] });

    expect(service.has('BankingMicrofinance', 'Insurance')).toBe(false);
  });

  it('ouvre une surface partagée avec l’un des deux modules', () => {
    user.set({ activeModules: ['Insurance'] });

    expect(service.has('BankingMicrofinance')).toBe(false);
    expect(service.has('BankingMicrofinance', 'Insurance')).toBe(true);
  });

  it('garde un module désactivé en consultation seule, sans le rendre actif', () => {
    user.set({ activeModules: ['Insurance'], readOnlyModules: ['BankingMicrofinance'] });
    const bankingReadOnly = TestBed.runInInjectionContext(() => service.readOnly('BankingMicrofinance'));
    const insuranceReadOnly = TestBed.runInInjectionContext(() => service.readOnly('Insurance'));

    expect(service.has('BankingMicrofinance')).toBe(false);
    expect(service.canRead('BankingMicrofinance')).toBe(true);
    expect(bankingReadOnly()).toBe(true);
    expect(insuranceReadOnly()).toBe(false);
  });

  it('ne laisse rien lire d’un module jamais souscrit', () => {
    user.set({ activeModules: [], readOnlyModules: [] });

    expect(service.canRead('Insurance')).toBe(false);
  });

  it('prend la liste poussée par la page « Modules », puis le profil suivant', () => {
    user.set({ activeModules: ['Insurance', 'BankingMicrofinance'] });
    const canBank = TestBed.runInInjectionContext(() => service.can('BankingMicrofinance'));

    service.sync(['Insurance']);
    expect(canBank()).toBe(false);

    user.set({ activeModules: ['BankingMicrofinance'] });
    expect(canBank()).toBe(true);
  });
});
