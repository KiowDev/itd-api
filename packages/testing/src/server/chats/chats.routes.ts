import { HttpMethod } from '../../http/http.constants.js';
import { jsonResponse } from '../../http/responses.utils.js';
import { MockDomainError } from '../shared/domain.errors.js';
import { positiveInt } from '../shared/numbers.utils.js';
import { objectBody, stringField } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';

const MESSENGER = '/api/v1/messenger';
const CHATS = `${MESSENGER}/chats`;

function requiredField(body: Record<string, unknown>, key: string): string {
  const value = stringField(body, key);
  if (!value?.trim()) throw MockDomainError.validation(`${key}: ожидается непустая строка`);
  return value;
}

/** Тело текстового сообщения для базового сценария mock-server. */
function messageText(body: Record<string, unknown>): string {
  if (body.attachments || body.entities || body.reply_to_id || body.client_message_id) {
    throw MockDomainError.validation('Mock server поддерживает только простые текстовые сообщения');
  }
  return requiredField(body, 'text');
}

/** Маршруты для сценария от открытия диалога до прочтения сообщения. */
export function registerChatRoutes({ services, requireAuth, route }: MockRouteContext): void {
  const { chats, users } = services;
  const requireTarget = (id: string, senderId: string) => {
    if (id === senderId) throw MockDomainError.validation('Укажите собеседника');
    if (users.find(id)?.profile.id !== id) throw MockDomainError.notFound('Пользователь не найден');
    return id;
  };

  route(
    HttpMethod.Get,
    CHATS,
    requireAuth((request, user) =>
      jsonResponse(
        chats.list(
          user.profile.id,
          request.query.get('before'),
          positiveInt(request.query.get('limit'), 20, 100),
        ),
      ),
    ),
  );
  route(
    HttpMethod.Post,
    `${CHATS}/dm`,
    requireAuth((request, user) => {
      const target = requireTarget(
        requiredField(objectBody(request), 'target_user_id'),
        user.profile.id,
      );
      return jsonResponse(chats.open(user.profile.id, target));
    }),
  );
  route(
    HttpMethod.Get,
    `${CHATS}/:chatId`,
    requireAuth((request, user) =>
      jsonResponse(chats.get(request.params.chatId ?? '', user.profile.id)),
    ),
  );
  route(
    HttpMethod.Get,
    `${CHATS}/:chatId/messages`,
    requireAuth((request, user) =>
      jsonResponse(
        chats.messages(
          request.params.chatId ?? '',
          user.profile.id,
          request.query.get('before'),
          positiveInt(request.query.get('limit'), 50, 100),
        ),
      ),
    ),
  );
  route(
    HttpMethod.Post,
    `${CHATS}/:chatId/messages`,
    requireAuth((request, user) =>
      jsonResponse(
        chats.send(request.params.chatId ?? '', user.profile.id, messageText(objectBody(request))),
        { status: 201 },
      ),
    ),
  );
  route(
    HttpMethod.Post,
    `${MESSENGER}/users/:userId/messages`,
    requireAuth((request, user) => {
      const text = messageText(objectBody(request));
      const target = requireTarget(request.params.userId ?? '', user.profile.id);
      const { chat_id } = chats.open(user.profile.id, target);
      return jsonResponse(
        { ...chats.send(chat_id, user.profile.id, text), chat_id },
        { status: 201 },
      );
    }),
  );
  route(
    HttpMethod.Post,
    `${CHATS}/:chatId/read`,
    requireAuth((request, user) =>
      jsonResponse(
        chats.markRead(
          request.params.chatId ?? '',
          user.profile.id,
          requiredField(objectBody(request), 'last_read_message'),
        ),
      ),
    ),
  );
}
