import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, debounceTime, distinctUntilChanged, EMPTY, firstValueFrom, map, of, Subject, switchMap, tap } from 'rxjs';
import {
  AppointmentsApiService,
  ClientsApiService,
  LeadsApiService,
  ScheduleAppointmentRequestModeEnum,
  UsersApiService,
} from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { dayKey } from './my-day-meta';

export interface CreateAppointmentDrawerData {
  /** Le jour choisi dans le calendrier, s'il y en a un : la date part de là. */
  day?: string | null;
  /** L'heure du créneau cliqué dans le Calendrier (« 14:30 ») ; sinon l'heure pleine suivante. */
  time?: string | null;
}

type SubjectType = 'none' | 'lead' | 'client';

interface SubjectCandidate {
  id: string;
  label: string;
  detail: string;
}

const DURATION_OPTIONS = [
  { label: '15 min', value: '15' },
  { label: '30 min', value: '30' },
  { label: '45 min', value: '45' },
  { label: '1 h', value: '60' },
  { label: '1 h 30', value: '90' },
  { label: '2 h', value: '120' },
  { label: '3 h', value: '180' },
  { label: 'Demi-journée', value: '240' },
];

const SUBJECT_OPTIONS: { label: string; value: SubjectType }[] = [
  { label: 'Personne', value: 'none' },
  { label: 'Un lead', value: 'lead' },
  { label: 'Un client', value: 'client' },
];

const MEETING_URL = /^https?:\/\/\S+$/i;

/** Ce que le serveur peut refuser, en clair. */
const ERRORS: Record<string, string> = {
  APPOINTMENT_IN_PAST: 'La date et l’heure sont déjà passées.',
  APPOINTMENT_MEETING_URL_INVALID: 'Le lien de la réunion n’est pas une adresse web valide.',
  APPOINTMENT_PARTICIPANT_UNKNOWN: 'Un des participants n’existe plus.',
  APPOINTMENT_TOO_MANY_PARTICIPANTS: 'Cinquante participants au plus.',
  LEAD_NOT_FOUND: 'Ce lead est introuvable.',
  CLIENT_NOT_FOUND: 'Ce client est introuvable ou hors de votre périmètre.',
};

class CreateAppointmentFormModel {
  public title!: string;
  public date!: string;
  public time!: string;
  public duration!: string;
  public mode!: 'InPerson' | 'Online';
  public meetingUrl!: string;
  public location!: string;
  public subjectType!: SubjectType;
  public subjectId!: string;
  public subjectLabel!: string;
  public participantIds!: string[];
  public description!: string;

  public static instantiate(day?: string | null, time?: string | null): CreateAppointmentFormModel {
    const m = new CreateAppointmentFormModel();
    // L'heure pleine suivante : un rendez-vous se pose rarement à 14 h 37.
    const next = new Date();
    next.setHours(next.getHours() + 1, 0, 0, 0);
    m.title = '';
    m.date = day && day >= dayKey(Date.now()) ? day : dayKey(next);
    m.time = time && /^\d{2}:\d{2}$/.test(time) ? time : `${String(next.getHours()).padStart(2, '0')}:00`;
    m.duration = '30';
    m.mode = 'InPerson';
    m.meetingUrl = '';
    m.location = '';
    m.subjectType = 'none';
    m.subjectId = '';
    m.subjectLabel = '';
    m.participantIds = [];
    m.description = '';
    return m;
  }
}

/**
 * Nouveau rendez-vous, depuis « Ma journée ». Avec un lead, un client ou personne (une réunion
 * interne) ; en présentiel ou en ligne, avec le lien Zoom ou Teams ; avec des collègues invités,
 * qui le reçoivent par e-mail et le retrouvent dans leur propre journée.
 *
 * La recherche du lead ou du client est une barre de recherche debouncée hors du formulaire, comme
 * partout ailleurs : seul l'élément retenu entre dans le modèle.
 */
