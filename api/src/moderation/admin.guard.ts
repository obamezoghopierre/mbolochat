import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { users } from '../db/schema.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';

/**
 * Réserve les routes `/admin` aux rôles `moderator` et `admin`.
 *
 * Le rôle est relu en base à chaque requête : un jeton émis avant une
 * révocation ne doit pas continuer à ouvrir la file de modération.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.sub;
    if (!userId) {
      throw new ForbiddenException('Réservé à la modération.');
    }
    const [row] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    if (!row || (row.role !== 'admin' && row.role !== 'moderator')) {
      throw new ForbiddenException('Réservé à la modération.');
    }
    return true;
  }
}
