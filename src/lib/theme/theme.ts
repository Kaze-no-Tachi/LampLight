/**
 * Per-tenant theming (PRD section 9, P0-12).
 *
 * WHY THIS IS A TOKEN ALLOW-LIST AND NOT A CSS FIELD
 *
 * The obvious version of this feature is a textarea of custom CSS. It is also
 * the version that hands every institute admin script execution on their own
 * institute's domain, against their own students, on a page that is served
 * before anybody signs in. CSS reaches the same places script does once it can
 * name selectors and load external resources, and the value is written by
 * somebody whose account can be compromised like any other.
 *
 * So v1 has no CSS field. An institute picks a preset and may override a
 * handful of named values. Nothing an admin types is ever interpolated into a
 * stylesheet: the token *names* come from a fixed list in this file, and the
 * *values* are parsed into numbers and re-serialised from those numbers. A
 * value that does not parse is dropped and the preset's value is used, because
 * a mistyped colour must not take the institute's home page down.
 *
 * WHAT AN INSTITUTE CAN ACTUALLY CHANGE
 *
 * A preset, a brand colour, an accent, a page background, and a corner radius.
 * Everything else in the token set is derived, including the text colour that
 * sits on each of those, which is chosen for contrast rather than typed. An
 * admin cannot produce white text on a white button here, which is the most
 * common way self-serve theming ends up looking broken.
 */

export const THEME_PRESETS = ['classic', 'evening', 'plain'] as const;
export type PresetName = (typeof THEME_PRESETS)[number];

export const DEFAULT_PRESET: PresetName = 'classic';

/**
 * Every custom property the application is allowed to set at request time.
 *
 * These names match the tokens declared in globals.css. A name that is not in
 * this list can never reach the stylesheet, which is what makes the generated
 * CSS a function of this file rather than of the database.
 */
export const THEME_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'border',
  'ring',
  'radius',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
export type TokenMap = Record<ThemeToken, string>;

/**
 * The three presets, as complete token sets.
 *
 * Complete rather than layered on a base: a partial preset means a token can
 * be missing, and a missing token falls back to whatever globals.css happens
 * to declare, which is a different look on some pages and not others.
 */
export const PRESETS: Record<PresetName, TokenMap> = {
  // Warm paper and navy. What most institutes will want.
  classic: {
    background: '#fbfaf7',
    foreground: '#1b1a17',
    card: '#ffffff',
    'card-foreground': '#1b1a17',
    primary: '#1f3a5f',
    'primary-foreground': '#ffffff',
    secondary: '#eae6dd',
    'secondary-foreground': '#1f3a5f',
    muted: '#f1eee8',
    'muted-foreground': '#6b6559',
    accent: '#e8eef6',
    'accent-foreground': '#1f3a5f',
    border: '#e2ddd2',
    ring: '#1f3a5f',
    radius: '0.5rem',
  },
  // Dark, for institutes whose students study at night on a phone.
  evening: {
    background: '#14161a',
    foreground: '#eef1f5',
    card: '#1b1e24',
    'card-foreground': '#eef1f5',
    primary: '#8ab4f8',
    'primary-foreground': '#10131a',
    secondary: '#232830',
    'secondary-foreground': '#eef1f5',
    muted: '#232830',
    'muted-foreground': '#a4adba',
    accent: '#2b323d',
    'accent-foreground': '#eef1f5',
    border: '#2a2f38',
    ring: '#8ab4f8',
    radius: '0.75rem',
  },
  // Neutral and unopinionated, for an institute that wants to look like a
  // document rather than a brand.
  plain: {
    background: '#ffffff',
    foreground: '#111827',
    card: '#ffffff',
    'card-foreground': '#111827',
    primary: '#111827',
    'primary-foreground': '#ffffff',
    secondary: '#f3f4f6',
    'secondary-foreground': '#111827',
    muted: '#f3f4f6',
    'muted-foreground': '#6b7280',
    accent: '#f3f4f6',
    'accent-foreground': '#111827',
    border: '#e5e7eb',
    ring: '#9ca3af',
    radius: '0.375rem',
  },
};

/**
 * The editable shape, which is also what the settings form binds to.
 *
 * Null means "use the preset's value" rather than "no value", so an institute
 * that clears its brand colour goes back to the preset instead of to nothing.
 */
export type ThemeSettings = {
  preset: PresetName;
  brand: string | null;
  accent: string | null;
  background: string | null;
  radius: string | null;
};

export const DEFAULT_THEME: ThemeSettings = {
  preset: DEFAULT_PRESET,
  brand: null,
  accent: null,
  background: null,
  radius: null,
};

