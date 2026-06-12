import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-password-dialog',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>パスワード設定（任意）</h2>
    <mat-dialog-content>
      <p style="margin-top:0;margin-bottom:16px">
        パスワードを設定すると、ファイルを開くのにパスワードが必要となります。<br>
        空欄のまま「保存」を押すとパスワードなしで保存されます。
      </p>
      <mat-form-field appearance="outline" style="width:100%">
        <mat-label>パスワード</mat-label>
        <input matInput [type]="showPassword() ? 'text' : 'password'"
               [(ngModel)]="password" autocomplete="off" placeholder="（省略可）">
        <button mat-icon-button matSuffix (click)="showPassword.set(!showPassword())" type="button"
                [attr.aria-label]="showPassword() ? 'パスワードを隠す' : 'パスワードを表示'">
          <mat-icon class="material-symbols-outlined">{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">キャンセル</button>
      <button mat-flat-button color="primary" (click)="confirm()">保存</button>
    </mat-dialog-actions>
  `
})
export class PasswordDialogComponent {
  password = '';
  showPassword = signal(false);

  constructor(private readonly dialogRef: MatDialogRef<PasswordDialogComponent>) {}

  cancel(): void {
    this.dialogRef.close(null);
  }

  confirm(): void {
    this.dialogRef.close(this.password);
  }
}
