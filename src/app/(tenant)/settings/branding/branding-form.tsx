'use client';

import { useState, useTransition } from 'react';
import { Input, Slider } from 'rsuite';
import { COPY_LIMITS, type CopyKey, type CopySettings } from '@/lib/theme/copy';
import {
  PRESETS,
  resolveTokens,
  THEME_PRESETS,
  type PresetName,
  type ThemeSettings,
} from '@/lib/theme/theme';
import { SaveIndicator, type SaveState } from '../../teach/form-chrome';
import { saveBrandingAction } from './actions';

/**
 * Editing an institute's brand (mockup 11).
 *
 * THE PREVIEW IS THE REAL TOKEN SET. It renders from resolveTokens, the same
 * function that produces the stylesheet actually served on the institute's
 * domain, so the derived colours are the derived colours and not a designer's
 * guess at them. That is the whole reason this screen can offer a brand colour
 * without offering the text colour to go on it: pick a dark navy and the
 * preview shows white words on it, pick a pale gold and it shows near-black,
 * because the same function decides both here and in production.
 *
 * The four swatches are shortcuts, not the whole choice. The mockup shows only
 * them; the colour field beside them stays, because an institute with a brand
 * book has a hex value and being offered four approximations of it is worse
 * than being offered a field.
 */

const PRESET_NOTES: Record<PresetName, string> = {
  classic: 'Warm paper and navy. What most institutes want.',
  evening: 'Dark, for students who study at night on a phone.',
  plain: 'Neutral, for an institute that would rather look like a document.',
};

/** The four the design picked. Any hex still works, in the field below them. */
const BRAND_SWATCHES = ['#1f3a5f', '#7d3f63', '#2f5d50', '#8a5a12'] as const;

/** The slider speaks pixels because that is what the design specifies. */
const RADIUS_STEP_PX = 2;
const RADIUS_MAX_PX = 24;

function remToPx(rem: string): number {
  return Math.round(Number.parseFloat(rem.replace('rem', '')) * 16);
}

