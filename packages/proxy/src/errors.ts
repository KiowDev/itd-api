/** Ошибка настройки прокси: неизвестная схема, битый адрес и подобное. */
export class ProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProxyError';
  }
}
