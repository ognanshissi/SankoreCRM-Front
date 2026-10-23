import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CurrentUserDto } from '@sankore/crm-api';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthenticationService } from './authentification.service';
import { TenantModulesService } from './tenant-modules.service';

/**
 * Le point qui compte : une liste ABSENTE n'est pas une liste vide. Absente, c'est une API
 * antérieure aux modules ou un profil pas encore chargé, et le serveur lit alors « tous les
 * modules » ; la lire comme vide masquerait des écrans que l'institution a payés.
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

  it('lit une liste absente comme tous les modules', () => {
    user.set({ activeModules: null });

    expect(service.has('BankingMicrofinance')).toBe(true);
    expect(service.has('Insurance')).toBe(true);
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