export function BrandingForm({
  theme: initialTheme,
  copy: initialCopy,
  logoUrl: initialLogo,
  host,
  name,
}: {
  theme: ThemeSettings;
  copy: CopySettings;
  logoUrl: string | null;
  /** Named on the save button, so it is clear what is about to change. */
  host: string;
  name: string;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [copy, setCopy] = useState(initialCopy);
  const [logoUrl, setLogoUrl] = useState(initialLogo ?? '');
  const [state, setState] = useState<SaveState>({ kind: 'clean' });
  const [pending, startTransition] = useTransition();

  const tokens = resolveTokens(theme);
  const brand = theme.brand ?? PRESETS[theme.preset].primary;
  const radiusPx = remToPx(theme.radius ?? PRESETS[theme.preset].radius);

  function edit(next: () => void) {
    next();
    setState({ kind: 'dirty' });
  }

  function save() {
    setState({ kind: 'saving' });

    const data = new FormData();
    data.set('preset', theme.preset);
    data.set('brand', theme.brand ?? '');
    data.set('accent', theme.accent ?? '');
    data.set('background', theme.background ?? '');
    data.set('radius', theme.radius ?? '');
    data.set('logoUrl', logoUrl);
    for (const [key, value] of Object.entries(copy)) {
      data.set(key, value ?? '');
    }

    startTransition(async () => {
      const outcome = await saveBrandingAction(data);
      setState(
        outcome.status === 'ok'
          ? { kind: 'saved', at: Date.now() }
          : { kind: 'error', message: outcome.message },
      );
    });
  }

  return (
    <div className="grid items-start gap-[30px] lg:grid-cols-[340px_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Field label="Preset">
          <div className="flex flex-col gap-2">
            {THEME_PRESETS.map((preset) => {
              const swatches = PRESETS[preset];
              const chosen = theme.preset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() =>
                    edit(() => setTheme((current) => ({ ...current, preset })))
                  }
                  className={`bg-card flex cursor-pointer items-center gap-3 rounded-(--radius) border px-3.5 py-2.5 text-left transition-colors ${
                    chosen
                      ? 'border-primary'
                      : 'border-border hover:border-primary'
                  }`}
                >
                  <span className="flex gap-[3px]">
                    {(['background', 'primary', 'accent'] as const).map(
                      (token) => (
                        <span
                          key={token}
                          className="border-border h-[22px] w-3.5 rounded-[3px] border"
                          style={{ backgroundColor: swatches[token] }}
                        />
                      ),
                    )}
                  </span>
                  <span className="flex flex-1 flex-col gap-px">
                    <span className="text-(length:--text-ui) font-medium capitalize">
                      {preset}
                    </span>
                    <span className="text-muted-foreground text-(length:--text-meta) leading-[1.4]">
                      {PRESET_NOTES[preset]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Brand colour">
          <div className="flex flex-wrap items-center gap-2">
            {BRAND_SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={hex}
                aria-pressed={brand.toLowerCase() === hex}
                onClick={() =>
                  edit(() =>
                    setTheme((current) => ({ ...current, brand: hex })),
                  )
                }
                className={`h-[34px] w-[34px] cursor-pointer rounded-lg border-2 ${
                  brand.toLowerCase() === hex
                    ? 'border-foreground'
                    : 'border-transparent'
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
            <input
              type="color"
              aria-label="Any other colour"
              value={brand}
              onChange={(event) =>
                edit(() =>
                  setTheme((current) => ({
                    ...current,
                    brand: event.target.value,
                  })),
                )
              }
              className="border-border h-[34px] w-[34px] cursor-pointer rounded-lg border"
            />
          </div>

          {/*
            The derived text colour, stated rather than offered. This is the
            one fact that explains why there is no second picker here.
          */}
          <span className="text-muted-foreground font-mono text-(length:--text-meta)">
            {brand} · text on it will be {tokens['primary-foreground']}
          </span>

          {/*
            A way back to the preset's own colour. Null and "the same hex the
            preset happens to use" are different stored states: the first
            follows the preset if it is ever changed, and without this there is
            no way to return to it once a swatch has been touched.
          */}
          {theme.brand !== null && (
            <button
              type="button"
              onClick={() =>
                edit(() => setTheme((current) => ({ ...current, brand: null })))
              }
              className="text-muted-foreground w-fit cursor-pointer text-(length:--text-meta) underline underline-offset-[3px]"
            >
              Use the preset&rsquo;s colour instead
            </button>
          )}
        </Field>

        <Field label="Corner radius">
          <div className="px-1 pt-1">
            <Slider
              value={radiusPx}
              min={0}
              max={RADIUS_MAX_PX}
              step={RADIUS_STEP_PX}
              onChange={(next: number) =>
                edit(() =>
                  setTheme((current) => ({
                    ...current,
                    radius: `${next / 16}rem`,
                  })),
                )
              }
            />
          </div>
          <span className="text-muted-foreground font-mono text-(length:--text-meta)">
            {radiusPx}px, {theme.radius ?? PRESETS[theme.preset].radius}
          </span>
        </Field>

        <Field label="Logo">
          <div className="border-border flex flex-col gap-2.5 rounded-(--radius) border border-dashed p-3.5">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                // A logo the admin may still be typing the address of, which
                // must not be proxied through the image optimizer or cached
                // by it. Same reasoning as chrome.tsx.
                // eslint-disable-next-line @next/next/no-img-element -- see above
                <img
                  src={logoUrl}
                  alt=""
                  className="h-[26px] w-auto max-w-24 object-contain"
                />
              ) : (
                <span
                  className="h-[26px] w-[26px] shrink-0 rounded-full"
                  style={{ backgroundColor: brand }}
                />
              )}
              <span className="text-muted-foreground text-(length:--text-meta) leading-[1.5]">
                SVG or PNG, at least 96px tall. Without one, your name is set in
                type.
              </span>
            </div>
            <Input
              value={logoUrl}
              onChange={(next: string) => edit(() => setLogoUrl(next))}
              placeholder="https://example.edu/logo.svg"
              aria-label="Address of your logo image"
            />
            {/*
              An address rather than an upload. Uploading it would mean this
              screen also owning a bucket path and a content check for a file
              that is served on every page of the institute's site, and the
              institutes that have a logo already have it hosted. Worth
              revisiting when somebody without one asks.
            */}
          </div>
        </Field>

        <Field label="Words on your front page">
          <CopyField
            field="tagline"
            label="Tagline, above the headline"
            value={copy.tagline}
            onChange={(tagline) =>
              edit(() => setCopy((c) => ({ ...c, tagline })))
            }
          />
          <CopyField
            field="hero"
            label="Headline"
            rows={2}
            value={copy.hero}
            onChange={(hero) => edit(() => setCopy((c) => ({ ...c, hero })))}
          />
          <CopyField
            field="about"
            label="About your institute"
            rows={4}
            value={copy.about}
            onChange={(about) => edit(() => setCopy((c) => ({ ...c, about })))}
          />
          <CopyField
            field="footer"
            label="Footer, on every page"
            value={copy.footer}
            onChange={(footer) =>
              edit(() => setCopy((c) => ({ ...c, footer })))
            }
          />
        </Field>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="bg-primary text-primary-foreground cursor-pointer rounded-(--radius) px-4 py-[11px] text-center text-(length:--text-ui) font-medium disabled:opacity-60"
          >
            Publish to {host}
          </button>
          <SaveIndicator state={state} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-muted-foreground text-[0.71875rem] font-medium tracking-[0.1em] uppercase">
          What a student sees
        </span>
        <Preview tokens={tokens} copy={copy} logoUrl={logoUrl} name={name} />
        <span className="text-muted-foreground max-w-[60ch] text-(length:--text-meta) leading-[1.6]">
          The preview is the real component with the real token set, not a
          picture of one. Whatever survives here is what gets served on your
          domain.
        </span>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-muted-foreground text-[0.71875rem] font-medium tracking-[0.1em] uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * One copy field, counting against the limit the parser actually enforces.
 *
 * The count says what happens rather than blocking: parseCopy truncates
 * instead of refusing, so a long paste keeps its first hundred characters and
 * loses the rest. Saying "trimmed to 120" out loud is the difference between
 * that being a decision and a surprise.
 */
function CopyField({
  field,
  label,
  value,
  rows,
  onChange,
}: {
  field: CopyKey;
  label: string;
  value: string | null;
  rows?: number;
  onChange: (value: string) => void;
}) {
  const limit = COPY_LIMITS[field];
  const length = (value ?? '').length;
  const over = length > limit;

  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-(length:--text-meta)">
        {label}
      </span>
      {rows ? (
        <Input
          as="textarea"
          rows={rows}
          value={value ?? ''}
          onChange={(next: string) => onChange(next)}
        />
      ) : (
        <Input
          value={value ?? ''}
          onChange={(next: string) => onChange(next)}
        />
      )}
      <span
        className={`text-(length:--text-meta) ${
          over ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        {over
          ? `${length} characters, trimmed to ${limit} when saved`
          : `${length} of ${limit}`}
      </span>
    </label>
  );
}

/**
 * A miniature of the institute's front page.
 *
 * Inline styles from the resolved tokens rather than the page's own classes,
 * because the point is to show a theme that is not the one currently applied
 * to the settings page itself.
 */
function Preview({
  tokens,
  copy,
  logoUrl,
  name,
}: {
  tokens: Record<string, string>;
  copy: CopySettings;
  logoUrl: string;
  name: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{
        backgroundColor: tokens.background,
        color: tokens.foreground,
        borderColor: tokens.border,
      }}
    >
      <div
        className="flex items-center gap-2.5 border-b px-[18px] py-3.5"
        style={{ backgroundColor: tokens.card, borderColor: tokens.border }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- see above
          <img src={logoUrl} alt="" className="h-5 w-auto object-contain" />
        ) : (
          <span
            className="h-5 w-5 shrink-0 rounded-full"
            style={{ backgroundColor: tokens.primary }}
          />
        )}
        <span className="text-(length:--text-ui) font-semibold">{name}</span>
        <span
          className="ml-auto px-3 py-[7px] text-(length:--text-meta) font-medium"
          style={{
            backgroundColor: tokens.primary,
            color: tokens['primary-foreground'],
            borderRadius: tokens.radius,
          }}
        >
          Sign in
        </span>
      </div>

      <div className="flex flex-col gap-5 px-[22px] py-[26px]">
        <div className="flex flex-col gap-2">
          <span
            className="text-[0.65625rem] font-medium tracking-[0.16em] uppercase"
            style={{ color: tokens['muted-foreground'] }}
          >
            {copy.tagline ?? 'Study at your own pace'}
          </span>
          <span className="font-serif text-[1.625rem] leading-[1.2]">
            {copy.hero ?? 'Courses from your institute.'}
          </span>
          {copy.about && (
            <span
              className="text-(length:--text-label) leading-[1.55]"
              style={{ color: tokens['muted-foreground'] }}
            >
              {copy.about}
            </span>
          )}
        </div>

        <div
          className="flex flex-col gap-2.5 border p-[18px]"
          style={{
            backgroundColor: tokens.card,
            borderColor: tokens.border,
            borderRadius: tokens.radius,
          }}
        >
          <span
            className="text-[0.65625rem] font-medium tracking-[0.14em] uppercase"
            style={{ color: tokens['muted-foreground'] }}
          >
            Old Testament
          </span>
          <span className="font-serif text-[1.25rem] leading-snug">
            The Pentateuch in Context
          </span>
          <span
            className="text-(length:--text-label)"
            style={{ color: tokens['muted-foreground'] }}
          >
            12 lessons · 9 hours · first lesson open to everyone
          </span>
          <div className="mt-1 flex flex-wrap gap-2.5">
            <span
              className="px-3.5 py-2.5 text-(length:--text-label) font-medium"
              style={{
                backgroundColor: tokens.primary,
                color: tokens['primary-foreground'],
                borderRadius: tokens.radius,
              }}
            >
              Enrol · $120
            </span>
            <span
              className="px-3.5 py-2.5 text-(length:--text-label) font-medium"
              style={{
                backgroundColor: tokens.secondary,
                color: tokens['secondary-foreground'],
                borderRadius: tokens.radius,
              }}
            >
              Listen free
            </span>
          </div>
        </div>
      </div>

      {copy.footer && (
        <div
          className="border-t px-[22px] py-3.5 text-(length:--text-meta)"
          style={{
            borderColor: tokens.border,
            color: tokens['muted-foreground'],
          }}
        >
          {copy.footer}
        </div>
      )}
    </div>
  );
}
