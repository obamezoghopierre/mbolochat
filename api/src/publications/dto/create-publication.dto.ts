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
/** Pages d'un post texte multi-cartes : borne et taille d'une page. */
export const MAX_TEXT_PAGES = 10;
export const MAX_TEXT_PAGE_LENGTH = 2000;
/** Fonds de post texte reconnus (clés de palette du client). */
export const TEXT_BACKGROUNDS = [
  'dark',
  'violet',
  'sunset',
  'ocean',
  'forest',
  'sand',
] as const;

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

  /**
   * Publication citée (« Citer »). La citation copie les médias de
   * l'originale : `assetIds` doit alors être vide, et seules les
   * publications publiques d'un compte public peuvent être citées.
   */
  @IsOptional()
  @IsString()
  quotedPublicationId?: string;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];

  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @IsOptional()
  @IsIn(FORMATS)
  format?: (typeof FORMATS)[number];

  /**
   * Fond du post texte (clé de palette). Réservé aux publications sans
   * média ; toute autre valeur est ignorée côté service.
   */
  @IsOptional()
  @IsIn(TEXT_BACKGROUNDS)
  textBackground?: (typeof TEXT_BACKGROUNDS)[number];

  /**
   * Pages d'un post texte multi-cartes. Dès qu'elles sont fournies, la
   * première devient `caption` côté serveur (recherche, extraits, citation)
   * et `caption` du DTO est ignoré. Une seule page = publication classique.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEXT_PAGES)
  @IsString({ each: true })
  @MaxLength(MAX_TEXT_PAGE_LENGTH, { each: true })
  textPages?: string[];

  @IsString({ message: 'clientId est requis.' })
  @Length(8, MAX_CLIENT_ID_LENGTH, {
    message: `clientId doit contenir entre 8 et ${MAX_CLIENT_ID_LENGTH} caractères.`,
  })
  clientId!: string;
}
