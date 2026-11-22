import * as outbox from '@/lib/outbox';
import type { ConversationSummary } from '@/lib/types';

/**
 * Envoi d'une publication à plusieurs discussions d'un coup (feuille de
 * partage). Passe par la file d'envoi classique — les mêmes garanties que le
 * chat (rejeu, ordre, hors ligne) — avec le message facultatif puis le lien.
 *
 * Les discussions chiffrées sont exclues par construction : leur envoi exige
 * la session de chiffrement ouverte dans l'écran de chat, la feuille les
 * ouvre donc une par une. Renvoie le nombre de discussions servies.
 */
export async function sendPostToMany(
  token: string,
  conversations: ConversationSummary[],
  link: string,
  message: string,
): Promise<number> {
  let sent = 0;
  for (const conversation of conversations) {
    if (conversation.e2eeSince) {
      continue;
    }
    try {
      if (message) {
        await outbox.enqueue({ conversationId: conversation.id, content: message });
      }
      await outbox.enqueue({ conversationId: conversation.id, content: link });
      sent += 1;
    } catch {
      // Une discussion en échec n'empêche pas les autres.
    }
  }
  if (sent > 0) {
    await outbox.drain(token).catch(() => undefined);
  }
  return sent;
}
