import { Component, computed, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSwitch } from '@talisoft/ui/switch';
import {
  HOSTED_FIELD_CATALOG,
  HostedFieldTemplate,
  HostedFormConfig,
  HostedFormField,
  LOCKED_FIELD_NAME,
  defaultHostedFormConfig,
  fieldFromTemplate,
} from '../lead-source-settings.types';

/**
 * FE-16 — Composer les champs du formulaire hébergé et prévisualiser le rendu.
 *
 * La définition produite a exactement la forme consommée par le SDK
 * (`WebFormResponse`) : aucune traduction entre l'éditeur et le rendu.
 */
@Component({
  selector: 'hosted-form-editor',
  standalone: true,
  imports: [
    FormsModule, TasCard, TasIcon, Button,
    TasFormField, TasLabel, TasInput, TasSelect, TasSwitch,
  ],
  templateUrl: 'hosted-form-editor.html',
})
export class HostedFormEditor implements OnInit {
  public readonly initialConfig = input<HostedFormConfig | null>(null);
  public readonly readonly = input(false);
  public readonly saved = output<HostedFormConfig>();

  public config = signal<HostedFormConfig>(defaultHostedFormConfig());
  public previewWidth = signal<'mobile' | 'desktop'>('desktop');
  public draggedIndex = signal<number | null>(null);

  public readonly catalog = HOSTED_FIELD_CATALOG;
  public readonly lockedFieldName = LOCKED_FIELD_NAME;

  /** Champs du catalogue pas encore ajoutés. */
  public readonly availableFields = computed(() => {
    const used = new Set(this.config().fields.map((f) => f.name));
    return this.catalog.filter((t) => !used.has(t.name));
  });

  ngOnInit(): void {
    const initial = this.initialConfig();
    if (initial) this.config.set({ ...initial, fields: [...initial.fields] });
    this._ensureLockedField();
  }

  // ——— Champs ———

  public addField(template: HostedFieldTemplate): void {
    this.config.update((c) => ({ ...c, fields: [...c.fields, fieldFromTemplate(template)] }));
  }

  public removeField(index: number): void {
    const field = this.config().fields[index];
    if (this.isLocked(field)) return; // FE-16 AC3
    this.config.update((c) => ({ ...c, fields: c.fields.filter((_, i) => i !== index) }));
  }

  public updateField(index: number, patch: Partial<HostedFormField>): void {
    this.config.update((c) => ({
      ...c,
      fields: c.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));
  }

  /** Le téléphone est toujours présent et toujours obligatoire (FE-16 AC3). */
  public isLocked(field: HostedFormField): boolean {
    return field.name === LOCKED_FIELD_NAME;
  }

  public setRequired(index: number, value: boolean): void {
    const field = this.config().fields[index];
    if (this.isLocked(field)) return;
    this.updateField(index, { isRequired: value });
  }

  public updateConfig<K extends keyof HostedFormConfig>(key: K, value: HostedFormConfig[K]): void {
    this.config.update((c) => ({ ...c, [key]: value }));
  }

  // ——— Options d'une liste déroulante ———

  public addOption(index: number): void {
    const field = this.config().fields[index];
    this.updateField(index, { options: [...field.options, ''] });
  }

  public updateOption(index: number, optionIndex: number, value: string): void {
    const field = this.config().fields[index];
    this.updateField(index, {
      options: field.options.map((o, i) => (i === optionIndex ? value : o)),
    });
  }

  public removeOption(index: number, optionIndex: number): void {
    const field = this.config().fields[index];
    this.updateField(index, { options: field.options.filter((_, i) => i !== optionIndex) });
  }

  // ——— Réordonnancement (glisser-déposer + clavier) ———

  public onDragStart(index: number): void {
    if (this.readonly()) return;
    this.draggedIndex.set(index);
  }

  public onDragOver(event: DragEvent): void {
    if (this.draggedIndex() === null) return;
    event.preventDefault(); // autorise le dépôt
  }

  public onDrop(targetIndex: number): void {
    const from = this.draggedIndex();
    this.draggedIndex.set(null);
    if (from === null || from === targetIndex) return;
    this._move(from, targetIndex);
  }

  /**
   * Le glisser-déposer seul exclut les utilisateurs au clavier : le même
   * réordonnancement est accessible par deux boutons.
   */
  public moveUp(index: number): void {
    if (index > 0) this._move(index, index - 1);
  }

  public moveDown(index: number): void {
    if (index < this.config().fields.length - 1) this._move(index, index + 1);
  }

  private _move(from: number, to: number): void {
    this.config.update((c) => {
      const fields = [...c.fields];
      const [moved] = fields.splice(from, 1);
      fields.splice(to, 0, moved);
      return { ...c, fields };
    });
  }

  private _ensureLockedField(): void {
    if (this.config().fields.some((f) => f.name === LOCKED_FIELD_NAME)) return;
    const template = this.catalog.find((t) => t.name === LOCKED_FIELD_NAME);
    if (template) this.addField(template);
  }

  // ——— Enregistrement ———

  public readonly canSave = computed(() =>
    this.config().fields.every((f) => !!f.label.trim()),
  );

  public save(): void {
    if (!this.canSave()) return;
    this.saved.emit(this.config());
  }
}

export default HostedFormEditor;
