import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CurrentUserDto } from '@sankore/crm-api';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthenticationService } from './authentification.service';
import { PermissionsService } from './permissions.service';

/**
 * Mode test (lot 6) : l'équipe et l'institution appartiennent à la production, le serveur refuse
 * d'y toucher depuis le mode test — leurs droits de modification s'y lisent comme non accordés,
 * pour que les boutons disparaissent au lieu d'échouer. Le reste ne bouge pas.
 */
describe('PermissionsService en mode test', () => {
  const user = signal<CurrentUserDto | null>(null);
  let service: PermissionsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthenticationService,
          useValue: { connectedUser: user, testMode: computed(() => user()?.testMode === true) },
        },
      ],
    });
    service = TestBed.inject(PermissionsService);
  });

  it('garde en production les droits de modification de l’équipe', () => {
    user.set({ permissions: ['user:create', 'product:update'], testMode: false });

    expect(service.has('user:create')).toBe(true);
  });

  it('les retire en mode test, sans toucher au paramétrage ni à la consultation', () => {
    user.set({ permissions: ['user:create', 'agency:update', 'user:read', 'product:update', 'tenant:test-mode'], testMode: true });

    expect(service.has('user:create')).toBe(false);
    expect(service.has('agency:update')).toBe(false);
    expect(service.has('user:read')).toBe(true);
    expect(service.has('product:update')).toBe(true);
    expect(service.has('tenant:test-mode')).toBe(true);
  });
});
