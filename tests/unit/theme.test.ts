import { describe, expect, it } from 'vitest';
import { safeAssetUrl } from '@/lib/theme/assets';
import { copyFor, parseCopy } from '@/lib/theme/copy';
import {
  DEFAULT_PRESET,
  normalizeColor,
  normalizeRadius,
  parseTheme,
  PRESETS,
  resolveRsuiteTokens,
  resolveTokens,
  THEME_TOKENS,
  themeCss,
} from '@/lib/theme/theme';

/**
 * The theme is written by an institute admin and rendered into a stylesheet on
 * their own domain, in front of their own students, before anybody signs in.
 * That makes it semi-trusted input on a security boundary, and these are the
 * assertions that say so.
 *
 * The central one is "nothing typed reaches the stylesheet". Values are parsed
 * into numbers and re-serialised, so a theme value cannot carry characters at
 * all, let alone close a declaration and start something else.
 */

describe('what reaches the stylesheet', () => {
  it('never contains a character that could escape a style element', () => {
    // Everything an attacker would need: a closing tag, an entity, a quote,
    // a url() with a scheme, an expression. All submitted at once.
    const css = themeCss(
      parseTheme({
        preset: 'classic',
        brand: '#fff;} body{background:url(javascript:alert(1))}',
        accent: '</style><script>alert(1)</script>',
        background: 'expression(alert(1))',
        radius: '1rem;}*{display:none',
      }),
    );

    for (const character of ['<', '>', '&', '"', "'", '(', ')', '\\', '/']) {
      expect(css, `contained ${character}`).not.toContain(character);
    }
    expect(css).not.toContain('script');
    expect(css).not.toContain('javascript');
  });

  it('falls back to the preset for every value it could not parse', () => {
    const css = themeCss(
      parseTheme({ preset: 'classic', brand: 'red; color: blue' }),
    );

    // "red" is a real CSS colour and still refused, because the parser takes
    // hex only. A named colour is not worth a second syntax to validate.
    expect(css).toContain(`--primary:${PRESETS.classic.primary}`);
  });

  it('declares every token, so no page falls back to a mixed palette', () => {
    const css = themeCss(parseTheme({ preset: 'evening' }));
    for (const token of THEME_TOKENS) {
      expect(css, `missing --${token}`).toContain(`--${token}:`);
    }
  });

  it('is one :root block and nothing else', () => {
    const css = themeCss(parseTheme({ preset: 'plain' }));
    expect(css.startsWith(':root{')).toBe(true);
    expect(css.endsWith('}')).toBe(true);
    // A second block would mean a value carried a brace through.
    expect(css.split('{')).toHaveLength(2);
  });
});

describe('reading what is stored', () => {
  it('takes the preset and the overrides that parse', () => {
    const theme = parseTheme({
      preset: 'evening',
      brand: '#AABBCC',
      accent: 'not a colour',
      radius: 0.75,
    });

    expect(theme.preset).toBe('evening');
    expect(theme.brand).toBe('#aabbcc');
    expect(theme.accent).toBeNull();
    expect(theme.radius).toBe('0.75rem');
  });

  it('fails open on anything that is not a theme at all', () => {
    for (const input of [null, undefined, 'classic', 42, [], { preset: 'x' }]) {
      expect(parseTheme(input).preset).toBe(DEFAULT_PRESET);
    }
  });

  it('expands three-digit hex, so #fff and #ffffff mean the same', () => {
    expect(normalizeColor('#fff')).toBe('#ffffff');
    expect(normalizeColor('#FFF')).toBe('#ffffff');
    expect(normalizeColor('#ffff')).toBeNull();
    expect(normalizeColor('#12345g')).toBeNull();
  });

  it('bounds the radius rather than trusting the slider', () => {
    expect(normalizeRadius('0.5rem')).toBe('0.5rem');
    expect(normalizeRadius(1)).toBe('1rem');
    expect(normalizeRadius(-1)).toBeNull();
    expect(normalizeRadius(999)).toBeNull();
    expect(normalizeRadius('calc(100vw)')).toBeNull();
  });
});

