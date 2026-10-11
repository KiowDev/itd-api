import type { Attachment } from 'itd-api';
import type { HydratedModel } from '../model.types.js';

/** Безопасные проверки типа вложения. */
export interface HydratedAttachmentActions {
  /** Является ли вложение изображением. */
  isImage(): this is this & { type: typeof import('itd-api').AttachmentType.Image };
  /** Является ли вложение видео. */
  isVideo(): this is this & { type: typeof import('itd-api').AttachmentType.Video };
  /** Является ли вложение аудио. */
  isAudio(): this is this & { type: typeof import('itd-api').AttachmentType.Audio };
}

/** Вложение с проверками его типа. */
export type HydratedAttachment<T extends Attachment = Attachment> = HydratedModel<
  T,
  HydratedAttachmentActions
>;
