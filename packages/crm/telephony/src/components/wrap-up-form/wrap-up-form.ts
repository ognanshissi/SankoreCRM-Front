import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  CallOutcomeDto,
  RecordingPolicyDtoModeEnum,
  TelephonyApiService,
} from '@sankore/crm-api';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { EMPTY, catchError, firstValueFrom } from 'rxjs';
import { telephonyErrorMessage } from '../../data-access/telephony-referential';

class WrapUpFormModel {
  public outcomeCode!: string;
  public note!: string;
  public callbackAt!: string;
  public keepRecording!: boolean;

  public static instantiate(suggested: string): WrapUpFormModel {
    const model = new WrapUpFormModel();
    model.outcomeCode = suggested;
    model.note = '';
    model.callbackAt = '';
    model.keepRecording = false;
    return model;
  }
}

/**
 * Qualification d'un appel terminé (TEL-F-06).
 *
 * Ce formulaire est partagé par le panneau d'appel et par l'onglet « À qualifier » du journal.
 * Il est ici, dans `components/`, pour cette raison : deux copies seraient deux opinions sur
 * la date de rappel obligatoire et sur la case d'enregistrement, et celle qui dérive est
 * toujours celle que personne ne relit.
 *
 * Trois règles viennent du serveur et ne sont pas réinventées ici :
 *
 * 1. **La liste des issues est le référentiel du tenant**, pas une énumération. Deux de ses
 *    colonnes portent un comportement — `countsAsContact` arrête l'horloge de premier contact
 *    d'un lead, `requiresCallbackDate` rend la date obligatoire — donc on affiche ce que le
 *    serveur donne et on lit ses drapeaux au lieu de les deviner.
 * 2. **La date de rappel est exigée par l'issue choisie**, et la validation suit ce drapeau en
 *    direct : sans ça, le serveur refuse en 422 `TELEPHONY_CALLBACK_DATE_REQUIRED` sur un
 *    formulaire que l'agent croyait complet.
 * 3. **La case « Conserver l'enregistrement » n'apparaît qu'en mode « À la demande »**, parce
 *    que c'est le seul mode où le serveur en tient compte. En « Tous les appels » elle est
 *    redondante, et en « Désactivé » l'honorer serait un contournement de la politique.
 */
@Component({
  selector: 'lib-wrap-up-form',
  imports: [
    FormRoot,
    FormField,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasCheckbox,
    TasDatePicker,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wrap-up-form.html',
})
export class WrapUpForm {
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly callId = input.required<string>();

  /**
   * Le statut de l'appel, qui décide de l'issue proposée par défaut. Un appel non décroché
   * part sur « Pas joint » et une messagerie sur « Messagerie » : l'agent corrige si besoin,
   * mais il ne saisit pas ce que le système sait déjà.
   */
  public readonly callStatus = input<string | null>(null);

  public readonly outcomes = input<CallOutcomeDto[]>([]);

  /** Le mode de la politique d'enregistrement, qui décide si la case est offerte. */
  public readonly recordingMode = input<string | null>(null);

  public readonly saved = output<void>();
  public readonly cancelled = output<void>();

  public readonly isSaving = signal(false);

  public readonly activeOutcomes = computed(() => this.outcomes().filter((o) => o.isActive));

  public readonly outcomeOptions = computed(() =>
    this.activeOutcomes().map((o) => ({ label: o.label ?? o.code ?? '', value: o.code ?? '' })),
  );

  /**
   * L'issue proposée d'après le statut. Les codes de la base de référence de la plateforme
   * sont stables (`NOT_REACHED`, `VOICEMAIL`), mais un tenant peut les avoir désactivés — d'où
   * le repli sur la première issue active plutôt qu'un code en dur qui ne serait pas dans la
   * liste déroulante.
   */
  public readonly suggestedOutcome = computed(() => {
    const wanted =
      this.callStatus() === 'Voicemail'
        ? 'VOICEMAIL'
        : this.callStatus() === 'Missed' || this.callStatus() === 'Failed'
          ? 'NOT_REACHED'
          : null;

    const active = this.activeOutcomes();

    if (wanted && active.some((o) => o.code === wanted)) return wanted;

    return active[0]?.code ?? '';
  });

  /**
   * Si l'issue choisie exige une date de rappel. Lu sur le référentiel, pas sur une liste de
   * codes : c'est le tenant qui décide, et il peut changer d'avis.
   */
  public readonly requiresCallback = computed(() => {
    const code = this.model().outcomeCode;

    return this.activeOutcomes().find((o) => o.code === code)?.requiresCallbackDate === true;
  });

  public readonly showKeepRecording = computed(
    () => this.recordingMode() === RecordingPolicyDtoModeEnum.OnDemand,
  );

  public model = signal(WrapUpFormModel.instantiate(''));

  public formSchema = form(this.model, (schema) => {
    required(schema.outcomeCode, { message: 'Choisissez une issue' });

    validate(schema.callbackAt, (ctx) => {
      // Lu sur l'issue choisie, pas sur une liste de codes en dur : c'est le référentiel du
      // tenant qui décide quelles issues exigent une date, et il est modifiable.
      const code = ctx.valueOf(schema.outcomeCode);
      const outcome = this.activeOutcomes().find((o) => o.code === code);

      if (!outcome?.requiresCallbackDate) return null;

      return (ctx.value() ?? '').trim().length > 0
        ? null
        : { kind: 'required', message: 'Cette issue demande une date de rappel' };
    });
  });

  constructor() {
    // L'issue par défaut n'est connue qu'une fois le référentiel chargé, donc le modèle est
    // reposé plutôt qu'initialisé — c'est le patron d'édition du dépôt, où le modèle part du
    // DTO après la réponse du serveur.
    effect(() => {
      const suggested = this.suggestedOutcome();

      if (suggested && !this.model().outcomeCode) {
        this.model.set(WrapUpFormModel.instantiate(suggested));
      }
    });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();

      if (!value) return;

      this.isSaving.set(true);

      const outcome = this.activeOutcomes().find((o) => o.code === value.outcomeCode);

      const saved = await firstValueFrom(
        this._telephonyApi
          .wrapUpTelephonyCall(this.callId(), {
            outcomeCode: value.outcomeCode,
            note: value.note.trim() || null,
            // Envoyée seulement si l'issue la demande : une date posée sur une issue qui n'en
            // veut pas est conservée par le serveur, ce qui est voulu, mais la laisser filer
            // depuis un champ masqué poserait une date que l'agent n'a pas vue.
            callbackAt:
              outcome?.requiresCallbackDate && value.callbackAt
                ? new Date(value.callbackAt).toISOString()
                : null,
            keepRecording: this.showKeepRecording() ? value.keepRecording : null,
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Qualification impossible',
                telephonyErrorMessage(error, "L'appel n'a pas pu être qualifié."),
              );
              this.isSaving.set(false);

              return EMPTY;
            }),
          )
          .pipe(catchError(() => EMPTY)),
      ).then(
        () => true,
        () => false,
      );

      this.isSaving.set(false);

      if (!saved) return;

      this._snackbar.success('Appel qualifié', "L'activité a été créée sur la fiche.");
      this.saved.emit();
    });
  }

  public cancel(): void {
    this.cancelled.emit();
  }
}
