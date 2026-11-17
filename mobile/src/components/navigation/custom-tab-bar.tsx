import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { LucideIcon } from 'lucide-react-native';
import {
  Bell,
  Compass,
  House,
  MessageCircle,
  User,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  runOnJS,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { TabBarHeight, TabBarSurface } from '@/constants/theme';

/**
 * Icônes des onglets, par nom de route.
 *
 * Une table plutôt qu'une prop par écran : le layout reste déclaratif, et la
 * barre n'a pas à connaître les options de chaque `Tabs.Screen`.
 */
const TAB_ICONS: Record<string, LucideIcon> = {
  index: House,
  discover: Compass,
  notifications: Bell,
  chats: MessageCircle,
  profile: User,
};

/** Identifiant de route du fil : la barre y devient transparente (style TikTok). */
export const FEED_ROUTE = 'index';

/** Opacité du fond opaque, atteinte uniquement hors du fil. */
const OPAQUE_PROGRESS = 1;
/** Opacité du fond transparent sur le fil. */
const TRANSPARENT_PROGRESS = 0;

/**
 * Couleurs de transition des onglets (inactif → actif), en majuscules pour
 * `interpolateColor`.
 */
export const TAB_COLORS = {
  inactive: TabBarSurface.inactive,
  active: TabBarSurface.active,
} as const;

/**
 * Barre de navigation inférieure, façon TikTok.
 *
 * - sur le fil, elle est **transparente et superposée** à la vidéo ;
 * - ailleurs, elle a un **fond opaque** et un filet supérieur ;
 * - le passage transparent ↔ opaque est animé sur le thread UI (`Reanimated`),
 *   donc fluide même pendant le scroll du pager.
 *
 * Les animations par onglet vivent dans `TabButton` : la barre elle-même ne se
 * re-rend jamais quand un onglet change d'état visuel.
 */
export function CustomTabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const onFeed = state.routes[state.index]?.name === FEED_ROUTE;

  // Une seule valeur partagée pilote le fond ET le filet.
  const opaque = useSharedValue(onFeed ? TRANSPARENT_PROGRESS : OPAQUE_PROGRESS);

  // `useEffect` (et non un calcul au rendu) : les SharedValue sont immuables
  // pendant le rendu pour le React Compiler. `withTiming` interpole sur le
  // thread UI, donc aucun rendu React n'est déclenché pendant la transition.
  useEffect(() => {
    opaque.value = withTiming(onFeed ? TRANSPARENT_PROGRESS : OPAQUE_PROGRESS, {
      duration: 220,
    });
  }, [onFeed, opaque]);

  // `interpolateColor` (et non une chaîne `rgba` éditable) : Reanimated anime
  // la couleur sur le thread UI, sans re-rendu React.
  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      opaque.value,
      [TRANSPARENT_PROGRESS, OPAQUE_PROGRESS],
      [TabBarSurface.transparent, TabBarSurface.opaque],
    ),
    borderTopColor: interpolateColor(
      opaque.value,
      [TRANSPARENT_PROGRESS, OPAQUE_PROGRESS],
      ['rgba(255,255,255,0)', TabBarSurface.border],
    ),
  }));

  return (
    <Animated.View
      style={[
        styles.bar,
        { height: TabBarHeight + insets.bottom, paddingBottom: insets.bottom },
        containerStyle,
      ]}>
      <View style={styles.row}>
        {/* Sur le fil, la barre est transparente et TOUTES les icônes sont
            pleines, comme sur TikTok. Ailleurs, seul l'onglet actif est coloré. */}
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          // Expo Router traduit `href: null` en `hidden`: la route reste dans
          // le state mais ne doit pas prendre de place dans la barre.
          if (options.hidden || options.tabBarButton === null) {
            return null;
          }
          const focused = state.index === index;
          return (
            <TabButton
              key={route.key}
              routeName={route.name}
              label={readLabel(options.tabBarLabel ?? options.title ?? route.name)}
              focused={focused}
              filled={onFeed}
              onPress={() => pressTab(emitter, navigateToTab, route.key, focused)}
            />
          );
        })}
      </View>
    </Animated.View>
  );
}

/**
 * Pile « icône + libellé » d'un onglet.
 *
 * Le rebond (`scale`) et la couleur sont deux valeurs partagées propres à
 * l'onglet : un tap n'anime que lui, et aucun rendu React n'est déclenché
 * pendant l'animation.
 */
