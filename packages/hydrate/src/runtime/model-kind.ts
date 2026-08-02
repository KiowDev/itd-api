import { AttachmentType } from 'itd-api';
import { type AnyRecord, dataField, isRecord } from './records.js';

export const ModelKind = Object.freeze({
  Post: 'post',
  Comment: 'comment',
  Profile: 'profile',
  User: 'user',
  Attachment: 'attachment',
  Notification: 'notification',
} as const);
export type ModelKind = (typeof ModelKind)[keyof typeof ModelKind];

function hasString(value: AnyRecord, key: PropertyKey): boolean {
  return typeof dataField(value, key) === 'string';
}

function hasNumber(value: AnyRecord, key: PropertyKey): boolean {
  return typeof dataField(value, key) === 'number';
}

function hasBoolean(value: AnyRecord, key: PropertyKey): boolean {
  return typeof dataField(value, key) === 'boolean';
}

/** Распознаёт поддерживаемую API-модель только по собственным data properties. */
export function modelKind(value: AnyRecord): ModelKind | undefined {
  if (
    hasString(value, 'id') &&
    hasString(value, 'url') &&
    hasString(value, 'mimeType') &&
    Object.values(AttachmentType).includes(dataField(value, 'type') as AttachmentType)
  ) {
    return ModelKind.Attachment;
  }

  if (
    hasString(value, 'id') &&
    isRecord(dataField(value, 'author')) &&
    Array.isArray(dataField(value, 'spans')) &&
    Array.isArray(dataField(value, 'attachments')) &&
    hasNumber(value, 'commentsCount') &&
    hasNumber(value, 'repostsCount')
  ) {
    return ModelKind.Post;
  }

  if (
    hasString(value, 'id') &&
    isRecord(dataField(value, 'author')) &&
    hasNumber(value, 'likesCount') &&
    hasNumber(value, 'repliesCount') &&
    hasString(value, 'createdAt')
  ) {
    return ModelKind.Comment;
  }

  if (
    hasString(value, 'id') &&
    hasString(value, 'type') &&
    hasString(value, 'rawType') &&
    Array.isArray(dataField(value, 'actors')) &&
    hasBoolean(value, 'isRead')
  ) {
    return ModelKind.Notification;
  }

  if (
    hasString(value, 'id') &&
    hasString(value, 'username') &&
    hasString(value, 'displayName') &&
    hasNumber(value, 'followersCount') &&
    hasNumber(value, 'followingCount') &&
    hasNumber(value, 'postsCount')
  ) {
    return ModelKind.Profile;
  }

  if (hasString(value, 'userId') || hasString(value, 'username')) return ModelKind.User;
  return undefined;
}
