// -----Core-----
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

// -----App-----
import { CanvasComponent } from './canvas/canvas.component';
import { PaletteComponent } from './palette/palette.component';
import { PaletteService } from './services/palette.service';

// -----Extras-----
import { FormsModule } from '@angular/forms';
// import { HttpClientModule } from '@angular/common/http';
import { ColorPickerModule } from 'ngx-color-picker';

@NgModule({
  declarations: [
    AppComponent,
    CanvasComponent,
    PaletteComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    ColorPickerModule
  ],
  providers: [PaletteService],
  bootstrap: [AppComponent]
})
export class AppModule { }
