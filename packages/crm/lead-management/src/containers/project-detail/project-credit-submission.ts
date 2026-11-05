import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, finalize, of } from 'rxjs';
import { CreditSubmissionDto, OpportunitiesApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';

interface StateView {
  label: string;
  detail: string;
  icon: string;
  tone: string;
}

const STATES: Record<string, StateView> = {
  NotApproved: {
    label: 'Pas encore envoyé',
    detail: 'Le dossier partira au core banking une fois l’accord donné.',
    icon: 'feather:clock',
    tone: 'text-slate-600',
  },
  Incomplete: {
    label: 'À compléter',
    detail: 'Le dossier ne peut pas partir tant qu’il manque :',
    icon: 'feather:alert-circle',
    tone: 'text-amber-800',
  },
  NoConnection: {
    label: 'Non envoyé',
    detail: 'Aucun core banking n’est connecté : le dossier s’arrête à la décision.',
    icon: 'feather:slash',
    tone: 'text-slate-600',
  },
  NotSupported: {
    label: 'Non envoyé',
    detail: 'Ce core banking ne reçoit pas encore les demandes de prêt : à saisir de son côté.',
    icon: 'feather:slash',
    tone: 'text-slate-600',
  },
  NotRequested: {
    label: 'Pas encore envoyé',
    detail: 'Le dossier est prêt à partir.',
    icon: 'feather:send',
    tone: 'text-slate-600',
  },
  InProgress: {
    label: 'Envoi en cours',
    detail: 'Le core banking n’a pas encore répondu.',
    icon: 'feather:loader',
    tone: 'text-sky-700',
  },
  Batched: {
    label: 'Déposé dans un fichier',
    detail: 'En attente de l’accusé de réception du core banking.',
    icon: 'feather:file-text',
    tone: 'text-sky-700',
  },
  Accepted: {
    label: 'Reçu par le core banking',
    detail: 'La suite du prêt se gère dans le core banking.',
    icon: 'feather:check-circle',
    tone: 'text-emerald-700',
  },
  Rejected: {
    label: 'Refusé par le core banking',
    detail: 'À reprendre avec l’administrateur, depuis les commandes d’intégration.',
    icon: 'feather:x-circle',
    tone: 'text-red-700',
  },
  Cancelled: {
    label: 'Envoi annulé',
    detail: 'Un administrateur a annulé cet envoi.',
    icon: 'feather:slash',
    tone: 'text-slate-600',
  },
};

/** Où en est un dossier de crédit avec le core banking. Rien pour un autre projet. */
@Component({
  selector: 'project-credit-submission',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Button, TasCard, TasIcon],
  template: `
    @if (status(); as s) {
      @if (view(); as v) {
        <tas-card class="block" id="credit-submission">
          <div class="p-5">
            <h2 class="text-base font-semibold text-slate-900">Envoi au core banking</h2>
            <p class="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold" [class]="v.tone">
              <tas-icon [iconName]="v.icon" style="font-size:14px"></tas-icon>{{ v.label }}
            </p>
            <p class="mt-1 text-sm text-slate-600">{{ v.detail }}</p>
            @if (s.state === 'Incomplete' || s.state === 'NotApproved') {
              @if (s.missing?.length) {
                <p class="mt-1 text-sm text-slate-700">
                  @if (s.state === 'NotApproved') { À compléter d’ici là : }{{ s.missing!.join(', ') }}
                </p>
              }
            }
            @if (s.reference) {
              <p class="mt-1 text-xs text-slate-500">Référence : {{ s.reference }}</p>
            }
            @if (s.message && s.state !== 'Accepted') {
              <p class="mt-1 text-xs text-slate-500">{{ s.message }}</p>
            }
            @if (s.at) {
              <p class="mt-1 text-xs text-slate-400">{{ s.at | date: 'dd/MM/yyyy à HH:mm' }}</p>
            }
            @if (canSend() && s.state === 'NotRequested') {
              <button tas-outlined-button type="button" class="mt-3" [isLoading]="sending()" [disabled]="sending()" (click)="send()">
                Envoyer au core banking
              </button>
            }
          </div>
        </tas-card>
      }
    }
  `,
})
export class ProjectCreditSubmission {
  private readonly _api = inject(OpportunitiesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly projectId = input.required<string>();
  /** Change quand le projet bouge : une étape franchie peut déclencher l'envoi. */
  public readonly version = input<string | null | undefined>(null);
  public readonly canSend = input(false);

  public readonly status = signal<CreditSubmissionDto | null>(null);
  public readonly sending = signal(false);
  public readonly view = computed(() => STATES[this.status()?.state ?? '']);

  constructor() {
    effect(() => {
      this.version();
      this._load(this.projectId());
    });
  }

  public send(): void {
    this.sending.set(true);
    this._api
      .sendProjectCreditSubmission(this.projectId())
      .pipe(
        catchError(() => {
          this._snackbar.error('Envoi impossible', 'Le dossier n’a pas pu partir au core banking.');
          return EMPTY;
        }),
        finalize(() => this.sending.set(false)),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => {
        this._snackbar.success('Envoi demandé', 'Le dossier part au core banking.');
        this._load(this.projectId());
      });
  }

  private _load(id: string): void {
    this._api
      .getProjectCreditSubmission(id)
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this._destroyRef))
      .subscribe((status) => this.status.set(status));
  }
}
