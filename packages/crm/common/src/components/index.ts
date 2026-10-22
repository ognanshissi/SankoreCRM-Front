export * from './layouts/portal-layout/portal-layout.component';
// Le contrat de la pastille de téléphonie, et volontairement PAS le service qui la remplit :
// `common` est la lib que toutes les autres importent, donc elle décrit l'emplacement et
// laisse `telephony` l'alimenter. C'est le sens dans lequel la dépendance doit aller — le
// contraire avait produit un cycle qui empêchait un spec de se charger.
export * from './layouts/portal-layout/telephony-top-bar-state';
// Même logique : `common` affiche le menu « Créer », l'application y déclare les tiroirs.
export * from './layouts/portal-layout/quick-create';
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
// Formulaires dynamiques des entités (lead, client, produit) — lot 3. Le précédent, au-dessus, rend
// les questionnaires de qualification et reste en place pour eux.
export * from './entity-form-renderer/entity-form-renderer';
export * from './entity-form-renderer/entity-form-field-template.directive';
export * from './entity-form-renderer/entity-form-references.service';
export * from './entity-form-renderer/entity-form-values';
export * from './entity-form-renderer/custom-fields-card';
export * from './entity-form-renderer/entity-form-errors';
export * from './entity-form-renderer/custom-field-filters';
export * from './entity-form-renderer/custom-field-columns';
// Cloche des notifications in-app (WA-FE-10). Le service est exporté pour que « Paramétrage
// agent » puisse lui transmettre la préférence de son après un enregistrement.
export * from './notification-bell/notification-bell';
export * from './notification-bell/notification-center.service';
export * from './notification-bell/notification-sound';
