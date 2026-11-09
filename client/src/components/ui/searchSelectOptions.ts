export type SearchOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

const normalize = (value: string) => value.trim().toLowerCase();

export function filterSearchOptions<T extends SearchOption>(
  options: T[],
  query: string,
): T[] {
  const needle = normalize(query);
  if (!needle) return options;
  return options.filter(
    (option) =>
      normalize(option.label).includes(needle) ||
      normalize(option.value).includes(needle),
  );
}

export type ListAnchor = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: 'down' | 'up';
};

const VIEWPORT_GAP = 8;
const MAX_LIST_HEIGHT = 256;
const MIN_USABLE_HEIGHT = 128;

export function anchorFor(rect: DOMRect, viewportHeight: number): ListAnchor {
  const below = viewportHeight - rect.bottom - VIEWPORT_GAP;
  const above = rect.top - VIEWPORT_GAP;
  const up = below < MIN_USABLE_HEIGHT && above > below;
  const space = up ? above : below;
  return {
    top: up ? rect.top : rect.bottom,
    left: rect.left,
    width: rect.width,
    maxHeight: Math.max(MIN_USABLE_HEIGHT, Math.min(MAX_LIST_HEIGHT, space)),
    placement: up ? 'up' : 'down',
  };
}

export function nextEnabledIndex<T extends SearchOption>(
  options: T[],
  from: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (from + direction * step + options.length * step) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}
