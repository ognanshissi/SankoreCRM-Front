import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Tenant } from './tenant';

describe('Tenant', () => {
  let component: Tenant;
  let fixture: ComponentFixture<Tenant>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Tenant],
    }).compileComponents();

    fixture = TestBed.createComponent(Tenant);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
