import { Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service.js';
import { SocialCdnController } from './social-cdn.controller.js';
import { SocialMediaController } from './social-media.controller.js';
import { SocialMediaService } from './social-media.service.js';

/**
 * Médias du réseau social (S3/R2), distincts du module `media` du chat qui
 * signe des chemins locaux. Nom de dossier `social-media` pour éviter la
 * collision ; le plan (ADR-0001) appelle ce domaine « media (social) ».
 */
@Module({
  controllers: [SocialMediaController, SocialCdnController],
  providers: [SocialMediaService, ObjectStorageService],
  exports: [SocialMediaService, ObjectStorageService],
})
export class SocialMediaModule {}
