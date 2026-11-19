import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

/** Bornes nommées, alignées sur les futurs DTO mobiles. */
/** Limite d'une publication texte, alignée sur les limites usuelles (~63 200 caractères). */
export const MAX_CAPTION_LENGTH = 63_200;
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_CLIENT_ID_LENGTH = 128;

const VISIBILITIES = ['public', 'followers', 'private'] as const;
const KINDS = ['post', 'reel'] as const;
/** V1 : la publication texte seule est ouverte, les médias arrivent avec S3. */
const FORMATS = ['text', 'image', 'carousel', 'video'] as const;

/**
 * Création d'une publication. `clientId` est obligatoire : c'est la clé
 * d'idempotence, un rejeu après coupure doit renvoyer la publication existante.
 */
export class CreatePublicationDto {
  /** Facultative dès qu'un média est joint (une vidéo peut n'avoir aucun texte). */
  @IsOptional()
  @IsString({ message: 'La légende doit être un texte.' })
  @MaxLength(MAX_CAPTION_LENGTH, {
    message: `La légende ne peut pas dépasser ${MAX_CAPTION_LENGTH} caractères.`,
  })
  caption?: string;

  /** Médias déjà téléversés et prêts (`media_assets.status = ready`). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  assetIds?: string[];

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];

  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @IsOptional()
  @IsIn(FORMATS)
  format?: (typeof FORMATS)[number];

  @IsString({ message: 'clientId est requis.' })
  @Length(8, MAX_CLIENT_ID_LENGTH, {
    message: `clientId doit contenir entre 8 et ${MAX_CLIENT_ID_LENGTH} caractères.`,
  })
  clientId!: string;
}
