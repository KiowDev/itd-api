import type { ItdErrorCode } from 'itd-api';

/** Известные SDK коды ошибок без открытого расширения `Loose`. @internal */
export type KnownItdErrorCode = (typeof ItdErrorCode)[keyof typeof ItdErrorCode];
