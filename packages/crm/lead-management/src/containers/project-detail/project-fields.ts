import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY, map, Observable } from 'rxjs';
import {
  EntityFormDto,
  EntityFormDtoEntityEnum,
  FormFieldTypeEnum,
  OpportunitiesApiService,
  OpportunityDto,
  ProjectAttachmentDto,
  ProjectFieldDefinition,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasCard } from '@talisoft/ui/card';
import { CustomFieldsCard, WireValue } from '@sankore/crm/common';

/** Section unique du formulaire bâti à partir des champs du gabarit. */
const SECTION = 'project';

type AttachmentRow = ProjectAttachmentDto & { id: string; fieldLabel: string };

/**
 * Les champs que le gabarit du projet déclare (propriétaire, 2026-10-26) : les valeurs passent par
 * la même carte que les champs personnalisés d'un lead ou d'un client, les pièces jointes par une
 * liste à part — un fichier n'est pas une valeur.
 */
@Component({
  selector: 'project-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Button, TasCard, TasIcon, TasTable, CustomFieldsCard],
  template: `
    @if (valueFields().length) {
      <div id="project-fields">
        <custom-fields-card
          title="Informations du parcours"
          [formDefinition]="form()"
          [values]="values()"
          [canEdit]="canEdit()"
          [save]="saveFn"
          (saved)="changed.emit()"
        ></custom-fields-card>
      </div>
    }

    @if (fileFields().length) {
      <tas-card class="block" id="project-files">
        <div class="flex flex-col gap-3 p-5">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Pièces du projet</p>
          <div class="flex flex-col gap-2">
            @for (f of fileFields(); track f.key) {
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-slate-800">
                    {{ f.label }}
                    @if (requiredAt(f.key); as step) {
                      <span class="ms-1 text-xs font-normal text-slate-400">— exigé pour « {{ step }} »</span>
                    }
                  </p>
                  <p class="text-xs text-slate-500">
                    {{ countOf(f.key) }} fichier(s){{ f.helpText ? ' · ' + f.helpText : '' }}
                  </p>
                </div>
                @if (canEdit()) {
                  <label class="cursor-pointer">
                    <input type="file" class="hidden" (change)="upload(f, $event)" [disabled]="uploading() === f.key" />
                    <span tas-outlined-button color="primary" class="pointer-events-none">
                      <tas-icon iconName="feather:upload" style="font-size:14px"></tas-icon>&nbsp;
                      {{ uploading() === f.key ? 'Envoi…' : 'Ajouter un fichier' }}
                    </span>
                  </label>
                }
              </div>
            }
          </div>

          @if (attachments().length) {
            <tas-table [data]="attachments()" identifierField="id" [config]="tableConfig" [hasCaption]="false">
              <ng-template #header>
                <tr>
                  <th>Fichier</th>
                  <th>Pour</th>
                  <th>Ajouté le</th>
                  <th class="text-right"></th>
                </tr>
              </ng-template>
              <ng-template #body let-row>
                <tr>
                  <td class="py-2">
                    <p class="text-sm text-slate-800">{{ row.fileName }}</p>
                    <p class="text-xs text-slate-400 tabular-nums">{{ sizeLabel(row.sizeBytes) }}</p>
                  </td>
                  <td class="py-2 text-sm text-slate-600">{{ row.fieldLabel }}</td>
                  <td class="py-2 text-sm text-slate-600">{{ row.uploadedAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                  <td class="py-2 text-right">
                    <button tas-button iconButton type="button" (click)="download(row)" aria-label="Télécharger" title="Télécharger">
                      <tas-icon iconName="feather:download" style="font-size:14px" class="text-slate-500"></tas-icon>
                    </button>
                    @if (canEdit()) {
                      <button tas-button iconButton type="button" (click)="remove(row)" aria-label="Retirer" title="Retirer">
                        <tas-icon iconName="feather:trash-2" style="font-size:14px" class="text-slate-400"></tas-icon>
                      </button>
                    }
                  </td>
                </tr>
              </ng-template>
            </tas-table>
          }
        </div>
      </tas-card>
    }
  `,
})
export class ProjectFields {
  private readonly _api = inject(OpportunitiesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly project = input.required<OpportunityDto>();
  public readonly canEdit = input(false);
  /** Une écriture a abouti : la page relit le projet. */
  public readonly changed = output<void>();

  public readonly uploading = signal<string | null>(null);

  public readonly tableConfig: TableConfig = {
    property: 'project-files',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25] },
  };

  private readonly _fields = computed(() => this.project().fields ?? []);
  public readonly valueFields = computed(() => this._fields().filter((f) => f.type !== 'Attachment'));
  public readonly fileFields = computed(() => this._fields().filter((f) => f.type === 'Attachment'));

  /** Les champs du gabarit lus comme une mise en page : la carte et ses contrôles les rendent tels quels. */
  public readonly form = computed<EntityFormDto>(() => ({
    entity: EntityFormDtoEntityEnum.Lead,
    version: 0,
    sections: [{ key: SECTION, title: '', order: 0 }],
    fields: this.valueFields().map((f, i) => ({
      key: f.key,
      type: f.type as unknown as FormFieldTypeEnum,
      label: f.label,
      order: i,
      sectionKey: SECTION,
      helpText: f.helpText ?? null,
      options: f.options?.map((o) => ({ value: o.value, label: o.label })) ?? null,
    })),
  }));

  public readonly values = computed(() => (this.project().customFields ?? null) as Record<string, unknown> | null);

  public readonly attachments = computed<AttachmentRow[]>(() => {
    const labels = new Map(this._fields().map((f) => [f.key ?? '', f.label ?? '']));
    return (this.project().attachments ?? []).map((a) => ({
      ...a,
      id: a.id ?? '',
      fieldLabel: labels.get(a.fieldKey ?? '') ?? a.fieldKey ?? '',
    }));
  });

  public readonly saveFn = (payload: Record<string, WireValue>): Observable<unknown> =>
    this._api.setProjectFields(this.project().id!, { values: payload as Record<string, unknown> as never });

  /** La première étape qui exige le champ, pour dire à l'agent quand il le lui faudra. */
  public requiredAt(key: string | null | undefined): string | null {
    const step = (this.project().steps ?? []).find((s) => (s.requiredFieldKeys ?? []).includes(key ?? ''));
    return step?.label ?? null;
  }

  public countOf(key: string | null | undefined): number {
    return (this.project().attachments ?? []).filter((a) => a.fieldKey === key).length;
  }

  public sizeLabel(bytes: number | undefined): string {
    const b = bytes ?? 0;
    return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`;
  }

  public upload(field: ProjectFieldDefinition, event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file || !field.key) return;
    this.uploading.set(field.key);
    this._api
      .addProjectAttachment(this.project().id!, field.key, file)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Fichier refusé', attachmentError(error));
          this.uploading.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.uploading.set(null);
        this._snackbar.success('Fichier ajouté', `« ${file.name} » est joint au projet.`);
        this.changed.emit();
      });
  }

  /** Le client généré type la réponse `object` ; c'est bien un `Blob` qui arrive. */
  public download(row: AttachmentRow): void {
    this._api
      .downloadProjectAttachment(this.project().id!, row.id)
      .pipe(
        map((body) => body as unknown as Blob),
        catchError(() => {
          this._snackbar.error('Téléchargement impossible', 'Le fichier n’a pas pu être lu.');
          return EMPTY;
        }),
      )
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = row.fileName ?? 'fichier';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
  }

  public remove(row: AttachmentRow): void {
    this._confirm.confirm({
      title: 'Retirer ce fichier ?',
      message: `« ${row.fileName} » ne sera plus joint au projet.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Retirer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () =>
        this._api
          .removeProjectAttachment(this.project().id!, row.id)
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Retrait impossible', attachmentError(error));
              return EMPTY;
            }),
          )
          .subscribe(() => this.changed.emit()),
    });
  }
}

function attachmentError(error: HttpErrorResponse): string {
  const code = String((error.error as { error?: string } | null)?.error ?? '');
  switch (code) {
    case 'TASK_ATTACHMENT_TOO_LARGE':
      return 'Le fichier dépasse 10 Mo.';
    case 'TASK_ATTACHMENT_TYPE_NOT_ALLOWED':
      return 'Type de fichier refusé : PDF, image, document Office ou texte seulement.';
    case 'TASK_ATTACHMENT_EMPTY':
      return 'Le fichier est vide.';
    case 'PROJECT_TOO_MANY_ATTACHMENTS':
      return 'Dix fichiers au plus par pièce.';
    case 'PROJECT_ATTACHMENTS_UNAVAILABLE':
      return 'Le stockage des pièces n’est pas configuré sur ce serveur.';
    case 'OPPORTUNITY_ALREADY_CLOSED':
      return 'Le projet est clos : ses pièces ne changent plus.';
    default:
      return 'Le fichier n’a pas pu être enregistré.';
  }
}
