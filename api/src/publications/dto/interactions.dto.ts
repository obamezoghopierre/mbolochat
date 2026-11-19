import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

import { MAX_CLIENT_ID_LENGTH, MAX_COMMENT_LENGTH } from './create-publication.dto.js';

export const REACTION_KINDS = ['like', 'love', 'fire', 'clap'] as const;

/** Réactions emoji sur un commentaire, façon Instagram. */
export const COMMENT_REACTION_KINDS = ['heart', 'laugh', 'wow', 'fire', 'clap'] as const;
export type CommentReactionKind = (typeof COMMENT_REACTION_KINDS)[number];

/** Réaction emoji à un commentaire : le type est modifiable, une seule par compte. */
export class CommentReactDto {
  @IsIn(COMMENT_REACTION_KINDS)
  kind!: CommentReactionKind;
}

/** Commentaire ou réponse. `parentId` désigne le commentaire auquel on répond. */
export class CreateCommentDto {
  @IsString({ message: 'Le commentaire doit être un texte.' })
  @MaxLength(MAX_COMMENT_LENGTH, {
    message: `Le commentaire ne peut pas dépasser ${MAX_COMMENT_LENGTH} caractères.`,
  })
  body!: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsString({ message: 'clientId est requis.' })
  @Length(8, MAX_CLIENT_ID_LENGTH, {
    message: `clientId doit contenir entre 8 et ${MAX_CLIENT_ID_LENGTH} caractères.`,
  })
  clientId!: string;
}

/** Réaction : le type est modifiable, une seule réaction par compte et publication. */
export class ReactDto {
  @IsOptional()
  @IsIn(REACTION_KINDS)
  kind?: (typeof REACTION_KINDS)[number];
}

/**
 * Borne dure du temps de visionnage envoyé par le client : 6 h. Le serveur ne
 * fait confiance qu'à une valeur croissante et bornée, jamais à un cumul
 * arbitraire qui gonflerait le classement.
 */
export const MAX_WATCH_MS = 6 * 60 * 60 * 1000;

/**
 * Vue d'une publication, telle que le client la mesure.
 *
 * `watchedMs` est le temps **visible cumulé** (lecture réelle), pas le temps
 * depuis l'ouverture de la page : c'est le signal de classement du fil.
 */
export class RecordViewDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_WATCH_MS)
  watchedMs?: number;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;
}