describe('the colours that are derived rather than typed', () => {
  it('puts readable text on whatever brand colour is chosen', () => {
    const onDark = resolveTokens(parseTheme({ brand: '#101010' }));
    const onLight = resolveTokens(parseTheme({ brand: '#f4f4f4' }));

    // The point of deriving these: an admin cannot produce a button whose
    // label is the same colour as the button.
    expect(onDark['primary-foreground']).toBe('#ffffff');
    expect(onLight['primary-foreground']).not.toBe('#ffffff');
  });

  it('moves the text with the page background', () => {
    const dark = resolveTokens(parseTheme({ background: '#0b0b0b' }));

    expect(dark.background).toBe('#0b0b0b');
    // If foreground stayed on the light preset's near-black, the whole site
    // would be black on black.
    expect(dark.foreground).toBe('#ffffff');
    expect(dark['muted-foreground']).not.toBe(
      PRESETS.classic['muted-foreground'],
    );
  });
});

describe('the rsuite bridge (round 2 UI adoption)', () => {
  it("makes the resolved brand color the primary scale's 500 stop", () => {
    const tokens = resolveTokens(parseTheme({ brand: '#112233' }));
    expect(resolveRsuiteTokens(tokens)['rs-primary-500']).toBe('#112233');
  });

  it('gives two different institutes two different scales', () => {
    const classic = resolveRsuiteTokens(
      resolveTokens(parseTheme({ preset: 'classic' })),
    );
    const evening = resolveRsuiteTokens(
      resolveTokens(parseTheme({ preset: 'evening' })),
    );

    // Otherwise every rsuite Button on every institute's site is the same
    // color regardless of what that institute picked, the exact failure
    // mode this bridge exists to avoid.
    expect(classic['rs-primary-500']).not.toBe(evening['rs-primary-500']);
    expect(classic['rs-gray-0']).not.toBe(evening['rs-gray-0']);
  });

  it("runs gray from this institute's own background toward its own foreground", () => {
    // The evening preset is dark on light text; a gray scale built by
    // tinting toward white and shading toward black, the way the primary
    // scale is, would put a light surface under dark text on the one preset
    // meant to be read at night.
    const evening = resolveRsuiteTokens(
      resolveTokens(parseTheme({ preset: 'evening' })),
    );
    expect(evening['rs-gray-0']).toBe(PRESETS.evening.background);
  });

  it("marks only its own properties important, not the app's tokens", () => {
    const css = themeCss(parseTheme({ preset: 'classic' }));

    expect(css).toMatch(/--rs-primary-500:#[0-9a-f]{6} !important/);

    const appPrimary = css.match(/--primary:[^;]+/)?.[0];
    expect(appPrimary).toBeDefined();
    expect(appPrimary).not.toContain('!important');
  });
});

describe('the words an institute writes', () => {
  it('keeps the keys it knows and drops the rest', () => {
    const copy = parseCopy({
      hero: 'Study with us',
      // Not a copy key. If unknown keys survived, copy_json would become a
      // place to store anything and the render would depend on the database
      // rather than on COPY_KEYS.
      onclick: 'alert(1)',
      about: 42,
    });

    expect(copy.hero).toBe('Study with us');
    expect(copy.about).toBeNull();
    expect(Object.keys(copy).sort()).toEqual([
      'about',
      'footer',
      'hero',
      'tagline',
    ]);
  });

  it('truncates rather than refusing, so a long paste is not lost', () => {
    const copy = parseCopy({ tagline: 'x'.repeat(500) });
    expect(copy.tagline).toHaveLength(120);
  });

  it('writes a usable page for an institute that has written nothing', () => {
    const copy = copyFor('Grace Bible Institute', parseCopy({}));
    expect(copy.hero).toContain('Grace Bible Institute');
    expect(copy.about.length).toBeGreaterThan(20);
  });
});

describe('where a logo may come from', () => {
  it('takes https and a same-origin path', () => {
    expect(safeAssetUrl('https://example.edu/logo.svg')).toBe(
      'https://example.edu/logo.svg',
    );
    expect(safeAssetUrl('/brand/logo.png')).toBe('/brand/logo.png');
  });

  it('refuses everything that is not an image address', () => {
    // An SVG behind a data: URL is a document, and a document can carry
    // script. javascript: speaks for itself.
    for (const value of [
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==',
      'http://example.edu/logo.svg',
      '//evil.example/logo.svg',
      'logo.svg',
      '',
      null,
    ]) {
      expect(safeAssetUrl(value), `accepted ${String(value)}`).toBeNull();
    }
  });
});
