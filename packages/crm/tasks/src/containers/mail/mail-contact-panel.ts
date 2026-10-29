import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ClientDetailDto, ClientsApiService, LeadDto, LeadsApiService, MailLinkDto } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CallButton } from '@sankore/crm/telephony';
import { NewTaskDrawer, NewTaskDrawerData } from '../task/new-task-drawer';
import { contactStatus, initials } from './mail-labels';

interface ContactView {
  name: string;
  email: string | null;
  status: string | null;
  rows: { label: string; value: string }[];
  next: { title: string; due: string | null; overdue: boolean } | null;
}

/**
 * Le lead ou le client de la conversation, à droite du fil (refonte de la Messagerie) : où il en
 * est, ce qu'il faut faire ensuite, et de quoi l'appeler ou lui confier une tâche sans quitter la
 * boîte. Lu avec les droits de l'agent : une fiche qu'il ne peut pas ouvrir se réduit au nom.
 */
@Component({
  selector: 'mail-contact-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Anchor, Button, TasIcon, TasSpinner, TasTag, CallButton],
  template: `
    @let l = link();
    <section class="flex flex-col gap-4 rounded-2xl bg-white p-4" [attr.aria-label]="l.entityType === 'Client' ? 'Client' : 'Lead'">
      <div class="flex items-center gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-bold text-slate-700" aria-hidden="true">
          {{ initials(view()?.name ?? l.name) }}
        </span>
        <div class="min-w-0">
          <p class="truncate font-semibold text-slate-900">{{ view()?.name ?? l.name ?? (l.entityType === 'Client' ? 'Client' : 'Lead') }}</p>
          @if (view()?.email ?? email(); as mail) {
            <p class="truncate text-xs text-slate-500">{{ mail }}</p>
          }
        </div>
      </div>

      @if (isLoading()) {
        <div class="flex justify-center py-4"><tas-spinner size="5" class="text-primary"></tas-spinner></div>
      } @else if (view(); as v) {
        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex items-center justify-between gap-3">
            <dt class="text-slate-500">{{ l.entityType === 'Client' ? 'Client' : 'Lead' }}</dt>
            <dd><tas-tag [severity]="statusMeta().severity">{{ statusMeta().label }}</tas-tag></dd>
          </div>
          @for (row of v.rows; track row.label) {
            <div class="flex items-start justify-between gap-3">
              <dt class="shrink-0 text-slate-500">{{ row.label }}</dt>
              <dd class="text-right font-medium text-slate-900">{{ row.value }}</dd>
            </div>
          }
        </dl>

        @if (v.next; as next) {
          <div class="rounded-xl bg-slate-50 px-3 py-2.5">
            <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Prochaine action</p>
            <p class="mt-0.5 text-sm font-semibold text-slate-900">{{ next.title }}</p>
            @if (next.due) {
              <p class="text-xs" [class]="next.overdue ? 'font-semibold text-red-700' : 'text-slate-500'">{{ next.overdue ? 'En retard · ' : '' }}{{ next.due }}</p>
            }
          </div>
        }
      } @else if (unavailable()) {
        <p class="text-xs text-slate-500">La fiche n’a pas pu être lue — elle est peut-être hors de votre périmètre.</p>
      }

      <div class="flex flex-col gap-2">
        <a tas-raised-button color="primary" class="w-full justify-center" [routerLink]="route()">Ouvrir la fiche</a>
        <!-- Le bouton d'appel se masque sans téléphonie : son hôte vide ne doit pas garder sa moitié de ligne. -->
        <div class="flex gap-2 *:flex-1 [&>:empty]:hidden">
          <!-- Se masque lui-même si l'agent ne peut pas appeler (TEL-F-04) : le numéro reste au serveur. -->
          <lib-call-button [entityType]="l.entityType === 'Client' ? 'Customer' : 'Lead'" [entityId]="l.entityId!" label="Appeler"></lib-call-button>
          @if (canManageTasks()) {
            <button tas-outlined-button type="button" class="justify-center" (click)="newTask()">
              <tas-icon iconName="feather:check-square" iconClass="!size-3.5"></tas-icon> Tâche
            </button>
          }
        </div>
      </div>
    </section>
  `,
})
export class MailContactPanel {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _drawer = inject(SideDrawerService);
  public readonly canManageTasks = inject(PermissionsService).can('lead:task:manage');

  public readonly link = input.required<MailLinkDto>();
  /** L'adresse de la conversation : affichée tant que la fiche n'a pas répondu, ou si elle ne répond pas. */
  public readonly email = input<string | null>(null);

  public readonly isLoading = signal(false);
  public readonly unavailable = signal(false);
  public readonly view = signal<ContactView | null>(null);

  public readonly initials = initials;
  public readonly statusMeta = computed(() => contactStatus(this.link().entityType, this.view()?.status));
  public readonly route = computed(() =>
    this.link().entityType === 'Client' ? ['/customers', this.link().entityId] : ['/leads', this.link().entityId],
  );

  constructor() {
    effect(() => {
      const link = this.link();
      untracked(() => this._load(link));
    });
  }

  public newTask(): void {
    const l = this.link();
    this._drawer.open<string, NewTaskDrawerData, NewTaskDrawer>(NewTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { subject: { type: l.entityType === 'Client' ? 'client' : 'lead', id: l.entityId!, label: this.view()?.name ?? l.name ?? '' } },
    });
  }

  private _load(link: MailLinkDto): void {
    this.view.set(null);
    this.unavailable.set(false);
    if (!link.entityId) return;
    this.isLoading.set(true);

    const done = (view: ContactView | null) => {
      this.view.set(view);
      this.unavailable.set(view === null);
      this.isLoading.set(false);
    };

    if (link.entityType === 'Client') {
      this._clientsApi.getClient(link.entityId).pipe(catchError(() => of(null))).subscribe((c) => done(c ? clientView(c) : null));
    } else {
      this._leadsApi.getLead(link.entityId).pipe(catchError(() => of(null))).subscribe((lead) => done(lead ? leadView(lead) : null));
    }
  }
}

function dueLabel(value: string | null | undefined): string | null {
  return value ? new Date(value).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : null;
}

function leadView(lead: LeadDto): ContactView {
  const rows: ContactView['rows'] = [];
  const product = lead.interestedProduct && lead.interestedProduct !== 'Unknown' ? lead.interestedProduct : null;
  if (product) rows.push({ label: 'Produit', value: product });
  const next = lead.nextStep?.title
    ? { title: lead.nextStep.title, due: dueLabel(lead.nextStep.dueAt), overdue: !!lead.nextStep.isOverdue }
    : null;
  return { name: lead.fullName ?? '', email: lead.email ?? null, status: lead.status ?? null, rows, next };
}

function clientView(client: ClientDetailDto): ContactView {
  const rows: ContactView['rows'] = [];
  if (client.clientNumber) rows.push({ label: 'N° client', value: client.clientNumber });
  if (client.segmentCode) rows.push({ label: 'Segment', value: client.segmentCode });
  // L'adresse d'un client est masquée côté serveur ; celle de la conversation s'affiche à la place.
  return { name: client.displayName ?? client.clientNumber ?? '', email: null, status: client.status ?? null, rows, next: null };
}
