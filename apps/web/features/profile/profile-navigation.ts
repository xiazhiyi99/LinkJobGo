export const PROFILE_SECTION_OFFSET = 48;
export const PROFILE_NAV_ROW_HEIGHT = 44;
export const PROFILE_NAV_ROW_GAP = 6;

export type ProfileSectionLink = {
  id: string;
  title: string;
  description: string;
};

type SectionPosition = { id: string; top: number };
type ViewportPosition = { scrollY: number; scrollHeight: number; viewportHeight: number };
export type ProfileNavigationClick = { id: string; scrollY: number; scrollHeight: number };

export function getActiveProfileSection(
  positions: SectionPosition[],
  viewport: ViewportPosition,
  clicked?: ProfileNavigationClick | null,
): string | null {
  if (!positions.length) return null;

  // Several anchors near the page bottom can share the same clamped scroll position.
  if (clicked && Math.abs(clicked.scrollY - viewport.scrollY) <= 2
    && Math.abs(clicked.scrollHeight - viewport.scrollHeight) <= 2
    && positions.some(({ id }) => id === clicked.id)) {
    return clicked.id;
  }

  const maxScroll = viewport.scrollHeight - viewport.viewportHeight;
  if (maxScroll > 0 && viewport.scrollY >= maxScroll - 2) {
    return positions[positions.length - 1].id;
  }

  let active = positions[0].id;
  for (const section of positions) {
    if (section.top > PROFILE_SECTION_OFFSET + 1) break;
    active = section.id;
  }
  return active;
}

export function getProfileNavigationLayout(count: number, availableHeight: number) {
  if (count <= 0) return { columns: 1 as const, rows: 0 };
  const capacity = Math.max(1, Math.floor(
    (Math.max(0, availableHeight) + PROFILE_NAV_ROW_GAP)
      / (PROFILE_NAV_ROW_HEIGHT + PROFILE_NAV_ROW_GAP),
  ));
  if (count <= capacity) return { columns: 1 as const, rows: Math.max(1, count) };

  // On very short screens keep two columns and allow the list itself to scroll.
  return { columns: 2 as const, rows: Math.max(Math.ceil(count / 2), capacity) };
}
