import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import {
  BreadcrumbService,
  PermissionsService,
  TEST_MODE_REFRESH_PERMISSIONS,
  TestModeRefreshDialog,
  TestModeSwitcher,
} from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';

/**
 * Le mode test expliqué, au même endroit que ses commandes : ce qui est séparé, ce qui reste
 * partagé, ce qui ne sort jamais vers les clients, et comment faire passer un réglage d'un côté à
 * l'autre. L'interrupteur de l'en-tête reste le geste courant ; cette page est celle qu'on ouvre
 * la première fois, ou pour montrer à un collègue.
 */
@Component({
  selector: 'settings-test-mode-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasCard, TasIcon],
  template: `
    <div class="mx-auto flex max-w-3xl flex-col gap-5">
      <tas-card class="block">
        <div class="flex flex-wrap items-center gap-4 p-5">
          <span class="grid size-12 shrink-0 place-items-center rounded-full"
                [class]="switcher.on() ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'" aria-hidden="true">
            <tas-icon iconName="feather:tool" style="font-size:22px"></tas-icon>
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-base font-semibold text-slate-900">
              {{ switcher.on() ? 'Vous êtes en mode test' : 'Vous êtes en production' }}
            </p>
            <p class="text-sm text-slate-500">
              {{ switcher.on()
                ? 'Les données et le paramétrage affichés sont ceux de la copie d’essai de l’institution.'
                : 'Le mode test est une copie d’essai de l’institution, pour régler et essayer sans toucher à la production.' }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            @if (switcher.on() && canRefresh()) {
              <button tas-outlined-button type="button" (click)="refresh()">Repartir de la production</button>
            }
            <button tas-raised-button color="primary" type="button" [disabled]="switcher.switching()" [isLoading]="switcher.switching()"
                    (click)="switcher.switch(!switcher.on())">
              {{ switcher.on() ? 'Revenir en production' : 'Passer en mode test' }}
            </button>
          </div>
        </div>
      </tas-card>

      <tas-card class="block">
        <div class="grid gap-6 p-5 sm:grid-cols-2">
          @for (block of blocks; track block.title) {
            <section>
              <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                <tas-icon [iconName]="block.icon" class="text-slate-400" style="font-size:15px"></tas-icon>
                {{ block.title }}
              </h2>
              <ul class="list-disc space-y-1 pl-5 text-sm text-slate-600">
                @for (line of block.lines; track line) { <li>{{ line }}</li> }
              </ul>
            </section>
          }
        </div>
      </tas-card>
    </div>
  `,
})
export class TestModePage implements OnInit {
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _dialog = inject(Dialog);

  public readonly switcher = inject(TestModeSwitcher);
  public readonly canRefresh = inject(PermissionsService).canAll(...TEST_MODE_REFRESH_PERMISSIONS);

  public readonly blocks = [
    {
      title: 'Séparé de la production',
      icon: 'feather:layers',
      lines: [
        'Leads, clients, projets, tâches et toutes les données saisies.',
        'Produits, workflows, gabarits de projet, sources de leads, webhooks, formulaires, modèles et paramètres d’envoi.',
        'Les clés de l’essai commencent par pk_test_ et whsec_test_ : une clé de test ne mène jamais à la production.',
      ],
    },
    {
      title: 'Partagé avec la production',
      icon: 'feather:users',
      lines: [
        'Les utilisateurs, rôles, agences et territoires, et la fiche de l’institution.',
        'Ils se consultent ici mais se modifient en production.',
        'Votre profil et votre mot de passe restent modifiables partout.',
      ],
    },
    {
      title: 'Rien ne part vers les clients',
      icon: 'feather:shield',
      lines: [
        'E-mails, SMS, WhatsApp et appels ne vont qu’aux utilisateurs de l’institution ; le reste est bloqué et tracé.',
        'Les webhooks portent « test »: true, et ceux repris de la production arrivent désactivés.',
        'Le core banking et l’assureur suivent la connexion configurée dans le mode test.',
      ],
    },
    {
      title: 'Passer d’un côté à l’autre',
      icon: 'feather:repeat',
      lines: [
        '« Copier en production », sur la fiche d’un produit, d’un workflow, d’un gabarit, d’une source ou d’un webhook.',
        '« Repartir de la production » reprend toute la configuration de production dans le mode test.',
        'Un workflow copié arrive inactif en production : on l’active après l’avoir relu.',
      ],
    },
  ];

  ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'Mode test' }]);
  }

  public refresh(): void {
    this._dialog.open(TestModeRefreshDialog);
  }
}

export default TestModePage;
