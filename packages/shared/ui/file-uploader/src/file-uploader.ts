import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { TasIcon } from '@talisoft/ui/icon';

/**
 * Zone de dépôt de fichier : glisser-déposer, carte du fichier retenu, retrait.
 *
 * Le composant implémente `FormValueControl<File | null>` et non plus
 * `ControlValueAccessor` : `value` est un `model()`, ce qui lui ouvre les deux
 * usages du projet — `[formField]` dans un signal form, et `[value]` /
 * `(valueChange)` sans aucun module de formulaire. L'ancienne version passait par
 * `AbstractControlValueAccessor`, qui imposait `[formControl]` et donc Reactive
 * Forms, écarté par les conventions du dépôt.
 */
@Component({
  selector: 'tas-file-uploader',
  standalone: true,
  templateUrl: './file-uploader.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./file-uploader.scss'],
  imports: [TasIcon],
})
export class TasFileUploader implements FormValueControl<File | null> {
  static nextId = 0;

  public id = `file-uploader-${TasFileUploader.nextId++}`;

  public accept = input<string>('.xlsx');

  /**
   * Poids maximal accepté, en mégaoctets. Laissé à `null`, aucun plafond n'est
   * appliqué — c'est le comportement historique. La règle vit ici plutôt que
   * recopiée dans chaque écran appelant, où elle divergeait déjà.
   */
  public maxSizeMb = input<number | null>(null);

  public value = model<File | null>(null);

  public isDragOver = signal(false);

  /** Motif du refus du dernier fichier proposé, affiché sous la zone. */
  public sizeError = signal('');

  public fileSize = computed(() => {
    const file = this.value();
    if (!file) return '';
    const kb = file.size / 1024;
    return kb < 1024 ? `${kb.toFixed(1)} Ko` : `${(kb / 1024).toFixed(1)} Mo`;
  });

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this._accept(input.files?.[0] ?? null);
    // Sans ça, re-choisir le même fichier après un retrait n'émet aucun
    // `change` et la zone reste vide.
    input.value = '';
  }

  public onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  public onDragLeave(): void {
    this.isDragOver.set(false);
  }

  public onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files[0] ?? null;
    if (file) this._accept(file);
  }

  public clearFile(): void {
    this.sizeError.set('');
    this.value.set(null);
  }

  /**
   * Un fichier trop lourd est refusé **sans** être affecté à `value` : le
   * formulaire appelant ne doit pas croire un instant qu'il le détient, sinon il
   * l'enverrait au serveur qui le rejetterait bien plus tard.
   */
  private _accept(file: File | null): void {
    if (!file) {
      this.clearFile();
      return;
    }

    const maxSizeMb = this.maxSizeMb();
    if (maxSizeMb !== null && file.size > maxSizeMb * 1024 * 1024) {
      this.sizeError.set(`Fichier trop volumineux (max ${maxSizeMb} Mo).`);
      return;
    }

    this.sizeError.set('');
    this.value.set(file);
  }
}
