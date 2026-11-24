import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, ne, notExists, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { blocks, follows, users } from '../db/schema.js';
import {
  toPublicUserView,
  UsersService,
  type PublicUserView,
} from './users.service.js';

const incomingFollows = alias(follows, 'friend_search_incoming');
const searchedBlocks = alias(blocks, 'friend_search_blocks');
const MAX_FRIEND_SEARCH_LIMIT = 50;

/** Recherche des abonnements mutuels acceptés, sans exposer de données privées. */
@Injectable()
export class FriendsSearchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly usersService: UsersService,
  ) {}

  async search(viewerId: string, query: string, limit = 20): Promise<PublicUserView[]> {
    const normalizedQuery = query.trim().slice(0, 100);
    if (!normalizedQuery) return [];

    const blockedInEitherDirection = notExists(
      this.db
        .select({ blockerId: searchedBlocks.blockerId })
        .from(searchedBlocks)
        .where(
          or(
            and(
              eq(searchedBlocks.blockerId, viewerId),
              eq(searchedBlocks.blockedId, users.id),
            ),
            and(
              eq(searchedBlocks.blockerId, users.id),
              eq(searchedBlocks.blockedId, viewerId),
            ),
          ),
        ),
    );
    const boundedLimit = Math.min(Math.max(1, limit), MAX_FRIEND_SEARCH_LIMIT);
    const rows = await this.db
      .select({ user: users })
      .from(users)
      .innerJoin(
        follows,
        and(
          eq(follows.followerId, viewerId),
          eq(follows.followingId, users.id),
          eq(follows.status, 'accepted'),
        ),
      )
      .innerJoin(
        incomingFollows,
        and(
          eq(incomingFollows.followerId, users.id),
          eq(incomingFollows.followingId, viewerId),
          eq(incomingFollows.status, 'accepted'),
        ),
      )
      .where(
        and(
          ne(users.id, viewerId),
          or(
            ilike(users.username, `%${normalizedQuery}%`),
            ilike(users.displayName, `%${normalizedQuery}%`),
          ),
          blockedInEitherDirection,
        ),
      )
      .orderBy(asc(users.displayName), asc(users.username))
      .limit(boundedLimit);

    const relations = await this.usersService.relationsFor(
      viewerId,
      rows.map(({ user }) => user.id),
    );
    return rows.map(({ user }) =>
      toPublicUserView(
        user,
        relations.get(user.id) ?? { isContact: false, blocked: false },
      ),
    );
  }
}
