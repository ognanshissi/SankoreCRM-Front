import { ChangeDetectionStrategy, Component, HostBinding } from '@angular/core';

@Component({
  selector: 'tas-title, Title, [Title], TasTitle',
  template: `
    <div class="text-4xl font-bold text-primary bg-transparent">
      <ng-content></ng-content>
    </div>
  `,
  standalone: true,
  exportAs: 'TasTitle',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasTitle {
  static nextId = 0;
  @HostBinding() id = `tas-title-id-${TasTitle.nextId++}`;
  @HostBinding('attr.role') role = 'title';
}