/** Six or three hex digits. Anything else is not a colour as far as this goes. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Parses a colour to its three channel values, or null.
 *
 * The parse is the security boundary: everything downstream works with numbers
 * and the string that eventually reaches CSS is built by toHex below, so the
 * bytes an admin typed never appear in a stylesheet even when they are valid.
 */
function parseColor(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!HEX.test(trimmed)) return null;

  const digits =
    trimmed.length === 4
      ? // #abc means #aabbcc.
        trimmed
          .slice(1)
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : trimmed.slice(1);

  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
}

function toHex([r, g, b]: [number, number, number]): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Normalises a colour to lowercase six-digit hex, or null if it is not one. */
export function normalizeColor(value: unknown): string | null {
  const parsed = parseColor(value);
  return parsed ? toHex(parsed) : null;
}

/**
 * A radius between 0 and 2rem, in quarter-pixel steps, or null.
 *
 * Accepts a bare number as well as a rem string, because the settings form
 * uses a slider and an institute pasting "0.5rem" should also work.
 */
export function normalizeRadius(value: unknown): string | null {
  const raw =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value.trim().replace(/rem$/i, ''))
        : Number.NaN;

  if (!Number.isFinite(raw) || raw < 0 || raw > 2) return null;
  return `${Math.round(raw * 1000) / 1000}rem`;
}

/** Perceived brightness, used only to decide which text colour to put on top. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Text that stays readable on the given background.
 *
 * Not pure black or pure white: near-black on a light surface and near-white
 * on a dark one reads better and matches the presets.
 */
function readableOn(color: [number, number, number]): string {
  return luminance(color) > 0.45 ? '#14161a' : '#ffffff';
}

/** Blends two colours, for the muted text that sits on a custom background. */
function mix(
  a: [number, number, number],
  b: [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

/**
 * Reads whatever is in theme_json into the editable shape.
 *
 * Fails open, field by field. An institute with a half-written theme, or one
 * whose column holds something from an older shape, gets the preset for the
 * parts that did not parse and keeps the parts that did. Throwing here would
 * mean one bad value takes down every page on that institute's domain,
 * including the settings page where they would fix it.
 */
export function parseTheme(input: unknown): ThemeSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return DEFAULT_THEME;
  }

  const record = input as Record<string, unknown>;
  const preset = THEME_PRESETS.find((name) => name === record.preset);

  return {
    preset: preset ?? DEFAULT_PRESET,
    brand: normalizeColor(record.brand),
    accent: normalizeColor(record.accent),
    background: normalizeColor(record.background),
    radius: normalizeRadius(record.radius),
  };
}

/**
 * The full token set for a theme: the preset, with the overrides applied and
 * their dependent tokens re-derived.
 */
export function resolveTokens(settings: ThemeSettings): TokenMap {
  const tokens: TokenMap = { ...PRESETS[settings.preset] };

  const background = parseColor(settings.background);
  if (background) {
    const text = parseColor(readableOn(background));
    tokens.background = toHex(background);
    tokens.card = toHex(mix(background, text ?? [0, 0, 0], 0.04));
    tokens.foreground = toHex(text ?? [0, 0, 0]);
    tokens['card-foreground'] = tokens.foreground;
    // Muted text has to move with the background too, or a dark background
    // keeps the preset's dark grey and the secondary text disappears.
    tokens.muted = toHex(mix(background, text ?? [0, 0, 0], 0.07));
    tokens['muted-foreground'] = toHex(
      mix(background, text ?? [0, 0, 0], 0.55),
    );
    tokens.border = toHex(mix(background, text ?? [0, 0, 0], 0.14));
  }

  const brand = parseColor(settings.brand);
  if (brand) {
    tokens.primary = toHex(brand);
    tokens['primary-foreground'] = readableOn(brand);
    tokens.ring = toHex(brand);
    tokens['secondary-foreground'] = toHex(brand);
  }

  const accent = parseColor(settings.accent);
  if (accent) {
    tokens.accent = toHex(accent);
    tokens['accent-foreground'] = readableOn(accent);
  }

  if (settings.radius) tokens.radius = settings.radius;

  return tokens;
}

/**
 * The characters a generated declaration block may contain.
 *
 * Note what is absent: <, >, &, and quotes. That is what makes it safe to put
 * the result in a <style> element as a text child, where React would otherwise
 * escape those characters into something CSS reads literally, and it is why
 * there is no dangerouslySetInnerHTML anywhere in this feature.
 *
 * This is a check on the generator, not on the input. Input has already been
 * parsed into numbers by the time anything reaches here, so a failure means
 * this file changed in a way that lets an unparsed value through. `!` is here
 * only for the `!important` the rsuite bridge below writes on its own
 * properties; it is a fixed string this file emits, never something read
 * from a token value.
 */
