import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { Signal } from '@angular/core';

export interface PlaybackSnackbarData {
  playbackRateOptions: number[];
  playbackRate: Signal<number>;
  onRateChange: (rate: number) => void;
  onStop: () => void;
  isLoop?: boolean;
}

const ICON_BASE_STYLE = `
  font-family: 'Material Symbols Outlined';
  font-style: normal;
  font-weight: 400;
  line-height: 1;
  vertical-align: middle;
  display: inline-block;
  white-space: nowrap;
  direction: ltr;
  letter-spacing: normal;
  text-transform: none;
  font-feature-settings: 'liga';
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20;
`;

@Component({
  selector: 'app-playback-control-snackbar',
  standalone: true,
  imports: [CommonModule, MatButtonModule],
  template: `
    <div class="playback-snackbar-container">
      <span class="snackbar-sym" [class.snackbar-sym-rotate]="!data.isLoop">{{ data.isLoop ? 'repeat' : 'arrow_shape_up_stack_2' }}</span>
      <span class="playback-snackbar-label">{{ data.isLoop ? 'ループ再生中' : '連続再生中' }}</span>
      <select class="playback-snackbar-rate-select"
        (change)="onRateChange($event)">
        <option *ngFor="let rate of data.playbackRateOptions"
          [value]="rate"
          [selected]="rate === data.playbackRate()">
          ×{{ rate.toFixed(1) }}
        </option>
      </select>
      <button mat-flat-button color="warn" class="playback-snackbar-stop-btn" (click)="stop()">
        <span class="snackbar-sym">stop</span>
        停止
      </button>
    </div>
  `,
  styles: [`
    .playback-snackbar-container {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 2px 0;
    }
    .snackbar-sym {
      ${ICON_BASE_STYLE}
      font-size: 20px;
    }
    .snackbar-sym-rotate {
      transform: rotate(180deg);
      color: var(--mat-snack-bar-button-color, #90caf9);
    }
    .playback-snackbar-label {
      font-size: 14px;
      white-space: nowrap;
    }
    .playback-snackbar-rate-select {
      background: rgba(255,255,255,0.12);
      color: inherit;
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 14px;
      cursor: pointer;
      outline: none;
      width: 76px;
    }
    .playback-snackbar-rate-select:focus {
      border-color: rgba(255,255,255,0.6);
    }
    .playback-snackbar-stop-btn {
      min-width: unset;
      padding: 0 12px;
      height: 32px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .playback-snackbar-stop-btn .snackbar-sym {
      font-size: 18px;
    }
  `]
})
export class PlaybackControlSnackbarComponent {
  readonly data = inject<PlaybackSnackbarData>(MAT_SNACK_BAR_DATA);
  private readonly snackBarRef = inject(MatSnackBarRef);

  onRateChange(event: Event): void {
    const rate = parseFloat((event.target as HTMLSelectElement).value);
    this.data.onRateChange(rate);
  }

  stop(): void {
    this.data.onStop();
    this.snackBarRef.dismiss();
  }
}
