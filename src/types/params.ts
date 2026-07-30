// Импорт только типовой, поэтому взаимная ссылка между params.ts и builders/poll.ts
// стирается при компиляции и не образует цикла в собранном коде.
import type { PollInput } from '../builders/poll.js';
import type { FileInput } from '../core/attachments.js';
import type { ReportReason, ReportTargetType } from './enums.js';
import type { Span, UserId } from './models.js';

/** Данные для создания опроса. */
export interface CreatePollInput {
  /** Вопрос. Не может быть пустым. */
  question: string;
  /** Варианты ответа. Требуется минимум два. */
  options: { text: string }[];
  /** Разрешить выбор нескольких вариантов. По умолчанию `false`. */
  multipleChoice?: boolean;
}

/** Данные для создания поста. */
export interface CreatePostInput {
  /** Текст поста. */
  content?: string;
  /**
   * Разметка текста. Сырые spans проверяются относительно `content`;
   * для автоматического построения доступны `post().markup()` и `post().autoSpans()`.
   */
  spans?: Span[];
  /**
   * Чья стена, если пост публикуется не у себя.
   *
   * Требуется **UUID**: имя пользователя здесь не работает, его можно получить
   * из профиля через `itd.users.get(username)`.
   */
  wallRecipientId?: UserId | null;
  /** Идентификаторы заранее загруженных вложений. */
  attachmentIds?: string[];
  /** Файлы, которые нужно загрузить перед публикацией. Порядок сохраняется. */
  files?: FileInput[];
  /** Опрос: обычный объект, {@link PollBuilder} или функция-настройщик. */
  poll?: PollInput;
}

/** Поля поста, которые принимает `itd.posts.update()`. */
export interface UpdatePostInput {
  /** Новый текст поста. Обязателен, чтобы обновление одних spans не стёрло текущий текст. */
  content: string;
  /** Разметка нового текста. */
  spans?: Span[];
}

/** Данные для создания комментария или ответа. */
export interface CreateCommentInput {
  /** Текст. У голосового комментария должен быть пустым. */
  content?: string;
  /** Идентификаторы заранее загруженных вложений. */
  attachmentIds?: string[];
  /** Файлы, которые нужно загрузить перед отправкой. */
  files?: FileInput[];
  /**
   * Кому адресован ответ.
   *
   * Применимо только в `itd.comments.reply()`; в комментарии к посту поле не имеет смысла.
   */
  replyToUserId?: UserId;
}

/** Данные для создания жалобы. */
export interface CreateReportInput {
  /** На что жалоба. */
  targetType: ReportTargetType;
  /** Идентификатор объекта жалобы. */
  targetId: string;
  /** Причина. */
  reason: ReportReason;
  /** Пояснение в свободной форме. */
  description?: string;
}
