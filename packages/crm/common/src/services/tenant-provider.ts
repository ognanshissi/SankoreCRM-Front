import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class TenantProvider {

  public getTenantId(): string {
    // show get the id by using the hostname
    // This api is call inside
    return `2fae736d-9c5c-456e-8d3c-5e4e9b0674ce`;
  }

}