@Component({
  selector: 'create-appointment-drawer',
  templateUrl: './create-appointment-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasMultiSelect,
    TasIcon,
    TasSpinner,
    Button,
  ],
})
export class CreateAppointmentDrawer {
  private readonly _appointmentsApi = inject(AppointmentsApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<string>>(DialogRef);
  private readonly _data = inject<CreateAppointmentDrawerData | null>(DIALOG_DATA, { optional: true });

  public readonly durationOptions = DURATION_OPTIONS;
  public readonly subjectOptions = SUBJECT_OPTIONS;
  public readonly minDate = dayKey(Date.now());

  public model = signal(CreateAppointmentFormModel.instantiate(this._data?.day, this._data?.time));

  public formSchema = form(this.model, (schema) => {
    required(schema.title, { message: 'L’objet est obligatoire' });
    required(schema.date, { message: 'La date est obligatoire' });
    required(schema.time, { message: 'L’heure est obligatoire' });

    validate(schema.time, (ctx) => {
      const date = ctx.valueOf(schema.date);
      if (!date || !ctx.value()) return null;
      return new Date(`${date}T${ctx.value()}`).getTime() > Date.now()
        ? null
        : { kind: 'min', message: 'Cette heure est déjà passée' };
    });

    validate(schema.meetingUrl, (ctx) => {
      if (ctx.valueOf(schema.mode) !== 'Online') return null;
      const url = ctx.value().trim();
      if (!url) return { kind: 'required', message: 'Le lien de la réunion est obligatoire' };
      return MEETING_URL.test(url) ? null : { kind: 'pattern', message: 'Collez le lien complet, commençant par https://' };
    });

    validate(schema.subjectId, (ctx) => {
      const type = ctx.valueOf(schema.subjectType);
      if (type === 'none' || ctx.value()) return null;
      return { kind: 'required', message: type === 'lead' ? 'Choisissez un lead dans les résultats' : 'Choisissez un client dans les résultats' };
    });
  });

  public readonly mode = computed(() => this.formSchema.mode().value());
  public readonly subjectType = computed(() => this.formSchema.subjectType().value());
  public readonly subjectLabel = computed(() => this.formSchema.subjectLabel().value());

  /** Zoom, Teams ou Meet, d'après le lien collé — le serveur fait la même lecture. */
  public readonly provider = computed(() => {
    const url = this.formSchema.meetingUrl().value().trim().toLowerCase();
    if (/^https?:\/\/([a-z0-9-]+\.)*zoom\.us\//.test(url)) return 'Zoom';
    if (/^https?:\/\/(teams\.microsoft\.com|teams\.live\.com)\//.test(url)) return 'Microsoft Teams';
    if (/^https?:\/\/meet\.google\.com\//.test(url)) return 'Google Meet';
    return '';
  });

  // ——— Participants ———

  public readonly userOptions = signal<{ label: string; value: string }[]>([]);
  public readonly isLoadingUsers = signal(true);

  // ——— Recherche du lead ou du client ———

  public readonly searchTerm = signal('');
  public readonly results = signal<SubjectCandidate[]>([]);
  public readonly isSearching = signal(false);
  public readonly hasSearched = signal(false);
  public readonly submitError = signal<string | null>(null);
  private readonly _search$ = new Subject<string>();

  constructor() {
    const me = this._auth.connectedUser()?.id;
    this._usersApi
      .listUsers('Active', undefined, undefined, 1, 500)
      .pipe(catchError(() => {
        this._snackbar.error('Erreur', 'La liste des collègues n’a pas pu être chargée.');
        return of({ items: [] });
      }))
      .subscribe((res) => {
        this.userOptions.set(
          (res.items ?? [])
            .filter((u) => u.id && u.id !== me)
            .map((u) => ({ label: u.fullName?.trim() || u.email || '—', value: u.id! }))
            .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
        );
        this.isLoadingUsers.set(false);
      });

    this._search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap((term) => {
          this.isSearching.set(term.trim().length >= 2);
          if (term.trim().length < 2) {
            this.results.set([]);
            this.hasSearched.set(false);
          }
        }),
        switchMap((term) => (term.trim().length < 2 ? of(null) : this._searchSubjects(term.trim()))),
        takeUntilDestroyed(),
      )
      .subscribe((candidates) => {
        this.isSearching.set(false);
        if (!candidates) return;
        this.hasSearched.set(true);
        this.results.set(candidates);
      });
  }

  private _searchSubjects(term: string) {
    if (this.subjectType() === 'lead') {
      return this._leadsApi
        .listLeads(1, 8, undefined, undefined, undefined, undefined, undefined, term)
        .pipe(
          map((page) => (page.items ?? []).filter((l) => l.id).map((l) => ({
            id: l.id!,
            label: l.fullName?.trim() || [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Lead sans nom',
            detail: [l.phoneNumber, l.interestedProduct && l.interestedProduct !== 'Unknown' ? l.interestedProduct : null]
              .filter(Boolean).join(' · '),
          }))),
          catchError(() => {
            this._snackbar.error('Erreur', 'La recherche de leads a échoué.');
            return of(null);
          }),
        );
    }
    return this._clientsApi
      .searchClients(undefined, undefined, undefined, term, undefined, undefined, undefined, undefined, undefined, 1, 8)
      .pipe(
        map((page) => (page.items ?? []).filter((c) => c.id).map((c) => ({
          id: c.id!,
          label: c.displayName?.trim() || 'Client',
          detail: [c.clientNumber, c.agencyName].filter(Boolean).join(' · '),
        }))),
        catchError(() => {
          this._snackbar.error('Erreur', 'La recherche de clients a échoué.');
          return of(null);
        }),
      );
  }

  public setMode(mode: 'InPerson' | 'Online'): void {
    this.formSchema.mode().value.set(mode);
  }

  public setSubjectType(type: SubjectType): void {
    if (this.subjectType() === type) return;
    this.formSchema.subjectType().value.set(type);
    this.clearSubject();
    this.searchTerm.set('');
    this.results.set([]);
    this.hasSearched.set(false);
  }

  public onSearchTermChange(term: string): void {
    this.searchTerm.set(term);
    this._search$.next(term);
  }

  public selectSubject(candidate: SubjectCandidate): void {
    this.formSchema.subjectId().value.set(candidate.id);
    this.formSchema.subjectLabel().value.set(candidate.label);
    this.results.set([]);
    this.searchTerm.set('');
    this.hasSearched.set(false);
  }

  public clearSubject(): void {
    this.formSchema.subjectId().value.set('');
    this.formSchema.subjectLabel().value.set('');
  }

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const v = field()?.value();
      if (!v) return;
      const online = v.mode === 'Online';

      const id = await firstValueFrom(
        this._appointmentsApi
          .scheduleAppointment({
            title: v.title.trim(),
            startAt: new Date(`${v.date}T${v.time}`).toISOString(),
            durationMinutes: Number(v.duration),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            mode: online ? ScheduleAppointmentRequestModeEnum.Online : ScheduleAppointmentRequestModeEnum.InPerson,
            meetingUrl: online ? v.meetingUrl.trim() : null,
            location: online ? null : v.location.trim() || null,
            leadId: v.subjectType === 'lead' ? v.subjectId : null,
            clientId: v.subjectType === 'client' ? v.subjectId : null,
            participantIds: v.participantIds,
            description: v.description.trim() || null,
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this.submitError.set(ERRORS[err.error?.detail] ?? 'Le rendez-vous n’a pas pu être créé.');
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );
      if (!id) return;

      const invited = v.participantIds.length;
      this._snackbar.success(
        'Rendez-vous créé',
        invited ? `${invited} invitation${invited > 1 ? 's' : ''} envoyée${invited > 1 ? 's' : ''} par e-mail.` : v.title.trim(),
      );
      this._dialogRef.close(id as string);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
