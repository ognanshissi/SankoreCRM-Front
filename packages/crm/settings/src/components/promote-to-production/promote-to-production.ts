import { Dialog, DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import {
  LeadSourcesApiService,
  ProductsApiService,
  ProjectTemplatesApiService,
  PromotionDependency,
  PromotionResult,
  WebhooksApiService,
  WorkflowTemplatesApiService,
} from '@sankore/crm-api';
import { AuthenticationService, PERMISSIONS, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';

/** Ce que l'on copie — et, pour un élément lié manquant, la route du serveur qui le copie. */
export type PromotionKind = 'product' | 'project-template' | 'lead-source' | 'webhook' | 'workflow';

const KIND_LABELS: Record<PromotionKind, string> = {
  product: 'Produit',
  'project-template': 'Gabarit de projet',
  'lead-source': 'Source de leads',
  webhook: 'Webhook',
  workflow: 'Workflow',
};

const ERRORS: Record<string, string> = {
  PROMOTION_TEST_MODE_REQUIRED: 'La copie en production se fait depuis le mode test.',
  PROMOTION_SOURCE_NOT_FOUND: 'Cet élément n’existe plus dans le mode test.',
  PROMOTION_DEPENDENCY_MISSING: 'Un élément lié manque en production : copiez-le d’abord.',
  PROJECT_TEMPLATE_QUESTIONNAIRE_FORM_MISSING: 'La production n’a pas de questionnaire publié pour ce produit.',
};

/**
 * Appelle la copie en production du bon module. Le serveur fait tout le travail (rejeu des
 * commandes d'enregistrement en production) ; `dryRun` dit seulement ce qui se passerait.
 */
function promote(
  apis: {
    products: ProductsApiService;
    projects: ProjectTemplatesApiService;
    sources: LeadSourcesApiService;
    webhooks: WebhooksApiService;
    workflows: WorkflowTemplatesApiService;
  },
  kind: string,
  id: string,
  dryRun: boolean,
): Observable<PromotionResult> {
  switch (kind) {
    case 'product':
      return apis.products.promoteProduct(id, dryRun);
    case 'project-template':
      return apis.projects.promoteProjectTemplate(id, dryRun);
    case 'lead-source':
      return apis.sources.promoteLeadSource(id, dryRun);
    case 'webhook':
      return apis.webhooks.promoteWebhookSubscription(id, dryRun);
    default:
      return apis.workflows.promoteWorkflowTemplate(id, dryRun);
  }
}

interface PromoteDialogData {
  kind: PromotionKind;
  id: string;
  label: string;
}

/**
 * « Copier en production » : annonce d'abord ce qui sera créé ou mis à jour et ce qui manque en
 * production, copie les éléments liés avant l'élément lui-même, puis montre une seule fois le
 * secret que la production a émis (un webhook).
 */
@Component({
  selector: 'settings-promote-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon, TasSpinner],
  template: `
    <div class="w-[520px] max-w-[calc(100vw-32px)] rounded-2xl bg-white p-6 shadow-2xl">
      <div class="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold text-slate-900">Copier en production</h2>
          <p class="text-sm text-slate-500">{{ kindLabel }} « {{ data.label }} »</p>
        </div>
        <button type="button" class="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Fermer" (click)="close()">
          <tas-icon iconName="feather:x" style="font-size:18px"></tas-icon>
        </button>
      </div>

      @if (preview() === null && !error()) {
        <div class="flex justify-center py-8"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
      } @else if (done(); as result) {
        <p class="flex items-center gap-2 text-sm text-emerald-700">
          <tas-icon iconName="feather:check-circle" style="font-size:16px"></tas-icon>
          {{ result.action === 'Created' ? 'Créé en production.' : 'Mis à jour en production.' }}
        </p>
        @if (result.secret) {
          <div class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p class="text-sm font-semibold text-amber-900">Secret de production — affiché une seule fois</p>
            <p class="mt-1 break-all font-mono text-xs text-amber-900 select-all">{{ result.secret }}</p>
            <button tas-text-button type="button" class="mt-2" (click)="copySecret(result.secret)">Copier le secret</button>
          </div>
        }
        @if ((result.notes ?? []).length > 0) {
          <ul class="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
            @for (note of result.notes; track note) { <li>{{ note }}</li> }
          </ul>
        }
        <div class="mt-6 flex justify-end">
          <button tas-raised-button color="primary" type="button" (click)="close()">Fermer</button>
        </div>
      } @else {
        @if (preview(); as p) {
          <p class="text-sm text-slate-700">
            {{ p.action === 'Created' ? 'Il n’existe pas encore en production : il y sera créé.' : 'Il existe déjà en production : il sera mis à jour.' }}
          </p>
          @if (copyFirst().length > 0) {
            <div class="mt-4 rounded-xl bg-slate-50 p-3">
              <p class="text-sm font-medium text-slate-800">Copiés d’abord, car absents de la production :</p>
              <ul class="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
                @for (d of copyFirst(); track d.testId) { <li>{{ dependencyLabel(d) }}</li> }
              </ul>
            </div>
          }
          @if (unavailable().length > 0) {
            <div class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">
              Absent de la production et du mode test :
              @for (d of unavailable(); track d.label; let last = $last) { {{ dependencyLabel(d) }}@if (!last) {, } }.
              Créez-le d’abord.
            </div>
          }
          @if ((p.notes ?? []).length > 0) {
            <ul class="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
              @for (note of p.notes; track note) { <li>{{ note }}</li> }
            </ul>
          }
        }
        @if (error(); as e) {
          <p class="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{{ e }}</p>
        }
        <div class="mt-6 flex justify-end gap-2">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button"
                  [disabled]="!preview() || blocked() || running()" [isLoading]="running()" (click)="run()">
            Copier en production
          </button>
        </div>
      }
    </div>
  `,
})
export class PromoteDialog implements OnInit {
  public readonly data = inject<PromoteDialogData>(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _apis = {
    products: inject(ProductsApiService),
    projects: inject(ProjectTemplatesApiService),
    sources: inject(LeadSourcesApiService),
    webhooks: inject(WebhooksApiService),
    workflows: inject(WorkflowTemplatesApiService),
  };

  public readonly kindLabel = KIND_LABELS[this.data.kind];
  public readonly preview = signal<PromotionResult | null>(null);
  public readonly done = signal<PromotionResult | null>(null);
  public readonly running = signal(false);
  public readonly error = signal<string | null>(null);

  private readonly _missing = computed(() => this.preview()?.missing ?? []);
  /** Les éléments liés que le mode test possède : copiés avant celui-ci. */
  public readonly copyFirst = computed(() => this._missing().filter((d) => !!d.testId && !/^0{8}-/.test(d.testId)));
  /** Absents des deux côtés : la copie ne peut pas les apporter. */
  public readonly unavailable = computed(() => this._missing().filter((d) => d.blocking && !this.copyFirst().includes(d)));
  public readonly blocked = computed(() => this.unavailable().length > 0);

  async ngOnInit(): Promise<void> {
    try {
      this.preview.set(await firstValueFrom(promote(this._apis, this.data.kind, this.data.id, true)));
    } catch (err) {
      this.error.set(this._message(err));
    }
  }

  public dependencyLabel(d: PromotionDependency): string {
    return `${KIND_LABELS[d.kind as PromotionKind] ?? d.kind} « ${d.label} »`;
  }

  public async run(): Promise<void> {
    this.running.set(true);
    this.error.set(null);
    try {
      for (const dependency of this.copyFirst()) {
        await firstValueFrom(promote(this._apis, dependency.kind ?? '', dependency.testId!, false));
      }
      this.done.set(await firstValueFrom(promote(this._apis, this.data.kind, this.data.id, false)));
    } catch (err) {
      this.error.set(this._message(err));
    } finally {
      this.running.set(false);
    }
  }

  public copySecret(secret: string): void {
    navigator.clipboard?.writeText(secret).then(
      () => this._snackbar.success('Copié', 'Le secret est dans le presse-papiers.'),
      () => this._snackbar.error('Non copié', 'Sélectionnez le secret et copiez-le à la main.'),
    );
  }

  public close(): void {
    this._dialogRef.close(this.done() !== null);
  }

  private _message(err: unknown): string {
    const detail = err instanceof HttpErrorResponse && typeof err.error?.detail === 'string' ? err.error.detail : '';
    return ERRORS[detail] ?? (detail ? `La production a refusé la copie (${detail}).` : 'La copie n’a pas pu être faite. Réessayez.');
  }
}

/**
 * Le bouton des écrans d'édition, visible seulement en mode test et pour qui peut copier en
 * production. La copie remplace — ou crée — l'élément de même clé en production.
 */
@Component({
  selector: 'settings-promote-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon],
  template: `
    @if (visible()) {
      <button tas-outlined-button type="button" class="!border-orange-300 !text-orange-800" (click)="open()">
        <tas-icon iconName="feather:upload-cloud" style="font-size:14px" class="me-1.5"></tas-icon>
        Copier en production
      </button>
    }
  `,
})
export class PromoteButton {
  private readonly _dialog = inject(Dialog);
  private readonly _auth = inject(AuthenticationService);
  private readonly _canPromote = inject(PermissionsService).can(PERMISSIONS.TENANT_TEST_MODE_PROMOTE);

  public readonly kind = input.required<PromotionKind>();
  public readonly id = input.required<string | null | undefined>();
  public readonly label = input('');

  public readonly visible = computed(() => this._auth.testMode() && this._canPromote() && !!this.id());

  public open(): void {
    this._dialog.open(PromoteDialog, { data: { kind: this.kind(), id: this.id()!, label: this.label() } satisfies PromoteDialogData });
  }
}