function TabButton({
  routeName,
  label,
  focused,
  filled,
  onPress,
}: {
  routeName: string;
  label: string;
  focused: boolean;
  /** Vrai sur le fil : toutes les icônes sont pleines. */
  filled: boolean;
  onPress: () => void;
}) {
  const Glyph = TAB_ICONS[routeName] ?? House;
  const scale = useSharedValue(1);
  const progress = useSharedValue(focused ? 1 : 0);

  // Même mécanisme que la barre : une seule animation par changement de focus.
  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, { duration: 200 });
  }, [focused, progress]);

  // Le SVG est un composant : sa couleur est une prop animée, l'échelle vient
  // du wrapper `Animated.View`.
  const iconColor = useDerivedValue(() =>
    interpolateColor(progress.value, [0, 1], [TAB_COLORS.inactive, TAB_COLORS.active]),
  );

  const iconWrapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Indicateur actif : un trait court qui s'ouvre et apparaît en fondu.
  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    width: interpolate(progress.value, [0, 1], [0, INDICATOR_WIDTH]),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [TAB_COLORS.inactive, TAB_COLORS.active],
    ) as string,
    opacity: 0.6 + progress.value * 0.4,
  }));

  // L'appui est un état React ; le ressort suit dans un effet, comme le fait
  // `ProgressRing`. Le React Compiler interdit d'écrire `.value` au rendu.
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    // `withSpring` renvoie un objet d'animation que la règle `immutability`
    // prend pour une mutation : c'est l'affectation attendue d'une SharedValue.
    // eslint-disable-next-line react-hooks/immutability
    scale.value = withSpring(pressed ? PRESSED_SCALE : 1, SPRING);
  }, [pressed, scale]);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={styles.tab}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}>
      <Animated.View style={iconWrapStyle}>
        <AnimatedIcon Glyph={Glyph} color={iconColor} filled={filled} />
      </Animated.View>
      <Animated.Text numberOfLines={1} style={[styles.label, labelStyle]}>
        {label}
      </Animated.Text>
      <Animated.View style={[styles.indicator, indicatorStyle]} />
    </Pressable>
  );
}

/**
 * Icône Lucide dont la couleur vient d'une `SharedValue`.
 *
 * `useAnimatedProps` exige une prop sur un composant animable : Lucide expose
 * `stroke` et accepte un `color`. Le wrapper `Animated.View` porte l'échelle,
 * cette icône porte la couleur, les deux restant sur le thread UI.
 */
function AnimatedIcon({
  Glyph,
  color,
  filled,
}: {
  Glyph: LucideIcon;
  color: SharedValue<string>;
  filled: boolean;
}) {
  // `useAnimatedReaction` écrit la couleur dans un état local, seule façon de
  // traverser la frontière SVG ↔ Reanimated sans composant animable dédié.
  const [resolved, setResolved] = useState<string>(TAB_COLORS.inactive);

  useAnimatedReaction(
    () => color.value,
    (value) => {
      runOnJS(setResolved)(value);
    },
  );

  // Sur le fil, toutes les icônes sont pleines comme sur TikTok ; ailleurs,
  // elles restent en trait et seule la couleur distingue l'onglet actif.
  return (
    <Glyph
      size={ICON_SIZE}
      strokeWidth={filled ? 1.8 : 2.1}
      color={resolved}
      fill={filled ? resolved : 'none'}
    />
  );
}

/** Ressort commun aux rebonds d'icône : rapide, sans oscillation visible. */
const SPRING = { damping: 15, stiffness: 420, mass: 0.6 } as const;

/** Facteur d'échelle pendant l'appui, avant retour ressort à 1. */
const PRESSED_SCALE = 0.8;

/** Taille des icônes d'onglet. */
const ICON_SIZE = 21;

/** Longueur du trait actif sous le libellé. */
const INDICATOR_WIDTH = 16;

/** `tabBarLabel` peut être une chaîne ou une fonction de rendu : on ne garde que le texte. */
function readLabel(label: unknown): string {
  return typeof label === 'string' ? label : '';
}

/** Un tap sur l'onglet actif ne renavigue pas : il replie les stacks enfants. */
function pressTab(
  emitter: BottomTabBarProps['emitter'],
  navigateToTab: BottomTabBarProps['navigateToTab'],
  routeKey: string,
  focused: boolean,
): void {
  const event = emitter.emit({
    type: 'tabPress',
    target: routeKey,
    canPreventDefault: true,
  });
  if (focused || event.defaultPrevented) {
    return;
  }
  navigateToTab(routeKey);
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    // Aucune ombre : la barre flotte sur le média ou sur la page, pas au-dessus.
    elevation: 0,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    // `minWidth: 0` autorise le rétrécissement sous la largeur du texte : sans
    // lui, « Découvrir » impose sa largeur et pousse « Profil » hors écran.
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingTop: 6,
    paddingHorizontal: 2,
  },
  // Trait actif sous le libellé, façon TikTok : il s'ouvre depuis le centre.
  indicator: {
    height: 2.5,
    borderRadius: 1.25,
    backgroundColor: TabBarSurface.active,
  },
  // Le libellé est borné à la largeur de son onglet (`flexShrink` + centre) :
  // les cinq colonnes restent d'égale largeur et « Profil » ne déborde plus.
  label: {
    flexShrink: 1,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
});
