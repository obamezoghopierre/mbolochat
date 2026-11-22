import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';

import { DRIZZLE, type Database } from '../db/db.module.js';
import { publicationSaves, saveCollections } from '../db/schema.js';

/** Longueur maximale d'un nom de collection. */
export const MAX_COLLECTION_NAME = 40;
/** Plafond de collections par compte (anti-abus). */
export const MAX_COLLECTIONS = 100;

export interface SaveCollectionView {
  id: string;
  name: string;
  /** Nombre de publications enregistrées dans la collection. */
  count: number;
  createdAt: Date;
}

/**
 * Collections d'enregistrements, comme Instagram : privées, nommées par leur
 * propriétaire. Un enregistrement appartient à au plus une collection ; le
 * supprimer de la collection ne retire pas l'enregistrement.
 */
@Injectable()
export class SaveCollectionsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(userId: string): Promise<SaveCollectionView[]> {
    const rows = await this.db
      .select({
        id: saveCollections.id,
        name: saveCollections.name,
        createdAt: saveCollections.createdAt,
        count: sql<number>`(
          select count(*)::int from ${publicationSaves}
          where ${publicationSaves.collectionId} = ${saveCollections.id}
        )`,
      })
      .from(saveCollections)
      .where(eq(saveCollections.userId, userId))
      .orderBy(desc(saveCollections.updatedAt), asc(saveCollections.name));
    return rows;
  }

  async create(userId: string, rawName: string): Promise<SaveCollectionView> {
    const name = this.cleanName(rawName);
    const [{ value: total }] = await this.db
      .select({ value: count() })
      .from(saveCollections)
      .where(eq(saveCollections.userId, userId));
    if (total >= MAX_COLLECTIONS) {
      throw new BadRequestException('Nombre maximal de collections atteint.');
    }
    const [row] = await this.db
      .insert(saveCollections)
      .values({ userId, name })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw new ConflictException('Une collection porte déjà ce nom.');
    }
    return { id: row.id, name: row.name, createdAt: row.createdAt, count: 0 };
  }

  async rename(userId: string, collectionId: string, rawName: string): Promise<SaveCollectionView> {
    const name = this.cleanName(rawName);
    await this.assertOwned(userId, collectionId);
    try {
      await this.db
        .update(saveCollections)
        .set({ name, updatedAt: new Date() })
        .where(eq(saveCollections.id, collectionId));
    } catch {
      throw new ConflictException('Une collection porte déjà ce nom.');
    }
    const found = (await this.list(userId)).find((entry) => entry.id === collectionId);
    if (!found) {
      throw new NotFoundException('Collection introuvable.');
    }
    return found;
  }

  /** Supprime la collection ; ses publications restent enregistrées. */
  async remove(userId: string, collectionId: string): Promise<{ deleted: true }> {
    await this.assertOwned(userId, collectionId);
    await this.db.delete(saveCollections).where(eq(saveCollections.id, collectionId));
    return { deleted: true };
  }

  /**
   * Range une publication déjà enregistrée dans une collection (`null` = la
   * sortir de toute collection). Refusé si la publication n'est pas
   * enregistrée : on l'enregistre d'abord.
   */
  async assign(
    userId: string,
    publicationId: string,
    collectionId: string | null,
  ): Promise<{ publicationId: string; collectionId: string | null }> {
    if (collectionId) {
      await this.assertOwned(userId, collectionId);
    }
    const updated = await this.db
      .update(publicationSaves)
      .set({ collectionId })
      .where(
        and(eq(publicationSaves.publicationId, publicationId), eq(publicationSaves.userId, userId)),
      )
      .returning({ publicationId: publicationSaves.publicationId });
    if (updated.length === 0) {
      throw new NotFoundException('Publication non enregistrée.');
    }
    if (collectionId) {
      // La collection utilisée remonte en tête de liste.
      await this.db
        .update(saveCollections)
        .set({ updatedAt: new Date() })
        .where(eq(saveCollections.id, collectionId));
    }
    return { publicationId, collectionId };
  }

  private cleanName(raw: string): string {
    const name = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (name.length === 0) {
      throw new BadRequestException('Donne un nom à la collection.');
    }
    if (name.length > MAX_COLLECTION_NAME) {
      throw new BadRequestException(
        `Le nom ne peut pas dépasser ${MAX_COLLECTION_NAME} caractères.`,
      );
    }
    return name;
  }

  private async assertOwned(userId: string, collectionId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: saveCollections.id })
      .from(saveCollections)
      .where(and(eq(saveCollections.id, collectionId), eq(saveCollections.userId, userId)));
    if (!row) {
      throw new NotFoundException('Collection introuvable.');
    }
  }
}
