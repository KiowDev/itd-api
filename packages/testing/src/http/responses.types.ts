/** Один кадр Server-Sent Events. Строка в `data` отправляется без JSON-сериализации. */
export interface SseFrame {
  event?: string;
  data: unknown;
  id?: string;
}
