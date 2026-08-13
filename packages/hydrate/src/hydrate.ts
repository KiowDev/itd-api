import type { ItdClient } from 'itd-api';
import { createClientFacade } from './facades/client.js';
import type { HydrateFlavor } from './types.js';

/**
 * Создаёт фасад клиента, который добавляет действия к моделям из результатов ресурсов и
 * нормализованных обновлений событийного канала.
 *
 * Исходный клиент продолжает управлять запросами, плагинами, авторизацией и жизненным циклом.
 * Повторный вызов для того же клиента возвращает тот же фасад.
 */
export function hydrateClient<Client extends ItdClient>(client: Client): HydrateFlavor<Client> {
  return createClientFacade(client);
}