const SAFE_CSS = /^[a-z0-9:;{}#.\-, !\n]*$/i;

/**
 * The stylesheet for one institute: a single :root block of custom properties.
 *
 * Returns the default preset's block if the generated text ever fails the
 * character check, so the failure mode of a future mistake is "looks generic"
 * rather than "serves attacker-controlled CSS".
 */
export function themeCss(settings: ThemeSettings): string {
  const css = declarations(resolveTokens(settings));
  if (!SAFE_CSS.test(css)) return declarations(PRESETS[DEFAULT_PRESET]);
  return css;
}

function declarations(tokens: TokenMap): string {
  // Iterating THEME_TOKENS rather than Object.keys means the output is a
  // function of the fixed list even if a token map somehow carries extra keys.
  const body = THEME_TOKENS.map((token) => `--${token}:${tokens[token]}`).join(
    ';',
  );

  // rsuite's own stylesheet declares this same set of names at :root, loaded
  // as an ordinary import with no relationship to the precedence this block
  // renders under. `!important` is what makes the institute's colors win
  // regardless of which stylesheet the browser happens to place last, rather
  // than depending on load order being right by accident.
  const rsuite = Object.entries(resolveRsuiteTokens(tokens))
    .map(([name, value]) => `--${name}:${value} !important`)
    .join(';');

  return `:root{${body};${rsuite}}`;
}

/**
 * rsuite (round 2 UI adoption, see docs/plans/rsuite-adoption.md) themes
 * itself through its own CSS variables, entirely independent of the ones
 * above: it ships with a fixed blue and gray scale that has no idea an
 * institute picked its own brand color. Every rsuite component this app
 * adopts reads a primary and gray scale derived from the exact tokens above
 * instead, so a rsuite Button is the institute's brand color, not rsuite's.
 *
 * Ten stops each, the same convention rsuite's own scale uses (50 lightest to
 * 900 darkest, 500 the base tone). Primary tints toward white and shades
 * toward black, which is how a brand color's hover and active states read
 * regardless of theme. Gray runs between the institute's own background and
 * foreground rather than toward white and black, so a rsuite surface sits on
 * the actual page (dark for the evening preset, light for the others)
 * instead of assuming a light theme no matter what preset is active.
 */
const RSUITE_PRIMARY_TINTS: Record<string, number> = {
  50: 0.92,
  100: 0.84,
  200: 0.68,
  300: 0.52,
  400: 0.26,
};
const RSUITE_PRIMARY_SHADES: Record<string, number> = {
  600: 0.12,
  700: 0.24,
  800: 0.36,
  900: 0.48,
};
const RSUITE_GRAY_STOPS: Record<string, number> = {
  0: 0,
  50: 0.04,
  100: 0.08,
  200: 0.16,
  300: 0.28,
  400: 0.42,
  500: 0.55,
  600: 0.68,
  700: 0.78,
  800: 0.88,
  900: 0.96,
};

const RSUITE_WHITE: [number, number, number] = [255, 255, 255];
const RSUITE_BLACK: [number, number, number] = [0, 0, 0];

/** The rsuite `--rs-*` custom properties derived from a resolved token map. */
export function resolveRsuiteTokens(tokens: TokenMap): Record<string, string> {
  const primary = parseColor(tokens.primary) ?? RSUITE_BLACK;
  const background = parseColor(tokens.background) ?? RSUITE_WHITE;
  const foreground = parseColor(tokens.foreground) ?? RSUITE_BLACK;

  const rs: Record<string, string> = { 'rs-primary-500': toHex(primary) };
  for (const [stop, amount] of Object.entries(RSUITE_PRIMARY_TINTS)) {
    rs[`rs-primary-${stop}`] = toHex(mix(primary, RSUITE_WHITE, amount));
  }
  for (const [stop, amount] of Object.entries(RSUITE_PRIMARY_SHADES)) {
    rs[`rs-primary-${stop}`] = toHex(mix(primary, RSUITE_BLACK, amount));
  }
  for (const [stop, amount] of Object.entries(RSUITE_GRAY_STOPS)) {
    rs[`rs-gray-${stop}`] = toHex(mix(background, foreground, amount));
  }
  return rs;
}

/** Serialises the editable shape back to what theme_json should hold. */
export function serializeTheme(
  settings: ThemeSettings,
): Record<string, string> {
  const json: Record<string, string> = { preset: settings.preset };
  if (settings.brand) json.brand = settings.brand;
  if (settings.accent) json.accent = settings.accent;
  if (settings.background) json.background = settings.background;
  if (settings.radius) json.radius = settings.radius;
  return json;
}
