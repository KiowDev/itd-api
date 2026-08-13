import type { AttachmentType } from '../types/enums.js';
import type { IsoDate, Span, UserId } from './common.js';
import type { Author } from './users.js';

/** Вложение поста или комментария. */
export interface Attachment {
  id: string;
  type: AttachmentType;
  /** Адрес файла на CDN. */
  url: string;
  /** Ширина изображения или видео в пикселях. */
  width?: number;
  /** Высота изображения или видео в пикселях. */
  height?: number;
  /** MIME-тип. Может отсутствовать в `GET /api/posts/{id}`. */
  mimeType?: string;
  /** Исходное имя файла. Приходит не всегда. */
  filename?: string;
  /** Размер в байтах. Приходит не всегда. */
  size?: number;
  /** Длительность аудио или видео в секундах. */
  duration?: number | null;
  /** Порядковый номер во вложениях поста. */
  order?: number;
}

/** Вариант ответа в опросе. */
export interface PollOption {
  id: string;
  text: string;
  /** Сколько голосов отдано за этот вариант. */
  votesCount: number;
  /** Порядковый номер варианта, начиная с нуля. */
  position: number;
}

/** Опрос внутри поста. */
export interface Poll {
  id: string;
  /** Пост, которому принадлежит опрос. */
  postId: string;
  question: string;
  /** Можно ли выбрать несколько вариантов. */
  multipleChoice: boolean;
  options: PollOption[];
  totalVotes: number;
  /** Голосовали ли вы. */
  hasVoted: boolean;
  /** За что проголосовали вы. Пустой массив, если голоса не было. */
  votedOptionIds: string[];
  createdAt: IsoDate;
}

/** Пост ленты, стены или профиля. */
export interface Post {
  id: string;
  content: string;
  /** Разметка текста. Передаётся без изменений, см. {@link Span}. */
  spans: Span[];
  author: Author;
  attachments: Attachment[];
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  viewsCount: number;
  /** Чья это стена, если пост опубликован не у себя. */
  wallRecipientId: UserId | null;
  /** Владелец стены. Приходит не во всех ответах. */
  wallRecipient?: Author | null;
  /** Поставили ли вы реакцию. */
  isLiked: boolean;
  /** Делали ли вы репост. */
  isReposted: boolean;
  /** Засчитан ли просмотр. */
  isViewed?: boolean;
  /** Ваш ли это пост. */
  isOwner: boolean;
  /** Исходный пост, если это репост. */
  originalPost?: Post | null;
  poll?: Poll | null;
  /** Преобладающая реакция — эмодзи либо `null`. */
  dominantEmoji?: string | null;
  /** Когда пост отредактировали. `null`, если не редактировали. */
  editedAt?: IsoDate | null;
  createdAt: IsoDate;
  /**
   * Служебная метка показа для телеметрии.
   *
   * Нужна только эндпоинтам `itd.telemetry.*`. В остальных случаях игнорируйте.
   */
  vs?: string;
  /**
   * Топовые комментарии. Приходят только в ответе `GET /api/posts/{id}`.
   *
   * В списках постов поле отсутствует.
   */
  comments?: Comment[];
}

/** На чей комментарий дан ответ. */
export interface CommentReplyTo {
  id: string;
  username: string;
  displayName: string;
}

/** Комментарий к посту или ответ на комментарий. */
export interface Comment {
  id: string;
  /** Текст. У голосового комментария пустой. */
  content: string;
  /**
   * Разметка текста, включая автоматически найденные сервером хэштеги и упоминания.
   *
   * Методы создания и редактирования комментария принимают только `content`, поэтому
   * библиотека не отправляет ручные spans в этих операциях.
   * Поле необязательно: отдельные ответы сервера могут его не содержать.
   */
  spans?: Span[];
  author: Author;
  likesCount: number;
  /** Может отсутствовать у ответа, созданного через `comments.reply()`. */
  repliesCount?: number;
  isLiked: boolean;
  createdAt: IsoDate;
  /** Вложения. У голосового — одно аудио с `mimeType: 'audio/ogg'`. */
  attachments?: Attachment[];
  /** Вложенные ответы. В списках приходит превью, полный список — через `itd.comments.replies()`. */
  replies?: Comment[];
  /** Заполнено только у ответов. */
  replyTo?: CommentReplyTo | null;
}

/** Компактный ответ редактирования поста. */
export interface PostUpdateResult {
  id: string;
  content: string;
  spans: Span[];
  updatedAt: IsoDate;
}

/** Компактный ответ редактирования комментария. */
export interface CommentUpdateResult {
  id: string;
  content: string;
  editedAt: IsoDate;
}

/** Хэштег. */
export interface Hashtag {
  id: string;
  /** Название без решётки. */
  name: string;
  /** Сколько постов с этим хэштегом. */
  postsCount: number;
}

/** Счётчики поста из `itd.posts.stats()`. */
export interface PostStats {
  id: string;
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  viewsCount: number;
  /** Преобладающая реакция — эмодзи либо `null`. */
  dominantEmoji: string | null;
}

/** Результат реакции на пост. */
export interface LikeResult {
  liked: boolean;
  likesCount: number;
}

/** Результат закрепления поста в профиле. */
export interface PinPostResult {
  success: boolean;
  pinnedPostId: string | null;
}
