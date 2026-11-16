import { describe, expect, it } from 'vitest';

import { fr } from '@/i18n/fr';
import { mediaSendErrorMessage } from './mediaError';

describe('mediaSendErrorMessage', () => {
  it('traduit un clair au-dessus du plafond', () => {
    expect(mediaSendErrorMessage(new Error('media_too_large'))).toBe(
      fr.e2eeChat.mediaTooLarge,
    );
  });

  it('traduit un fichier local illisible', () => {
    expect(mediaSendErrorMessage(new Error('media_unreadable'))).toBe(
      fr.e2eeChat.mediaUnreadable,
    );
  });

  it('retombe sur le message générique pour tout le reste', () => {
    expect(mediaSendErrorMessage(new Error('websocket closed'))).toBe(
      fr.e2eeChat.mediaSendFailed,
    );
    expect(mediaSendErrorMessage(null)).toBe(fr.e2eeChat.mediaSendFailed);
    expect(mediaSendErrorMessage('media_too_large')).toBe(fr.e2eeChat.mediaSendFailed);
  });
});
