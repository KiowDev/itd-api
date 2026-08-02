import type { Loose } from '../types/enums.js';
import type { IsoDate } from './common.js';

/** Клан в рейтинге. */
export interface Clan {
  /** Эмодзи клана — оно же аватар его участников. */
  avatar: string;
  memberCount: number;
}

/** Запись журнала изменений платформы. */
export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

/** Кнопка в анонсе платформы. */
export interface AnnouncementButton {
  title: string;
  /** Оформление: `primary`, `secondary` и другие. */
  style: string;
  action: { type: string; [key: string]: unknown };
}

/** Анонс на главной странице платформы. */
export interface Announcement {
  id: string;
  image: { url: string; width: number; height: number };
  title: string;
  description: string;
  /** Дополнительный текст мелким шрифтом. */
  additional_text?: string;
  buttons: AnnouncementButton[];
}

/** Баннер текущего события — виджет «портал». */
export interface Portal {
  active: boolean;
  title: string;
  url: string;
}

/** Статус заявки на верификацию. `none` означает, что заявка не подавалась. */
export interface VerificationStatus {
  status: Loose<'none' | 'pending' | 'approved' | 'rejected'>;
}

/** Созданная жалоба. */
export interface Report {
  id: string;
  createdAt: IsoDate;
}
