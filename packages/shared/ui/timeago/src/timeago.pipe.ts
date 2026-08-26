import { Pipe, PipeTransform } from '@angular/core';
import { formatRelative } from 'date-fns';
import { fr } from 'date-fns/locale';

@Pipe({
  name: 'dateTimeAgo',
  standalone: true,
})
export class TimeagoPipe implements PipeTransform {
  transform(value: string | Date) {
    return formatRelative(value, new Date(), {
      locale: fr,
    });
  }
}
