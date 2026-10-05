import type { MockServerSnapshot } from '../server.types.js';
import type { UserPresenter } from '../users/users.presenter.js';
import type { MockStore } from './mock.store.js';

/** Независимая копия данных хранилища. Связи представлены идентификаторами. @internal */
export function createSnapshot(store: MockStore, users: UserPresenter): MockServerSnapshot {
  return structuredClone({
    users: [...store.users.values()].map((user) => ({
      ...users.myProfile(user),
      following: [...user.following].sort(),
      deactivated: user.deactivated,
    })),
    posts: [...store.posts.values()].map((post) => ({
      ...post,
      likedBy: [...post.likedBy].sort(),
    })),
    comments: [...store.comments.values()].map((comment) => ({
      ...comment,
      likedBy: [...comment.likedBy].sort(),
    })),
    notifications: store.notifications.map((notification) => ({ ...notification })),
    shopProducts: [...store.shopProducts.values()],
    shopOrders: [...store.shopOrders.values()],
  });
}
