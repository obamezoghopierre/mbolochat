import { Crosshair, MapPin } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { FeedSurface, Radii, Spacing, Type } from '@/constants/theme';
import { fr } from '@/i18n/fr';
import { api } from '@/lib/api';
import { currentCoordinates, getLocationAccess, requestLocationAccess } from '@/lib/location';

/**
 * Champ « Ajouter un lieu » d'une publication, comme Instagram : saisie libre
 * avec suggestions de villes, ou détection par la position (ville seulement,
 * les coordonnées ne quittent pas l'appareil au-delà du géocodage).
 */
export function LocationField({
  token,
  value,
  onChange,
  disabled,
  onError,
}: {
  token: string | null;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
}) {
  const [locating, setLocating] = useState(false);
  const [suggestions, setSuggestions] = useState<{ city: string; country: string | null }[]>([]);
  const edited = useRef(false);

  const label = (place: { city: string; country: string | null }) =>
    place.country ? `${place.city}, ${place.country}` : place.city;

  const detect = useCallback(async () => {
    if (!token || locating) {
      return;
    }
    setLocating(true);
    try {
      let access = await getLocationAccess();
      if (access.status === 'undetermined') {
        access = await requestLocationAccess();
      }
      if (access.status !== 'granted') {
        onError?.(fr.social.createLocationDenied);
        return;
      }
      const coords = await currentCoordinates();
      const place = coords ? await api.reverseGeo(token, coords.latitude, coords.longitude) : null;
      if (!place?.city) {
        onError?.(fr.social.createLocationFailed);
        return;
      }
      edited.current = false;
      onChange(label(place));
    } catch {
      onError?.(fr.social.createLocationFailed);
    } finally {
      setLocating(false);
    }
  }, [locating, onChange, onError, token]);

  useEffect(() => {
    const query = value.trim();
    if (!token || !edited.current || query.length < 3) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .geoSearch(token, query)
        .then((places) => !cancelled && setSuggestions(places))
        .catch(() => !cancelled && setSuggestions([]));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, value]);

  return (
    <View>
      <View style={styles.row}>
        <Icon icon={MapPin} size={15} color={FeedSurface.onMediaFaint} />
        <TextInput
          value={value}
          onChangeText={(next) => {
            edited.current = true;
            onChange(next);
          }}
          editable={!disabled}
          placeholder={fr.social.createLocationPlaceholder}
          placeholderTextColor={FeedSurface.onMediaFaint}
          maxLength={100}
          style={styles.input}
          accessibilityLabel={fr.social.createLocationInput}
        />
        <Pressable
          onPress={() => void detect()}
          disabled={locating || disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={fr.social.createLocationGps}
          style={styles.gps}>
          {locating ? (
            <ActivityIndicator size="small" color={FeedSurface.onMediaSoft} />
          ) : (
            <Icon icon={Crosshair} size={16} color={FeedSurface.onMediaSoft} />
          )}
        </Pressable>
      </View>
      {suggestions.length > 0 ? (
        <View style={styles.list}>
          {suggestions.map((place) => (
            <Pressable
              key={label(place)}
              onPress={() => {
                edited.current = false;
                onChange(label(place));
                setSuggestions([]);
              }}
              accessibilityRole="button"
              style={styles.item}>
              <Icon icon={MapPin} size={14} color={FeedSurface.onMediaFaint} />
              <ThemedText numberOfLines={1} style={styles.itemText}>
                {label(place)}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  input: { ...Type.caption, flex: 1, color: FeedSurface.onMediaSoft, padding: 0 },
  gps: {
    width: 30,
    height: 30,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FeedSurface.glass,
  },
  list: {
    marginTop: Spacing.one,
    borderRadius: Radii.md,
    backgroundColor: FeedSurface.glass,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  itemText: { ...Type.caption, fontWeight: '600', flexShrink: 1, color: FeedSurface.onMedia },
});
