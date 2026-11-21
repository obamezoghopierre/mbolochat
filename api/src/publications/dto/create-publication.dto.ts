import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Bornes nommées, alignées sur les futurs DTO mobiles. */
/** Limite d'une publication texte, alignée sur les limites usuelles (~63 200 caractères). */
export const MAX_CAPTION_LENGTH = 63_200;
export const MAX_COMMENT_LENGTH = 1000;
export const MAX_CLIENT_ID_LENGTH = 128;
/** Pages d'un post texte multi-cartes : borne et taille d'une page. */
export const MAX_TEXT_PAGES = 10;
export const MAX_TEXT_PAGE_LENGTH = 2000;
/** Titre facultatif d'un post texte : borne de saisie (affichage tronqué à 160). */
export const MAX_TEXT_TITLE_LENGTH = 200;
/** Taille de police manuelle d'un post texte, en points. */
export const MIN_TEXT_SIZE = 16;
export const MAX_TEXT_SIZE = 64;
/** Lieu d'un post texte : nom de ville/lieu saisi ou géocodé. */
export const MAX_LOCATION_LENGTH = 100;
/** Fonds de post texte reconnus (clés de palette du client). */
export const TEXT_BACKGROUNDS = [
  'dark',
  'violet',
  'sunset',
  'ocean',
  'forest',
  'sand',
  'rose',
  'mint',
  'sky',
  'lime',
  'peach',
  'orchid',
  'coral',
  'aqua',
  'butter',
  'lilac',
  'wine',
  'slate',
  'sage',
  'cocoa',
  'yellow',
  'gold',
  'orange',
  'red',
  'magenta',
  'teal',
] as const;
/** Polices de post texte reconnues (clés du catalogue client). */
export const TEXT_FONTS = [
  'classic',
  'modern',
  'typewriter',
  'bold',
  'elegant',
  'light',
  'black',
  'script',
  'caps',
  'wide',
] as const;
/** Alignements de post texte reconnus. */
export const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
/** Couleurs de texte de post texte reconnues (clés du catalogue client). */
export const TEXT_COLORS = [
  'white',
  'cream',
  'yellow',
  'coral',
  'pink',
  'blue',
  'mint',
  'violet',
  'orange',
  'red',
  'green',
  'teal',
  'magenta',
  'gold',
  'gray',
  'black',
] as const;
/** Filtres de publications média reconnus (clés du catalogue client). */
export const MEDIA_FILTERS = [
  'vivid',
  'warm',
  'cool',
  'noir',
  'retro',
  'fade',
  'chrome',
] as const;

const VISIBILITIES = ['public', 'followers', 'private'] as const;
const KINDS = ['post', 'reel'] as const;
/** V1 : la publication texte seule est ouverte, les médias arrivent avec S3. */
const FORMATS = ['text', 'image', 'carousel', 'video'] as const;

/**
 * Style propre à une page de post texte multi-cartes : fond et couleur de
 * texte indépendants, comme les carrousels Instagram. Aligné sur
 * `textPages` par index ; une page sans style garde le rendu par défaut.
 */
export class TextPageStyleDto {
  @IsOptional()
  @IsIn(TEXT_BACKGROUNDS)
  background?: (typeof TEXT_BACKGROUNDS)[number];

  @IsOptional()
  @IsIn(TEXT_COLORS)
  color?: (typeof TEXT_COLORS)[number];

  /** Police propre à la page (clé du catalogue client). */
  @IsOptional()
  @IsIn(TEXT_FONTS)
  font?: (typeof TEXT_FONTS)[number];

  /** Alignement propre à la page. */
  @IsOptional()
  @IsIn(TEXT_ALIGNS)
  align?: (typeof TEXT_ALIGNS)[number];

  /** Taille manuelle de la page en points ; absente = auto-ajustement. */
  @IsOptional()
  @IsInt()
  @Min(MIN_TEXT_SIZE)
  @Max(MAX_TEXT_SIZE)
  size?: number;
}

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

  /**
   * Style par page, aligné sur `textPages` (index identique). Réservé aux
   * publications multi-pages ; les entrées invalides sont ignorées côté
   * service, une page absente du tableau garde le style par défaut.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEXT_PAGES)
  @ValidateNested({ each: true })
  @Type(() => TextPageStyleDto)
  textPageStyles?: TextPageStyleDto[];

  /**
   * Police du post texte (clé du catalogue client). Réservée aux
   * publications sans média ; toute autre valeur est ignorée côté service.
   */
  @IsOptional()
  @IsIn(TEXT_FONTS)
  textFont?: (typeof TEXT_FONTS)[number];

  /**
   * Alignement du texte d'un post texte. Réservé aux publications sans
   * média ; toute autre valeur est ignorée côté service.
   */
  @IsOptional()
  @IsIn(TEXT_ALIGNS)
  textAlign?: (typeof TEXT_ALIGNS)[number];

  /**
   * Couleur du texte d'un post texte (clé du catalogue client). Réservée
   * aux publications sans média ; absente = couleur du thème.
   */
  @IsOptional()
  @IsIn(TEXT_COLORS)
  textColor?: (typeof TEXT_COLORS)[number];

  /**
   * Titre facultatif d'un post texte, saisi dans un champ dédié. Réservé
   * aux publications sans média ; absent = le client déduit le titre de la
   * première ligne (comportement historique).
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_TITLE_LENGTH, {
    message: `Le titre ne peut pas dépasser ${MAX_TEXT_TITLE_LENGTH} caractères.`,
  })
  textTitle?: string;

  /**
   * Taille de police d'un post texte en points (16–64). Absent =
   * auto-ajustement selon le contenu. Réservée aux publications sans média.
   */
  @IsOptional()
  @IsInt()
  @Min(MIN_TEXT_SIZE)
  @Max(MAX_TEXT_SIZE)
  textSize?: number;

  /**
   * Lieu facultatif d'un post texte (ville ou lieu saisi, ou nom renvoyé par
   * le géocodage inverse). Réservé aux publications sans média.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LOCATION_LENGTH, {
    message: `Le lieu ne peut pas dépasser ${MAX_LOCATION_LENGTH} caractères.`,
  })
  location?: string;

  /**
   * Filtre visuel d'une publication média (clé du catalogue client).
   * Ignoré pour un post texte ou sans média.
   */
  @IsOptional()
  @IsIn(MEDIA_FILTERS)
  mediaFilter?: (typeof MEDIA_FILTERS)[number];

  @IsString({ message: 'clientId est requis.' })
  @Length(8, MAX_CLIENT_ID_LENGTH, {
    message: `clientId doit contenir entre 8 et ${MAX_CLIENT_ID_LENGTH} caractères.`,
  })
  clientId!: string;
}
