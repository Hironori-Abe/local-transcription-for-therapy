import { Directive, ElementRef, Input } from '@angular/core';

/**
 * Keeps Angular's model-to-view synchronization from overwriting a textarea
 * with the value it already received from the user's input event.
 *
 * Assigning HTMLTextAreaElement.value after every keystroke clears the native
 * WebView undo/redo history. External changes (AI suggestions, find/replace,
 * virtual-scroll row reuse, and imported data) still update the element when
 * the model value actually differs from the displayed value.
 */
@Directive({
  selector: 'textarea[lottPreserveUndoValue]',
  standalone: true,
})
export class PreserveUndoValueDirective {
  constructor(
    private readonly elementRef: ElementRef<HTMLTextAreaElement>,
  ) {}

  @Input()
  set lottPreserveUndoValue(value: string | null | undefined) {
    const normalizedValue = value ?? '';
    const textarea = this.elementRef.nativeElement;
    if (textarea.value !== normalizedValue) {
      textarea.value = normalizedValue;
    }
  }
}
