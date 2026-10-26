// -----Core-----
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

// -----App-----
import { CanvasComponent } from './canvas/canvas.component';
import { PaletteComponent } from './palette/palette.component';
import { PaletteService } from './services/palette.service';
import { LoginComponent } from './login/login.component';
import { BoardMenuComponent } from './board-menu/board-menu.component';

// -----Extras-----
import { FormsModule } from '@angular/forms';
import { ColorPickerModule } from 'ngx-color-picker';

@NgModule({
  declarations: [
    AppComponent,
    CanvasComponent,
    PaletteComponent,
    LoginComponent,
    BoardMenuComponent
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
