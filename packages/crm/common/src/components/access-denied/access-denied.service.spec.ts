import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessDeniedService } from './access-denied.service';

/**
 * Le point délicat est le cycle de vie : un refus de garde annule la
 * navigation puis en déclenche une seconde vers l'accueil. Si cette
 * seconde navigation effaçait la bannière, elle ne serait jamais visible.
 */
describe('AccessDeniedService', () => {
  let service: AccessDeniedService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new AccessDeniedService();
  });

  it('retient le refus avec l’URL tentée et la permission manquante', () => {
    service.notify('/settings/users', ['user:read']);

    expect(service.notice()).toEqual({
      attemptedUrl: '/settings/users',
      required: ['user:read'],
    });
  });

  it('survit à la navigation de redirection', () => {
    service.notify('/settings/users', ['user:read']);

    // celle-ci est la redirection vers l'accueil
    service.onNavigationSettled();

    expect(service.notice()).not.toBeNull();
  });

  it('disparaît au déplacement suivant de l’utilisateur', () => {
    service.notify('/settings/users', ['user:read']);
    service.onNavigationSettled(); // redirection
    service.onNavigationSettled(); // vrai déplacement

    expect(service.notice()).toBeNull();
  });

  it('se ferme à la demande', () => {
    service.notify('/settings/users', ['user:read']);
    service.dismiss();

    expect(service.notice()).toBeNull();
  });

  it('s’efface tout seul au bout de 10 s', () => {
    service.notify('/settings/users', ['user:read']);

    vi.advanceTimersByTime(9_000);
    expect(service.notice()).not.toBeNull();

    vi.advanceTimersByTime(1_500);
    expect(service.notice()).toBeNull();
  });

  it('un second refus réarme la temporisation et la tolérance à la redirection', () => {
    service.notify('/settings/users', ['user:read']);
    service.onNavigationSettled(); // redirection du premier refus

    service.notify('/settings/roles', ['role:read']);
    vi.advanceTimersByTime(9_000);
    service.onNavigationSettled(); // redirection du second refus

    expect(service.notice()?.attemptedUrl).toBe('/settings/roles');

    vi.advanceTimersByTime(1_500);
    expect(service.notice()).toBeNull();
  });

  it('ignore une navigation terminée quand aucune bannière n’est affichée', () => {
    expect(() => service.onNavigationSettled()).not.toThrow();
    expect(service.notice()).toBeNull();
  });
});
