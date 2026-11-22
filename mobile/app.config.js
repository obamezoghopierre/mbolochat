/**
 * Configuration dynamique par-dessus `app.json` : quand `EXPO_PUBLIC_WEB_URL`
 * est défini au build, l'app déclare son domaine pour les Universal Links
 * (iOS) et les App Links (Android), afin que `https://<domaine>/p/<id>`
 * ouvre directement l'app. Sans cette variable, rien ne change.
 *
 * Nécessite un nouveau build natif (pas une simple mise à jour OTA).
 */
module.exports = ({ config }) => {
  const raw = process.env.EXPO_PUBLIC_WEB_URL;
  if (!raw) {
    return config;
  }
  let host;
  try {
    host = new URL(raw).host;
  } catch {
    return config;
  }
  return {
    ...config,
    ios: {
      ...config.ios,
      associatedDomains: [...(config.ios?.associatedDomains ?? []), `applinks:${host}`],
    },
    android: {
      ...config.android,
      intentFilters: [
        ...(config.android?.intentFilters ?? []),
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host, pathPrefix: '/p/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
  };
};
