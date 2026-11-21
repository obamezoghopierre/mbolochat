const { withDangerousMod } = require('expo/config-plugins');
const { existsSync, appendFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * react-native-webrtc référence org.webrtc.Dav1dDecoder$Natives (classe JNI
 * fournie par la lib native) sans la livrer dans l'AAR Java. R8 traite la
 * classe manquante comme une erreur fatale au minify release ; -dontwarn
 * conserve le comportement ProGuard historical (warning ignoré).
 */
const RULES = [
  '-dontwarn org.webrtc.Dav1dDecoder$Natives',
  '-dontwarn org.webrtc.Dav1dDecoder*',
];

module.exports = function withProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const file = join(config.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const existing = existsSync(file) ? require('node:fs').readFileSync(file, 'utf8') : '';
      const missing = RULES.filter((rule) => !existing.includes(rule));
      if (missing.length > 0) {
        if (!existsSync(file)) {
          writeFileSync(file, '# ProGuard rules\n');
        }
        appendFileSync(file, `\n# react-native-webrtc : classes JNI absentes de l'AAR\n${missing.join('\n')}\n`);
      }
      return config;
    },
  ]);
};
