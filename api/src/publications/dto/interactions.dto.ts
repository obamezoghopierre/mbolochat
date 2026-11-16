import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import { MAX_CLIENT_ID_LENGTH, MAX_COMMENT_LENGTH } from './create-publication.dto.js';

export const REACTION_KINDS = ['like', 'love', 'fire', 'clap'] as const;

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
