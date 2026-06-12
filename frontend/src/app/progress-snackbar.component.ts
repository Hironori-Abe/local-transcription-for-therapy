import { Component, inject } from '@angular/core';
import { MAT_SNACK_BAR_DATA } from '@angular/material/snack-bar';
import { Signal } from '@angular/core';

export interface ProgressSnackbarData {
  statusText: Signal<string>;
}

@Component({
  selector: 'app-progress-snackbar',
  standalone: true,
  template: `
    <div class="progress-snackbar-container">
      <span class="progress-snackbar-text">{{ data.statusText() }}</span>
    </div>
  `,
  styles: [`
    .progress-snackbar-container {
      display: flex;
      align-items: center;
      padding: 2px 0;
    }
    .progress-snackbar-text {
      font-size: 13px;
      white-space: nowrap;
      font-feature-settings: 'tnum';
      font-variant-numeric: tabular-nums;
    }
  `]
})
export class ProgressSnackbarComponent {
  readonly data = inject<ProgressSnackbarData>(MAT_SNACK_BAR_DATA);
}
