import { Component } from '@angular/core';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  name = '';
  password = '';

  constructor(public auth: AuthService) {}

  async submit(): Promise<void> {
    if (!this.name.trim() || !this.password) return;
    if (await this.auth.login(this.name.trim(), this.password)) this.password = '';
  }
}
