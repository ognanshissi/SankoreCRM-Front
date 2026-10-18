export * from './auth.service';
import { AuthApiService } from './auth.service';
export * from './health.service';
import { HealthApiService } from './health.service';
export * from './tenant-domains.service';
import { TenantDomainsApiService } from './tenant-domains.service';
export * from './tenants.service';
import { TenantsApiService } from './tenants.service';
export const APIS = [AuthApiService, HealthApiService, TenantDomainsApiService, TenantsApiService];
