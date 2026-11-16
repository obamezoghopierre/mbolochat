/** Identifiant unique à cet appareil ; le serveur le traite comme une opacité. */
let sequence = 0;

/**
 * Clé d'idempotence d'une écriture (message, commentaire) : rejouer la même
 * requête après une coupure doit renvoyer l'objet existant, jamais un doublon.
 */
export function newClientId(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}
