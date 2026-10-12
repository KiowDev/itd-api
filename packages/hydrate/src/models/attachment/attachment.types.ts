import type { Attachment, AttachmentType } from 'itd-api';
import type { ModelKind } from '../model.constants.js';
import type { HydratedModel } from '../model.types.js';

/** Безопасные проверки типа вложения. */
export interface HydratedAttachmentActions {
  /** Является ли вложение изображением. */
  isImage(): this is this & { type: typeof AttachmentType.Image };
  /** Является ли вложение видео. */
  isVideo(): this is this & { type: typeof AttachmentType.Video };
  /** Является ли вложение аудио. */
  isAudio(): this is this & { type: typeof AttachmentType.Audio };
}

/** Вложение с проверками его типа. */
export type HydratedAttachment<T extends Attachment = Attachment> = HydratedModel<
  typeof ModelKind.Attachment,
  T
>;
