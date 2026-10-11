/** Коды ошибок mock-server, которых нет в `ItdErrorCode`. @internal */
export const MockErrorCode = Object.freeze({
  Forbidden: 'FORBIDDEN',
  CannotFollowSelf: 'CANNOT_FOLLOW_SELF',
  InvalidCode: 'INVALID_CODE',
  OrderNotFound: 'ORDER_NOT_FOUND',
  RouteNotImplemented: 'MOCK_ROUTE_NOT_IMPLEMENTED',
} as const);
export type MockErrorCode = (typeof MockErrorCode)[keyof typeof MockErrorCode];
