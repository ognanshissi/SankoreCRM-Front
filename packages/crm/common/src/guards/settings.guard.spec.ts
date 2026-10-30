import { describe, expect, it } from 'vitest';
import { isWorkPageUnderSettings } from './settings.guard';

describe('isWorkPageUnderSettings', () => {
  it.each([
    '/settings/account/profil',
    '/settings/account/agendas?onglet=google',
    '/settings/workflows/ma-file',
    '/settings/workflows/9001e29f/instances/2e5688c7',
    '/settings/workflows/instances/2e5688c7',
    '/settings/telephony/journal',
    '/settings/telephony/missed',
    '/settings/distribution-assurance',
  ])('laisse ouvert l’écran de travail %s', (url) => {
    expect(isWorkPageUnderSettings(url)).toBe(true);
  });

  it.each([
    '/settings',
    '/settings/agencies',
    '/settings/users/42/connexions',
    '/settings/kyc',
    '/settings/client-segments',
    '/settings/workflows',
    '/settings/workflows/9001e29f/parcours',
    '/settings/telephony/settings',
    '/settings/accounting',
  ])('ferme la rubrique de paramétrage %s', (url) => {
    expect(isWorkPageUnderSettings(url)).toBe(false);
  });
});
