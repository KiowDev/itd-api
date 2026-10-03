import type { ItdClock } from 'itd-api';
import { CommentPresenter } from './comments/comments.presenter.js';
import { CommentService } from './comments/comments.service.js';
import { NotificationDelivery } from './notifications/notification.delivery.js';
import { NotificationPresenter } from './notifications/notifications.presenter.js';
import { NotificationService } from './notifications/notifications.service.js';
import { PostPresenter } from './posts/posts.presenter.js';
import { PostService } from './posts/posts.service.js';
import type {
  MockPresenters,
  MockServerSeed,
  MockServerSnapshot,
  MockServices,
} from './server.types.js';
import { ShopService } from './shop/shop.service.js';
import { MockStore } from './store/mock.store.js';
import { buildStoreContents } from './store/seed.builder.js';
import { createSnapshot } from './store/snapshot.builder.js';
import { UserPresenter } from './users/users.presenter.js';
import { UserService } from './users/users.service.js';

/** Хранилище, сервисы и presenters одного mock-server, связанные через конструкторы. @internal */
export class MockServerRuntime {
  readonly store: MockStore;
  readonly services: MockServices;
  readonly presenters: MockPresenters;
  readonly delivery: NotificationDelivery;

  constructor(clock: ItdClock) {
    const store = new MockStore(clock);
    const notifications = new NotificationService(store);
    const users = new UserService(store, notifications);
    const posts = new PostService(store, notifications);
    const comments = new CommentService(store, users, notifications);
    const shop = new ShopService(store);
    const userPresenter = new UserPresenter(users, posts);
    const notificationPresenter = new NotificationPresenter(users, userPresenter);

    this.store = store;
    this.services = { users, posts, comments, notifications, shop };
    this.presenters = {
      users: userPresenter,
      posts: new PostPresenter(users, comments, userPresenter),
      comments: new CommentPresenter(users, comments, userPresenter),
      notifications: notificationPresenter,
    };
    this.delivery = new NotificationDelivery(notifications, notificationPresenter);
  }

  /** Валидирует seed полностью и заменяет данные только после успешной сборки. */
  load(seed: MockServerSeed | undefined): void {
    this.store.load(buildStoreContents(seed, () => this.store.now()));
  }

  snapshot(): MockServerSnapshot {
    return createSnapshot(this.store, this.presenters.users);
  }
}
