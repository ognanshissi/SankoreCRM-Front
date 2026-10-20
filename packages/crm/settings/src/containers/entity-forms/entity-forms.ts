import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { catchError, EMPTY, finalize } from 'rxjs';
import {
  EntityFormDto,
  FormField as EntityFormField,
  FormsApiService,
  FormSection,
} from '@sankore/crm-api';
import { BreadcrumbService, EntityFormRenderer, PermissionsService, RenderMode, WireValues } from '@sankore/crm/common';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasTag } from '@talisoft/ui/tag';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { FieldEditorData, FieldEditorDrawer } from './field-editor-drawer';
import { SectionEditorData, SectionEditorDrawer } from './section-editor-drawer';
import {
  ENTITY_TABS,
  entityTab,
  fieldsOfGroup,
  fieldTypeIcon,
  fieldTypeLabel,
  FormEntityKey,
  orderedSections,
  translateFormError,
} from './entity-forms.models';

export interface FieldGroup {
  /** `''` pour les champs hors section. */
  key: string;
  section: FormSection | null;
  fields: EntityFormField[];
}

type ViewMode = 'edit' | 'quick' | 'full';

/**
 * L'éditeur des formulaires Lead, Client et Produit (formulaires dynamiques, lot 2).
 *
 * <p>La mise en page vit ici en signaux et part au serveur d'un seul `PUT` : c'est le contrat du
 * serveur, qui valide le document entier et refuse une version déjà remplacée. Les panneaux de champ
 * et de section ne parlent pas au serveur, ils rendent leur résultat à cet écran.</p>
 *
 * <p>Après l'enregistrement, l'écran repart de ce que le serveur a renvoyé et pas de ce qu'il a
 * envoyé : le serveur renumérote, reprend les types et options des champs natifs, et c'est ce qu'il
 * a gardé que l'administrateur doit voir.</p>
 */
