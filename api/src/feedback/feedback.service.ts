import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { contentFeedback, publications, users } from '../db/schema.js';

export const FEEDBACK_TARGETS = ['publication', 'author'] as const;
export type FeedbackTarget = (typeof FEEDBACK_TARGETS)[number];
export const FEEDBACK_KINDS = ['not_interested'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/**
 * Retours négatifs du fil : « Pas intéressé » sur une publication, masquage
 * d'un auteur.
 *
 * Ces signaux sont lus **en SQL** par le fil (`FeedService.baseConditions`) : un
 * contenu écarté ne revient ni à la page suivante, ni dans un autre onglet, ni
 * dans une session déjà ouverte.
 */
@Injectable()
export class FeedbackService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(
    userId: string,
    input: { targetType: FeedbackTarget; targetId: string; kind?: FeedbackKind },
  ): Promise<{ targetType: FeedbackTarget; targetId: string; kind: FeedbackKind }> {
    const kind = input.kind ?? 'not_interested';
    await this.assertTarget(userId, input.targetType, input.targetId);
    await this.db
      .insert(contentFeedback)
      .values({ userId, targetType: input.targetType, targetId: input.targetId, kind })
      .onConflictDoNothing();
    return { targetType: input.targetType, targetId: input.targetId, kind };
  }

  /** Retire un retour : le contenu peut réapparaître dans les prochains fils. */
  async remove(
    userId: string,
    targetType: FeedbackTarget,
    targetId: string,
  ): Promise<{ removed: boolean }> {
    const deleted = await this.db
      .delete(contentFeedback)
      .where(
        and(
          eq(contentFeedback.userId, userId),
          eq(contentFeedback.targetType, targetType),
          eq(contentFeedback.targetId, targetId),
        ),
      )
      .returning({ targetId: contentFeedback.targetId });
    return { removed: deleted.length > 0 };
  }

  /** Ce que le visiteur a écarté, pour un futur écran de réglages. */
  async list(userId: string) {
    return this.db
      .select({
        targetType: contentFeedback.targetType,
        targetId: contentFeedback.targetId,
        kind: contentFeedback.kind,
        createdAt: contentFeedback.createdAt,
      })
      .from(contentFeedback)
      .where(eq(contentFeedback.userId, userId));
  }

  private async assertTarget(
    userId: string,
    targetType: FeedbackTarget,
    targetId: string,
  ): Promise<void> {
    if (targetType === 'author') {
      if (targetId === userId) {
        throw new BadRequestException('Impossible de masquer son propre compte.');
      }
      const [author] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, targetId));
      if (!author) {
        throw new NotFoundException('Compte introuvable.');
      }
      return;
    }
    // Une publication déjà supprimée n'a pas à être écartée : 404, sans rien
    // divulguer d'autre que son absence.
    const [publication] = await this.db
      .select({ id: publications.id })
      .from(publications)
      .where(and(eq(publications.id, targetId), isNull(publications.deletedAt)));
    if (!publication) {
      throw new NotFoundException('Publication introuvable.');
    }
  }
}
