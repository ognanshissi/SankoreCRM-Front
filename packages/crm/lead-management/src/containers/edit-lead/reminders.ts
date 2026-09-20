import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { LeadsApiService, ReminderDto, ReminderDtoStatusEnum } from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';

function reminderStatusMeta(r: ReminderDto): { label: string; severity: Severity; icon: string } {
  if (r.status === ReminderDtoStatusEnum.Completed) return { label: 'Terminé', severity: 'success', icon: 'feather:check-circle' };
  if (r.status === ReminderDtoStatusEnum.Dismissed) return { label: 'Écarté', severity: 'neutral', icon: 'feather:x-circle' };
  if (r.isOverdue) return { label: 'En retard', severity: 'error', icon: 'feather:alert-octagon' };
  return { label: 'En attente', severity: 'warning', icon: 'feather:bell' };
}

@Component({
  selector: 'lead-reminders',
  imports: [FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button, TasFormField, TasLabel, TasInput, TimeagoPipe],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">
        <!-- Create -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="font-semibold text-slate-800">Nouveau rappel</p>
          </div>
          <div class="p-4">
            <div class="grid grid-cols-3 gap-3">
              <tas-form-field>
                <tas-label>Titre <span class="text-red-500">*</span></tas-label>
                <input tasInput type="text" placeholder="Ex : Rappeler le client"
                  [ngModel]="newTitle()" (ngModelChange)="newTitle.set($event)" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Échéance <span class="text-red-500">*</span></tas-label>
                <input tasInput type="datetime-local" [ngModel]="newDueAt()" (ngModelChange)="newDueAt.set($event)" />
              </tas-form-field>
              <div class="flex items-end">
                <button tas-button color="primary" type="button" class="text-xs"
                  [disabled]="isCreating() || !newTitle().trim() || !newDueAt()" (click)="create()">
                  @if (isCreating()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
                  <tas-icon iconName="feather:bell" style="font-size:12px"></tas-icon> Créer
                </button>
              </div>
            </div>
            <div class="mt-2">
              <tas-form-field>
                <tas-label>Notes</tas-label>
                <input tasInput type="text" placeholder="Notes optionnelles…"
                  [ngModel]="newNotes()" (ngModelChange)="newNotes.set($event)" />
              </tas-form-field>
            </div>
          </div>
        </tas-card>

        <!-- List -->
        <tas-card>
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <p class="font-semibold text-slate-800">Rappels</p>
            @if (reminders().length > 0) {
              <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium tabular-nums">{{ reminders().length }}</span>
            }
          </div>
          @if (reminders().length === 0) {
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <tas-icon iconName="feather:bell-off" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
              <p class="text-sm text-slate-400">Aucun rappel</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (r of reminders(); track r.id) {
                @let meta = reminderMeta(r);
                <div class="p-4 flex items-start gap-3" [class]="r.isOverdue && r.status === 'Pending' ? 'bg-red-50/40' : ''">
                  <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    [class]="r.isOverdue && r.status === 'Pending' ? 'bg-red-100 text-red-500' : r.status === 'Completed' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'">
                    <tas-icon [iconName]="meta.icon" style="font-size:14px"></tas-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-0.5">
                      <p class="text-sm font-medium text-slate-800" [class]="r.status !== 'Pending' ? 'line-through opacity-60' : ''">{{ r.title }}</p>
                      <tas-tag [severity]="meta.severity">{{ meta.label }}</tas-tag>
                    </div>
                    @if (r.notes) { <p class="text-xs text-slate-500 mt-0.5">{{ r.notes }}</p> }
                    <div class="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      @if (r.dueAt) { <span>Échéance : {{ r.dueAt | dateTimeAgo }}</span> }
                      @if (r.resolvedAt) { <span>Résolu : {{ r.resolvedAt | dateTimeAgo }}</span> }
                    </div>

                    <!-- Reschedule inline -->
                    @if (r.status === 'Pending' && reschedulingId() === r.id) {
                      <div class="flex items-center gap-2 mt-2">
                        <input type="datetime-local" class="text-xs border border-slate-200 rounded px-2 py-1"
                          [ngModel]="rescheduleDate()" (ngModelChange)="rescheduleDate.set($event)" />
                        <button tas-button color="primary" type="button" class="text-xs" [disabled]="!rescheduleDate()" (click)="confirmReschedule(r)">OK</button>
                        <button type="button" class="text-xs text-slate-400" (click)="reschedulingId.set(null)">Annuler</button>
                      </div>
                    }
                  </div>
                  @if (r.status === 'Pending') {
                    <div class="flex items-center gap-1 shrink-0">
                      <button type="button" class="p-1 text-green-500 hover:text-green-700" title="Terminer" (click)="complete(r)">
                        <tas-icon iconName="feather:check" style="font-size:14px"></tas-icon>
                      </button>
                      <button type="button" class="p-1 text-amber-500 hover:text-amber-700" title="Reporter" (click)="startReschedule(r)">
                        <tas-icon iconName="feather:calendar" style="font-size:14px"></tas-icon>
                      </button>
                      <button type="button" class="p-1 text-slate-400 hover:text-red-500" title="Écarter" (click)="dismiss(r)">
                        <tas-icon iconName="feather:x" style="font-size:14px"></tas-icon>
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </tas-card>
      </div>
    }
  `,
})
export class LeadRemindersPage {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _auth = inject(AuthenticationService);

  public readonly id = input.required<string>();
  public readonly reminderMeta = reminderStatusMeta;

  public isLoading = signal(true);
  public isCreating = signal(false);
  public reminders = signal<ReminderDto[]>([]);
  public newTitle = signal('');
  public newDueAt = signal('');
  public newNotes = signal('');
  public reschedulingId = signal<string | null>(null);
  public rescheduleDate = signal('');

  constructor() { effect(() => this._load()); }

  public create(): void {
    if (!this.newTitle().trim() || !this.newDueAt()) return;
    this.isCreating.set(true);
    this._leadsApi.createLeadReminder(this.id(), {
      title: this.newTitle().trim(),
      dueAt: new Date(this.newDueAt()).toISOString(),
      notes: this.newNotes().trim() || null,
      createdBy: this._auth.connectedUser()?.id,
    }).pipe(catchError(() => { this._snackbar.error('Erreur', 'Création échouée.'); return EMPTY; }))
      .subscribe(() => {
        this._snackbar.success('Rappel créé', 'Le rappel a été programmé.');
        this.newTitle.set(''); this.newDueAt.set(''); this.newNotes.set('');
        this.isCreating.set(false); this._load();
      });
  }

  public complete(r: ReminderDto): void {
    this._leadsApi.completeLeadReminder(this.id(), r.id!).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Opération échouée.'); return EMPTY; }),
    ).subscribe(() => {
      this.reminders.update((list) => list.map((x) => x.id === r.id ? { ...x, status: ReminderDtoStatusEnum.Completed, resolvedAt: new Date().toISOString() } : x));
    });
  }

  public dismiss(r: ReminderDto): void {
    this._leadsApi.dismissLeadReminder(this.id(), r.id!).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Opération échouée.'); return EMPTY; }),
    ).subscribe(() => {
      this.reminders.update((list) => list.map((x) => x.id === r.id ? { ...x, status: ReminderDtoStatusEnum.Dismissed, resolvedAt: new Date().toISOString() } : x));
    });
  }

  public startReschedule(r: ReminderDto): void {
    this.reschedulingId.set(r.id ?? null);
    this.rescheduleDate.set('');
  }

  public confirmReschedule(r: ReminderDto): void {
    if (!this.rescheduleDate()) return;
    this._leadsApi.rescheduleLeadReminder(this.id(), r.id!, {
      newDueAt: new Date(this.rescheduleDate()).toISOString(),
    }).pipe(catchError(() => { this._snackbar.error('Erreur', 'Report échoué.'); return EMPTY; }))
      .subscribe(() => {
        this._snackbar.success('Rappel reporté', 'La nouvelle échéance a été enregistrée.');
        this.reschedulingId.set(null); this._load();
      });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._leadsApi.listLeadReminders(this.id()).pipe(
      catchError(() => { this.isLoading.set(false); return EMPTY; }),
    ).subscribe((r) => { this.reminders.set(r ?? []); this.isLoading.set(false); });
  }
}

export default LeadRemindersPage;
