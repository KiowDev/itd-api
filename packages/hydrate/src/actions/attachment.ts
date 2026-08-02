import { AttachmentType } from 'itd-api';
import type { AnyRecord } from '../runtime/records.js';

function attachmentIsImage(this: AnyRecord): boolean {
  return Reflect.get(this, 'type', this) === AttachmentType.Image;
}

function attachmentIsVideo(this: AnyRecord): boolean {
  return Reflect.get(this, 'type', this) === AttachmentType.Video;
}

function attachmentIsAudio(this: AnyRecord): boolean {
  return Reflect.get(this, 'type', this) === AttachmentType.Audio;
}

export const ATTACHMENT_ACTIONS = Object.freeze({
  isImage: attachmentIsImage,
  isVideo: attachmentIsVideo,
  isAudio: attachmentIsAudio,
});
