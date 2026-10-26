import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from './services/auth.service';
import { BoardService } from './services/board.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'whiteboard';
  private sub?: Subscription;

  constructor(public auth: AuthService, private board: BoardService) {}

  ngOnInit(): void {
    // Connect when we have a session, disconnect when we don't.
    if (this.auth.token) this.board.connect();
    this.sub = this.auth.tokenChanged.subscribe((token) => {
      if (token) this.board.connect();
      else this.board.disconnect();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.board.disconnect();
  }
}
