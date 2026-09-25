// Le dépôt est passé de jest à vitest : ce fichier référençait encore
// `jest-preset-angular/setup-jest`, absent des dépendances, ce qui rendait
// TOUS les tests de la librairie `ui` inexécutables. Aligné sur la
// configuration déjà en place dans les autres projets.
import '@angular/compiler';
import '@analogjs/vitest-angular/setup-snapshots';
import { setupTestBed } from '@analogjs/vitest-angular/setup-testbed';

setupTestBed({ zoneless: false });
