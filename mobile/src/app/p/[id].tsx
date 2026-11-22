import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Lien web partagé (`https://…/p/<id>`) ouvert dans l'app par les Universal
 * Links (iOS) ou App Links (Android) : même écran que le lien profond.
 */
export default function SharedPostLink() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <Redirect href={id ? `/post/${id}` : '/'} />;
}
