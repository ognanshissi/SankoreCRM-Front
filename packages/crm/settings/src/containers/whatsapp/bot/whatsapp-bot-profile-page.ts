import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { applyEach, form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import {
  SaveWhatsAppBotProfileRequest,
  WhatsAppApiService,
  WhatsAppBotProfileDto,
  WhatsAppBotVersionDto,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasSwitch } from '@talisoft/ui/switch';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { BOT_DAYS, BOT_TIME_ZONES, botErrorMessage } from './whatsapp-bot-referential';

interface FaqRow { question: string; answer: string }
interface DayRow { day: number; label: string; enabled: boolean; start: string; end: string }
interface FieldRow { code: string; label: string; selected: boolean; required: boolean; custom: boolean }

class BotProfileFormModel {
  public isEnabled!: boolean;
  public welcomeMessage!: string;
  public outOfHoursMessage!: string;
  public instructions!: string;
  public faq!: FaqRow[];
  public fields!: FieldRow[];
  public days!: DayRow[];
  public timeZoneId!: string;
  /** Séparés par des virgules : la saisie la plus rapide pour une dizaine de mots. */
  public keywords!: string;
  public maxTurnsWithoutAnswer!: string;
  /** En heures, converties en minutes à l'envoi. */
  public windowThresholdHours!: string;

  /**
   * Un créneau par jour à l'écran. Le serveur en accepte plusieurs ; un second créneau saisi
   * ailleurs serait perdu au prochain enregistrement, d'où la note sous la grille.
   */
  public static fromDto(dto: WhatsAppBotProfileDto): BotProfileFormModel {
    const m = new BotProfileFormModel();
    const hours = dto.agentHours ?? [];
    const selected = new Set(dto.fieldsToCollect ?? []);
    const required = new Set(dto.fieldsRequiredForLead ?? []);

    m.isEnabled = !!dto.isEnabled;
    m.welcomeMessage = dto.welcomeMessage ?? '';
    m.outOfHoursMessage = dto.outOfHoursMessage ?? '';
    m.instructions = dto.instructions ?? '';
    m.faq = (dto.faq ?? []).map((f) => ({ question: f.question ?? '', answer: f.answer ?? '' }));
    m.fields = (dto.availableFields ?? []).map((f) => ({
      code: f.code ?? '',
      label: f.label ?? f.code ?? '',
      selected: selected.has(f.code ?? ''),
      required: required.has(f.code ?? ''),
      custom: !!f.isCustom,
    }));
    m.days = BOT_DAYS.map(({ day, label }) => {
      const slot = hours.find((h) => h.day === day);
      return { day, label, enabled: !!slot, start: slot?.start ?? '08:00', end: slot?.end ?? '17:00' };
    });
    m.timeZoneId = dto.timeZoneId || 'Africa/Abidjan';
    m.keywords = (dto.escalationKeywords ?? []).join(', ');
    m.maxTurnsWithoutAnswer = String(dto.maxTurnsWithoutAnswer ?? 2);
    m.windowThresholdHours = String(Math.round(((dto.windowExpiryThresholdMinutes ?? 120) / 60) * 10) / 10);
    return m;
  }
}

/**
 * Le profil du chatbot pour un produit, ou le profil général (WA-FE-11).
 *
 * Chaque enregistrement crée une version, jamais une modification : un tour de bot enregistre la
 * version sous laquelle il a répondu, et doit pouvoir être expliqué par les consignes qu'il avait.
 * L'historique permet de recharger une version passée dans le formulaire ; elle n'est rétablie
 * qu'en l'enregistrant, ce qui en fait une version nouvelle.
 *
 * `expectedVersion` empêche deux administrateurs d'écraser le travail l'un de l'autre : le second
 * enregistrement est refusé (409) au lieu d'effacer le premier sans le dire.
 */
@Component({
  selector: 'whatsapp-bot-profile-page',
  templateUrl: './whatsapp-bot-profile-page.html',
  imports: [
    DatePipe,
    RouterLink,
    Anchor,
    Button,
    TasCard,
    TasError,
    TasFormField,
    TasHint,
    TasLabel,
    TasIcon,
    TasInput,
    TasSelect,
    TasSpinner,
    TasSwitch,
    TasTable,
    TasTag,
    FormRoot,
    FormField,
  ],
})
export class WhatsAppBotProfilePage implements OnInit {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);

  public readonly timeZones = BOT_TIME_ZONES;

  public key = '';
  public isLoading = signal(true);
  public loadError = signal<string | null>(null);
  public profile = signal<WhatsAppBotProfileDto | null>(null);
  /** La version passée rechargée dans le formulaire, s'il y en a une. */
  public restoredVersion = signal<number | null>(null);

  public readonly history = computed<WhatsAppBotVersionDto[]>(() => this.profile()?.history ?? []);
  public readonly isGeneral = computed(() => !this.profile()?.productLineId);

  public historyConfig = signal<TableConfig>({
    property: 'version',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 20], totalElements: 0 },
  });

  public model = signal(BotProfileFormModel.fromDto({}));
  public formSchema = form(this.model, (schema) => {
    validate(schema.welcomeMessage, (ctx) =>
      ctx.value().length > 1000 ? { kind: 'max', message: '1 000 caractères au plus' } : null,
    );
    validate(schema.outOfHoursMessage, (ctx) =>
      ctx.value().length > 1000 ? { kind: 'max', message: '1 000 caractères au plus' } : null,
    );
    validate(schema.instructions, (ctx) =>
      ctx.value().length > 4000 ? { kind: 'max', message: '4 000 caractères au plus' } : null,
    );
    applyEach(schema.faq, (entry) => {
      required(entry.question, { message: 'La question est obligatoire' });
      required(entry.answer, { message: 'La réponse est obligatoire' });
    });
    applyEach(schema.days, (day) => {
      validate(day.end, (ctx) =>
        ctx.valueOf(day.enabled) && ctx.value() <= ctx.valueOf(day.start)
          ? { kind: 'order', message: 'Fin avant début' }
          : null,
      );
    });
    validate(schema.maxTurnsWithoutAnswer, (ctx) => {
      const n = Number(ctx.value());
      return !Number.isInteger(n) || n < 0 || n > 10 ? { kind: 'range', message: 'Entre 0 et 10' } : null;
    });
    validate(schema.windowThresholdHours, (ctx) => {
      const n = Number(String(ctx.value()).replace(',', '.'));
      return Number.isNaN(n) || n < 0 || n > 23 ? { kind: 'range', message: 'Entre 0 et 23 heures' } : null;
    });
  });

  ngOnInit(): void {
    this.key = this._route.snapshot.paramMap.get('key') ?? 'general';
    this._load();
  }

  // ——— Gestes hors contrôles ———

  public setEnabled(enabled: boolean): void {
    this.model.update((m) => ({ ...m, isEnabled: enabled }));
  }

  public toggleDay(index: number, enabled: boolean): void {
    this.model.update((m) => ({ ...m, days: m.days.map((d, i) => (i === index ? { ...d, enabled } : d)) }));
  }

  public addFaq(): void {
    this.model.update((m) => ({ ...m, faq: [...m.faq, { question: '', answer: '' }] }));
  }

  public removeFaq(index: number): void {
    this.model.update((m) => ({ ...m, faq: m.faq.filter((_, i) => i !== index) }));
  }

  public restore(version: WhatsAppBotVersionDto): void {
    if (version.version == null || version.version === this.profile()?.version) {
      this.model.set(BotProfileFormModel.fromDto(this.profile() ?? {}));
      this.restoredVersion.set(null);
      return;
    }

    this._api
      .getWhatsAppBotProfileVersion(this.key, version.version)
      .pipe(
        catchError((err: unknown) => {
          this._snackbar.error('Erreur', botErrorMessage(err, 'Cette version n’a pas pu être chargée.'));
          return EMPTY;
        }),
      )
      .subscribe((past) => {
        this.model.set(BotProfileFormModel.fromDto({ ...past, availableFields: this.profile()?.availableFields }));
        this.restoredVersion.set(version.version ?? null);
      });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const current = this.profile();

      const request: SaveWhatsAppBotProfileRequest = {
        expectedVersion: current?.version ?? 0,
        isEnabled: v.isEnabled,
        welcomeMessage: v.welcomeMessage.trim() || null,
        outOfHoursMessage: v.outOfHoursMessage.trim() || null,
        instructions: v.instructions.trim() || null,
        faq: v.faq.map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })),
        fieldsToCollect: v.fields.filter((f) => f.selected).map((f) => f.code),
        // Indispensable n'a de sens que pour un champ recueilli : une case restée cochée sur un
        // champ décoché ne doit pas faire refuser l'enregistrement.
        fieldsRequiredForLead: v.fields.filter((f) => f.selected && f.required).map((f) => f.code),
        agentHours: v.days.filter((d) => d.enabled).map((d) => ({ day: d.day, start: d.start, end: d.end })),
        timeZoneId: v.timeZoneId,
        escalationKeywords: v.keywords.split(',').map((k) => k.trim()).filter((k) => k.length > 0),
        maxTurnsWithoutAnswer: Number(v.maxTurnsWithoutAnswer),
        windowExpiryThresholdMinutes: Math.round(Number(String(v.windowThresholdHours).replace(',', '.')) * 60),
      };

      const saved = await firstValueFrom(
        this._api.saveWhatsAppBotProfile(this.key, request).pipe(
          catchError((err: unknown) => {
            this._snackbar.error('Enregistrement refusé', botErrorMessage(err, 'Le profil n’a pas pu être enregistré.'));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      if (saved) {
        this._snackbar.success('Profil enregistré', `Version ${saved.version} ${saved.isEnabled ? 'active' : 'enregistrée, bot désactivé'}.`);
        // Relu plutôt que déduit : l'historique et l'auteur viennent du serveur.
        this._load();
      }
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._api
      .getWhatsAppBotProfile(this.key)
      .pipe(
        catchError((err: unknown) => {
          this.loadError.set(botErrorMessage(err, 'Ce profil n’a pas pu être chargé.'));
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((profile) => {
        this.profile.set(profile);
        this.model.set(BotProfileFormModel.fromDto(profile));
        this.restoredVersion.set(null);
        this.isLoading.set(false);

        this._breadcrumb.set([
          { label: 'Paramétrage', link: ['/settings'] },
          { label: 'Chatbot WhatsApp', link: ['/settings/whatsapp/bot'] },
          { label: profile.name ?? 'Profil' },
        ]);
      });
  }
}

export default WhatsAppBotProfilePage;
