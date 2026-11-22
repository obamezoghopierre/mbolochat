import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  MAX_CAPTION_LENGTH,
  MAX_LOCATION_LENGTH,
  MAX_TEXT_PAGE_LENGTH,
  MAX_TEXT_PAGES,
  MAX_TEXT_SIZE,
  MAX_TEXT_TITLE_LENGTH,
  MIN_TEXT_SIZE,
  TEXT_ALIGNS,
  TEXT_BACKGROUNDS,
  TEXT_COLORS,
  TEXT_FONTS,
  TextPageStyleDto,
} from './create-publication.dto.js';

/**
 * Mise à jour d'une publication par son auteur.
 *
 * Tous les champs sont optionnels : absent = inchangé. `textTitle` accepte
 * `null` pour effacer le titre dédié ; les champs de style reprennent les
 * mêmes listes que la création et ne s'appliquent qu'aux posts texte.
 */
export class UpdatePublicationDto {
  /**
   * Nouvel ordre des médias d'une publication photo/vidéo/carrousel, comme
   * Instagram : on peut retirer des médias ou les réordonner, pas en ajouter.
   * Seuls les médias déjà attachés sont acceptés ; au moins un reste.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  mediaAssetIds?: string[];

  @IsOptional()
  @IsString({ message: 'La légende doit être un texte.' })
  @MaxLength(MAX_CAPTION_LENGTH, {
    message: `La légende ne peut pas dépasser ${MAX_CAPTION_LENGTH} caractères.`,
  })
  caption?: string;

  /** Pages d'un post texte multi-cartes : même règle qu'à la création. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEXT_PAGES)
  @IsString({ each: true })
  @MaxLength(MAX_TEXT_PAGE_LENGTH, { each: true })
  textPages?: string[];

  /**
   * Style par page, aligné sur `textPages` (index identique). Fournir ce
   * champ sans `textPages` réapplique les styles aux pages existantes.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEXT_PAGES)
  @ValidateNested({ each: true })
  @Type(() => TextPageStyleDto)
  textPageStyles?: TextPageStyleDto[];

  /** `null` efface le titre dédié ; absent = inchangé. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_TEXT_TITLE_LENGTH, {
    message: `Le titre ne peut pas dépasser ${MAX_TEXT_TITLE_LENGTH} caractères.`,
  })
  textTitle?: string | null;

  @IsOptional()
  @IsIn(TEXT_BACKGROUNDS)
  textBackground?: (typeof TEXT_BACKGROUNDS)[number];

  @IsOptional()
  @IsIn(TEXT_FONTS)
  textFont?: (typeof TEXT_FONTS)[number];

  @IsOptional()
  @IsIn(TEXT_ALIGNS)
  textAlign?: (typeof TEXT_ALIGNS)[number];

  /** `null` repasse la couleur en « auto » (teinte du thème). */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(TEXT_COLORS)
  textColor?: (typeof TEXT_COLORS)[number] | null;

  /** Taille manuelle en points ; `null` revient à l'auto-ajustement. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(MIN_TEXT_SIZE)
  @Max(MAX_TEXT_SIZE)
  textSize?: number | null;

  /** Lieu du post texte ; chaîne vide ou `null` l'efface. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_LOCATION_LENGTH, {
    message: `Le lieu ne peut pas dépasser ${MAX_LOCATION_LENGTH} caractères.`,
  })
  location?: string | null;
}
