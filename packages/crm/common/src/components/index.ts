export * from './layouts/portal-layout/portal-layout.component';
// Le contrat de la pastille de téléphonie, et volontairement PAS le service qui la remplit :
// `common` est la lib que toutes les autres importent, donc elle décrit l'emplacement et
// laisse `telephony` l'alimenter. C'est le sens dans lequel la dépendance doit aller — le
// contraire avait produit un cycle qui empêchait un spec de se charger.
export * from './layouts/portal-layout/telephony-top-bar-state';
export * from './layouts/auth-layout/auth-layout.component';
export * from './layouts/admin-layout/admin-layout.component';
export * from './navigation/navigation';
export * from './loading';
export * from './access-denied/access-denied.service';
export * from './access-denied/access-denied.component';
export * from './unknown-tenant/unknown-tenant';
export * from './tenant-suspended/tenant-suspended';
export * from './breadcrumb/breadcrumb.component';
export * from './duplicate-warning-banner/duplicate-warning-banner';
export * from './dynamic-form-renderer/dynamic-form-renderer';
