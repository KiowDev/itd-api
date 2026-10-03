/** Отношение владельца ресурса к тому, кто к нему обращается. @internal */
export interface AccessRelation {
  /** Обращается сам владелец. */
  isOwner: boolean;
  /** Обращающийся подписан на владельца. */
  follows: boolean;
  /** Владелец подписан на обращающегося. */
  followedBy: boolean;
}
