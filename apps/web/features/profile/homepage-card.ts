import type { ProfilePayload } from './profile-api';

export type HomepageCard = { displayName: string; headline: string; location: string; description: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => Array.isArray(value) ? value.join('、') : value == null ? '' : String(value);
const sourceOf = (payload: ProfilePayload | null) => object(payload?.data || payload);
const profileOf = (payload: ProfilePayload | null) => {
  const source = sourceOf(payload);
  return object(source.profile || source);
};

export function readHomepageCard(payload: ProfilePayload | null): HomepageCard {
  const profile = profileOf(payload);
  const preferences = object(sourceOf(payload).preferences);
  const card = object(profile.homepage || object(profile.extra).homepage);
  const value = (key: keyof HomepageCard, fallback: unknown) => text(Object.hasOwn(card, key) ? card[key] : fallback);
  return {
    displayName: value('displayName', profile.name),
    headline: value('headline', preferences.targetTitles),
    location: value('location', profile.city || profile.homeCity),
    description: value('description', profile.selfIntroduction),
  };
}

// The profile API stores unknown top-level keys in extra. Preserve its other
// contents while saving display-only overrides; never send resume fields.
export function homepageCardUpdate(payload: ProfilePayload | null, card: HomepageCard) {
  const extra = object(profileOf(payload).extra);
  return { profile: { ...extra, homepage: {
    ...object(extra.homepage),
    displayName: card.displayName.trim(),
    headline: card.headline.trim(),
    location: card.location.trim(),
    description: card.description.trim(),
  } } };
}
