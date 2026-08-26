import { IsActiveMatchOptions, NavigationExtras } from '@angular/router';

export interface NavigationItem {
  id?: string;
  title?: string;
  subtitle?: string;
  type: 'aside' | 'basic' | 'collapsable' | 'divider' | 'group';
  hidden?: (item: NavigationItem) => boolean;
  active?: boolean;
  disabled?: boolean;
  tooltip?: string;
  link?: string;
  navigationExtras?: NavigationExtras;
  externalLink?: boolean;
  target?: '_blank' | '_self' | '_parent' | '_top' | string;
  exactMatch?: boolean;
  isActiveMatchOptions?: IsActiveMatchOptions;
  function?: (item: NavigationItem) => void;
  classes?: {
    title?: string;
    subtitle?: string;
    icon?: string;
    wrapper?: string;
  };
  icon?: string;
  badge?: {
    classes?: string;
  };
  children?: NavigationItem[];
  meta?: any;
  new?: boolean;
}

export type NavigationMode = 'over' | 'side';

export type NavigationPosition = 'left' | 'right';
