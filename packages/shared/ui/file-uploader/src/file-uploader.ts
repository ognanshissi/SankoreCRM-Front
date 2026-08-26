import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';
import { TasIcon } from '@talisoft/ui/icon';

@Component({
  selector: 'tas-file-uploader',
  standalone: true,
  templateUrl: './file-uploader.html',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TasFileUploader),
      multi: true,
    },
  ],
  styleUrls: ['./file-uploader.scss'],
  imports: [TasIcon],
})
export class TasFileUploader extends AbstractControlValueAccessor<File | null> {
  public accept = input<string>('.xlsx');

  private _fileValue = signal<File | null>(null);

  public override get value(): File | null {
    return this._fileValue();
  }

  public override set value(file: File | null) {
    this._fileValue.set(file);
    this.onTouched();
    this.onChange(file);
  }

  public isDragOver = signal(false);

  public fileSize = computed(() => {
    const file = this._fileValue();
    if (!file) return '';
    const kb = file.size / 1024;
    return kb < 1024 ? `${kb.toFixed(1)} Ko` : `${(kb / 1024).toFixed(1)} Mo`;
  });

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.value = file;
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
    if (file) this.value = file;
  }

  public clearFile(): void {
    this.value = null;
  }
}