@Component({
  selector: 'entity-forms',
  templateUrl: './entity-forms.html',
  imports: [TasCard, TasSpinner, TasIcon, Button, TasSwitch, TasTag, DragDropModule, NgTemplateOutlet, EntityFormRenderer],
})
export class EntityFormsPage implements OnInit {
  private readonly _formsApi = inject(FormsApiService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canManage = this._permissions.can('form:manage');

  public readonly tabs = ENTITY_TABS;
  public readonly entity = signal<FormEntityKey>('Lead');
  public readonly tab = computed(() => entityTab(this.entity()));

  public readonly isLoading = signal(true);
  public readonly isSaving = signal(false);
  public readonly loadError = signal(false);

  public readonly version = signal(0);
  public readonly sections = signal<FormSection[]>([]);
  public readonly fields = signal<EntityFormField[]>([]);
  private readonly _saved = signal('');
  /** Les champs personnalisés que le serveur connaît : ils s'archivent, ne se suppriment pas. */
  public readonly savedCustomKeys = signal<string[]>([]);

  public readonly mode = signal<ViewMode>('edit');
  public readonly previewKind = signal('');
  public readonly showArchived = signal(false);

  public readonly fieldTypeLabel = fieldTypeLabel;
  public readonly fieldTypeIcon = fieldTypeIcon;

  public readonly isDirty = computed(() => this._snapshot() !== this._saved());

  public readonly groups = computed<FieldGroup[]>(() => {
    const fields = this.fields();
    const groups: FieldGroup[] = orderedSections(this.sections()).map((section) => ({
      key: section.key ?? '',
      section,
      fields: fieldsOfGroup(fields, section.key ?? ''),
    }));
    const loose = fieldsOfGroup(fields, '');
    // Le groupe « Général » n'apparaît que s'il contient quelque chose, ou s'il n'y a aucune section.
    if (loose.length > 0 || groups.length === 0) groups.unshift({ key: '', section: null, fields: loose });
    return groups;
  });

  public readonly dropListIds = computed(() => this.groups().map((g) => this.dropListId(g.key)));

  public readonly archived = computed(() => this.fields().filter((f) => f.isArchived));

  public readonly counts = computed(() => {
    const live = this.fields().filter((f) => !f.isArchived);
    return {
      total: live.length,
      custom: live.filter((f) => !f.isNative).length,
      quick: live.filter((f) => f.quickAdd && !f.isHidden).length,
      required: live.filter((f) => f.isRequired).length,
    };
  });

  /** Les valeurs du champ « type » (particulier / entreprise…), pour l'aperçu. */
  public readonly kindOptions = computed(() => {
    const kind = this.fields().find((f) => f.key === this.tab().kindField);
    return (kind?.options ?? []).map((o) => ({ value: o.value ?? '', label: o.label ?? o.value ?? '' }));
  });

  /** La mise en page telle qu'elle est à l'écran, enregistrée ou non, pour l'aperçu. */
  public readonly previewForm = computed<EntityFormDto>(() => ({
    entity: this.entity() as EntityFormDto['entity'],
    version: this.version(),
    sections: this.sections(),
    fields: this.fields(),
  }));

  public readonly previewMode = computed<RenderMode>(() => (this.mode() === 'quick' ? 'quick' : 'full'));

  /**
   * Le type choisi au-dessus de l'aperçu, et rien d'autre : les autres champs démarrent vides. Un
   * objet et non null, pour que le choix du type ne soit pas écrasé par la valeur par défaut du champ
   * — le revers est que l'aperçu n'affiche pas les autres valeurs par défaut.
   */
  public readonly previewValues = computed<WireValues>(() => ({ [this.tab().kindField]: this.previewKind() || null }));

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramètres', link: ['/settings'] },
      { label: 'Formulaires' },
    ]);

    this._route.paramMap.pipe(takeUntilDestroyed(this._destroyRef)).subscribe((params) => {
      const next = entityTab(params.get('entity')).key;
      this.entity.set(next);
      this.mode.set('edit');
      this._load();
    });
  }

  public selectEntity(key: FormEntityKey): void {
    if (key === this.entity()) return;
    if (!this.isDirty()) {
      this._router.navigate(['/settings/forms', key]);
      return;
    }
    this._confirm.confirm({
      title: 'Modifications non enregistrées',
      message: `Les changements du formulaire ${this.tab().label.toLowerCase()} seront perdus.`,
      closable: true,
      acceptButtonProps: { label: 'Changer de formulaire', theme: 'warn' },
      rejectButtonProps: { label: 'Rester' },
      accept: () => this._router.navigate(['/settings/forms', key]),
    });
  }

  // ── Chargement et enregistrement ────────────────────────────────────

  private _load(): void {
    this.isLoading.set(true);
    this.loadError.set(false);
    this._formsApi
      .getEntityForm(this.entity())
      .pipe(
        catchError(() => {
          this.loadError.set(true);
          this._snackbar.error('Erreur', 'Impossible de charger le formulaire.');
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((form) => this._apply(form));
  }

  private _apply(form: EntityFormDto): void {
    this.version.set(form.version ?? 0);
    this.sections.set(form.sections ?? []);
    this.fields.set(form.fields ?? []);
    this._saved.set(this._snapshot());
    this.savedCustomKeys.set(
      form.version ? (form.fields ?? []).filter((f) => !f.isNative).map((f) => f.key ?? '') : [],
    );
    if (!this.kindOptions().some((o) => o.value === this.previewKind())) {
      this.previewKind.set(this.kindOptions()[0]?.value ?? '');
    }
  }

  private _snapshot(): string {
    return JSON.stringify({ s: this.sections(), f: this.fields() });
  }

  public discard(): void {
    this._load();
  }

  public save(): void {
    if (!this.canManage() || this.isSaving()) return;
    this.isSaving.set(true);

    this._formsApi
      .saveEntityForm(this.entity(), {
        expectedVersion: this.version(),
        sections: this.sections(),
        fields: this.fields(),
      })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          const detail: string | undefined = err.error?.detail;
          this._snackbar.error(
            err.status === 409 ? 'Formulaire modifié entre-temps' : 'Enregistrement refusé',
            translateFormError(detail, this.fields(), this.sections()),
          );
          return EMPTY;
        }),
        finalize(() => this.isSaving.set(false)),
      )
      .subscribe((form) => {
        this._apply(form);
        this._snackbar.success('Enregistré', `Le formulaire ${this.tab().label.toLowerCase()} est à jour.`);
      });
  }

  // ── Glisser-déposer ─────────────────────────────────────────────────

  public dropListId(groupKey: string): string {
    return `form-group-${groupKey || '__general'}`;
  }

  public onSectionDrop(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex === event.currentIndex) return;
    const ordered = orderedSections(this.sections());
    moveItemInArray(ordered, event.previousIndex, event.currentIndex);
    this.sections.set(ordered.map((s, i) => ({ ...s, order: i + 1 })));
  }

  public onFieldDrop(event: CdkDragDrop<string>): void {
    const fromKey = event.previousContainer.data;
    const toKey = event.container.data;
    const from = fieldsOfGroup(this.fields(), fromKey);
    const to = fromKey === toKey ? from : fieldsOfGroup(this.fields(), toKey);

    if (fromKey === toKey) moveItemInArray(from, event.previousIndex, event.currentIndex);
    else transferArrayItem(from, to, event.previousIndex, event.currentIndex);

    const placed = new Map<string, { sectionKey: string | null; order: number }>();
    from.forEach((f, i) => placed.set(f.key ?? '', { sectionKey: fromKey || null, order: i + 1 }));
    to.forEach((f, i) => placed.set(f.key ?? '', { sectionKey: toKey || null, order: i + 1 }));

    this.fields.update((fields) =>
      fields.map((f) => {
        const p = placed.get(f.key ?? '');
        return p ? { ...f, ...p } : f;
      }),
    );
  }

  // ── Drapeaux en ligne ───────────────────────────────────────────────

  public toggleQuickAdd(field: EntityFormField, on: boolean): void {
    if (field.isRequired) return;
    this._patchField(field.key!, { quickAdd: on });
  }

  public toggleSectionTitle(section: FormSection, on: boolean): void {
    this.sections.update((sections) => sections.map((s) => (s.key === section.key ? { ...s, quickAdd: on } : s)));
  }

  private _patchField(key: string, patch: Partial<EntityFormField>): void {
    this.fields.update((fields) => fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  // ── Champs ──────────────────────────────────────────────────────────

  public openField(field: EntityFormField | null, groupKey = ''): void {
    if (!this.canManage()) return;
    const data: FieldEditorData = {
      field,
      defaultSectionKey: groupKey,
      sections: this.sections(),
      fields: this.fields(),
      savedCustomKeys: this.savedCustomKeys(),
    };
    const ref = this._sideDrawer.open<EntityFormField, FieldEditorData, FieldEditorDrawer>(FieldEditorDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });
    ref.closed.subscribe((result) => {
      if (!result) return;
      if (field) this.fields.update((fields) => fields.map((f) => (f.key === field.key ? result : f)));
      else this.fields.update((fields) => [...fields, result]);
    });
  }

  /**
   * Un champ personnalisé jamais enregistré se retire ; un champ que le serveur connaît s'archive,
   * parce que des fiches peuvent déjà en porter une valeur — et le serveur refuserait sa suppression.
   */
  public removeOrArchive(field: EntityFormField): void {
    const saved = this.savedCustomKeys().includes(field.key ?? '');
    this._confirm.confirm({
      title: saved ? 'Archiver ce champ' : 'Retirer ce champ',
      message: saved
        ? `« ${field.label} » ne sera plus proposé. Les valeurs déjà saisies sont conservées et restent lisibles ; vous pourrez le restaurer.`
        : `« ${field.label} » n'a jamais été enregistré : il est simplement retiré.`,
      closable: true,
      acceptButtonProps: { label: saved ? 'Archiver' : 'Retirer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        if (saved) this._patchField(field.key!, { isArchived: true, isRequired: false, quickAdd: false });
        else this.fields.update((fields) => fields.filter((f) => f.key !== field.key));
      },
    });
  }

  public restore(field: EntityFormField): void {
    const target = field.sectionKey && this.sections().some((s) => s.key === field.sectionKey) ? field.sectionKey : null;
    this._patchField(field.key!, {
      isArchived: false,
      sectionKey: target,
      order: fieldsOfGroup(this.fields(), target ?? '').length + 1,
    });
  }

  // ── Sections ────────────────────────────────────────────────────────

  public openSection(section: FormSection | null): void {
    if (!this.canManage()) return;
    const data: SectionEditorData = { section, sections: this.sections(), fields: this.fields() };
    const ref = this._sideDrawer.open<FormSection, SectionEditorData, SectionEditorDrawer>(SectionEditorDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });
    ref.closed.subscribe((result) => {
      if (!result) return;
      if (section) this.sections.update((sections) => sections.map((s) => (s.key === section.key ? result : s)));
      else this.sections.update((sections) => [...sections, result]);
    });
  }

  /** Les champs d'une section supprimée rejoignent « Général », à la suite de ceux qui y sont déjà. */
  public removeSection(section: FormSection): void {
    const count = fieldsOfGroup(this.fields(), section.key ?? '').length;
    this._confirm.confirm({
      title: 'Supprimer la section',
      message:
        count > 0
          ? `Les ${count} champ(s) de « ${section.title} » seront déplacés dans « Général ».`
          : `La section « ${section.title} » est vide et sera supprimée.`,
      closable: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        const start = fieldsOfGroup(this.fields(), '').length;
        let n = 0;
        this.fields.update((fields) =>
          fields.map((f) => (f.sectionKey === section.key ? { ...f, sectionKey: null, order: start + ++n } : f)),
        );
        this.sections.update((sections) =>
          sections.filter((s) => s.key !== section.key).map((s, i) => ({ ...s, order: i + 1 })),
        );
      },
    });
  }

  public conditionLabel(condition: EntityFormField['visibleWhen']): string | null {
    if (!condition?.fieldKey) return null;
    const target = this.fields().find((f) => f.key === condition.fieldKey);
    const values = (condition.values ?? []).map(
      (v) =>
        target?.options?.find((o) => o.value === v)?.label ?? (v === 'true' ? 'Oui' : v === 'false' ? 'Non' : v),
    );
    return `Si ${target?.label ?? condition.fieldKey} : ${values.join(', ')}`;
  }
}

export default EntityFormsPage;
