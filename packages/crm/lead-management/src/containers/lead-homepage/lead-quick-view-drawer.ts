import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { ActivityDto, LeadDto, LeadsApiService } from '@sankore/crm-api';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasTitle } from '@talisoft/ui/title';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { LeadNextStep } from '../../components/lead-next-step';
import { interestedProductLabel } from '../../components/interested-product';
import {
  activityTypeMeta,
  displayName,
  formatAmount,
  initials,
  intentOption,
  leadStatusMeta,
  originLabel,
  prospectTypeLabel,
} from '../edit-lead/lead-view.models';

export interface LeadQuickViewData {
  lead: LeadDto;
  /** Ce que la page connaît déjà et que `LeadDto` ne porte qu'en identifiant. */
  phaseLabel: string | null;
  agentName: string;
  agencyName: string;
  sla: { label: string; tone: 'ok' | 'warning' | 'breach' } | null;
}

/** Le nombre d'activités montrées : de quoi situer l'échange, le reste est dans la fiche. */
const RECENT_ACTIVITIES = 3;

@Component({
  selector: 'lead-quick-view-drawer',
  templateUrl: './lead-quick-view-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasTag,
    TasSpinner,
    Button,
    Anchor,
    TimeagoPipe,
    LeadNextStep,
  ],
})
export class LeadQuickViewDrawer implements OnInit {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _router = inject(Router);
  private readonly _dialogRef = inject(DialogRef);
  public readonly data = inject<LeadQuickViewData>(DIALOG_DATA);

  public readonly lead = this.data.lead;
  public readonly name = displayName(this.lead);
  public readonly initials = initials(this.name);
  public readonly status = leadStatusMeta(this.lead.status);
  public readonly intent = intentOption(this.lead.intentLevel);
  public readonly product = interestedProductLabel(this.lead.interestedProduct);
  public readonly amount = formatAmount(this.lead.desiredAmount?.amount, this.lead.desiredAmount?.currency);
  public readonly origin = originLabel(this.lead);
  public readonly prospectType = prospectTypeLabel(this.lead.prospectType);
  public readonly typeMeta = activityTypeMeta;

  public readonly score = Math.max(0, Math.min(100, this.lead.score ?? 0));
  public readonly threshold = this.lead.qualificationThreshold ?? 60;
  public readonly scoreBar =
    this.score >= this.threshold ? 'bg-green-600' : this.score >= 40 ? 'bg-amber-500' : 'bg-red-500';

  public readonly place = [this.lead.address?.neighbourhood, this.lead.address?.city]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(', ');

  public readonly isAwaitingDispatch = !!this.lead.awaitingDispatchSince && !this.lead.currentAssignmentId;

  public readonly isLoadingActivities = signal(true);
  public readonly activities = signal<ActivityDto[]>([]);
  public readonly hasActivities = computed(() => this.activities().length > 0);

  ngOnInit(): void {
    // Un échec ici ne doit pas fermer l'aperçu : le reste vient de la liste, déjà chargé.
    this._leadsApi
      .listLeadActivities(this.lead.id!, 1, RECENT_ACTIVITIES)
      .pipe(
        catchError(() => EMPTY),
        finalize(() => this.isLoadingActivities.set(false)),
      )
      .subscribe((items) => this.activities.set(items ?? []));
  }

  /** Ouvre la fiche complète, sur l'onglet voulu. */
  public openRecord(...tab: string[]): void {
    this._dialogRef.close();
    this._router.navigate(['/leads', this.lead.id, ...tab]);
  }

  public close(): void {
    this._dialogRef.close();
  }
}
