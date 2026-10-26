import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ColorPickerModule } from 'ngx-color-picker';

import { PaletteComponent } from './palette.component';

describe('PaletteComponent', () => {
  let component: PaletteComponent;
  let fixture: ComponentFixture<PaletteComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ PaletteComponent ],
      imports: [ FormsModule, ColorPickerModule ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PaletteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('number keys pick tools', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    expect(component.sel.tool.name).toBe('Marker');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(component.sel.tool.name).toBe('Pen');
  });
});
