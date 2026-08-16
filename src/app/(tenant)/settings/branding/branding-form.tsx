'use client';

import { useState, useTransition } from 'react';
import type { CopySettings } from '@/lib/theme/copy';
import {
  PRESETS,
  resolveTokens,
  THEME_PRESETS,
  type ThemeSettings,
} from '@/lib/theme/theme';
import { saveBrandingAction } from './actions';

/**
 * Editing an institute's brand.
 *
 * The preview is rendered from resolveTokens, the same function that produces
 * the real stylesheet, so what an admin sees here is what the site will look
 * like rather than an approximation that drifts from it.
 */
export function BrandingForm({
  theme: initialTheme,
  copy: initialCopy,
  logoUrl: initialLogo,
}: {
  theme: ThemeSettings;
  copy: CopySettings;
  logoUrl: string | null;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [copy, setCopy] = useState(initialCopy);
  const [logoUrl, setLogoUrl] = useState(initialLogo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const tokens = resolveTokens(theme);

  function save() {
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
      setSaved(outcome.status === 'ok');
      setError(outcome.status === 'error' ? outcome.message : null);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-3 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Starting point</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {THEME_PRESETS.map((preset) => (
            <label
              key={preset}
              className="flex cursor-pointer flex-col gap-2 rounded-lg border p-3"
              style={{
                borderColor:
                  theme.preset === preset ? PRESETS[preset].primary : undefined,
              }}
            >
              <span className="flex items-center gap-2 text-sm capitalize">
                <input
                  type="radio"
                  name="preset"
                  checked={theme.preset === preset}
                  onChange={() =>
                    setTheme((current) => ({ ...current, preset }))
                  }
                />
                {preset}
              </span>
              <Swatches tokens={PRESETS[preset]} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Your colours</legend>
        <p className="text-muted-foreground text-sm">
          Leave a colour empty to use the preset&rsquo;s. Text colours are
          chosen for you from what you pick, so nothing ends up unreadable.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <ColorField
            label="Brand"
            help="Buttons and links"
            value={theme.brand}
            fallback={PRESETS[theme.preset].primary}
            onChange={(brand) => setTheme((current) => ({ ...current, brand }))}
          />
          <ColorField
            label="Accent"
            help="Highlights"
            value={theme.accent}
            fallback={PRESETS[theme.preset].accent}
            onChange={(accent) =>
              setTheme((current) => ({ ...current, accent }))
            }
          />
          <ColorField
            label="Page"
            help="Background"
            value={theme.background}
            fallback={PRESETS[theme.preset].background}
            onChange={(background) =>
              setTheme((current) => ({ ...current, background }))
            }
          />
        </div>

        <label className="flex max-w-xs flex-col gap-1 text-sm">
          Corner rounding
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.125}
            value={Number.parseFloat(
              (theme.radius ?? PRESETS[theme.preset].radius).replace('rem', ''),
            )}
            onChange={(event) =>
              setTheme((current) => ({
                ...current,
                radius: `${event.target.value}rem`,
              }))
            }
          />
        </label>
      </fieldset>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Preview</h2>
        <Preview tokens={tokens} copy={copy} logoUrl={logoUrl} />
      </section>

      <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Logo</legend>
        <label className="flex flex-col gap-1 text-sm">
          Address of your logo image
          <input
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            placeholder="https://example.edu/logo.svg"
            className="rounded-md border px-3 py-2"
          />
          <span className="text-muted-foreground text-xs">
            An https address. Leave it empty and your institute&rsquo;s name is
            shown in type instead.
          </span>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
        <legend className="px-1 text-sm font-medium">Your words</legend>
        <TextField
          label="Tagline"
          help="A short line above the headline"
          value={copy.tagline}
          onChange={(tagline) =>
            setCopy((current) => ({ ...current, tagline }))
          }
        />
        <TextField
          label="Headline"
          help="The first thing a visitor reads"
          value={copy.hero}
          onChange={(hero) => setCopy((current) => ({ ...current, hero }))}
        />
        <TextField
          label="About"
          help="A paragraph about the institute"
          rows={4}
          value={copy.about}
          onChange={(about) => setCopy((current) => ({ ...current, about }))}
        />
        <TextField
          label="Footer"
          help="Shown at the bottom of every page"
          value={copy.footer}
          onChange={(footer) => setCopy((current) => ({ ...current, footer }))}
        />
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 disabled:opacity-60"
        >
          {pending ? 'Saving...' : 'Save'}
        </button>
        {saved && !error && <span className="text-sm">Saved.</span>}
        {error && <span className="text-destructive text-sm">{error}</span>}
      </div>
    </div>
  );
}

function Swatches({ tokens }: { tokens: Record<string, string> }) {
  return (
    <span className="flex gap-1">
      {['background', 'primary', 'accent', 'border'].map((token) => (
        <span
          key={token}
          className="h-5 w-5 rounded-full border"
          style={{ backgroundColor: tokens[token] }}
        />
      ))}
    </span>
  );
}

function ColorField({
  label,
  help,
  value,
  fallback,
  onChange,
}: {
  label: string;
  help: string;
  value: string | null;
  fallback: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? fallback}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-12 rounded border"
        />
        <input
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || null)}
          placeholder={fallback}
          className="w-full rounded-md border px-2 py-1 font-mono text-xs"
        />
      </span>
      <span className="text-muted-foreground text-xs">{help}</span>
    </div>
  );
}

function TextField({
  label,
  help,
  value,
  rows,
  onChange,
}: {
  label: string;
  help: string;
  value: string | null;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {rows ? (
        <textarea
          rows={rows}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          className="rounded-md border px-3 py-2"
        />
      ) : (
        <input
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          className="rounded-md border px-3 py-2"
        />
      )}
      <span className="text-muted-foreground text-xs">{help}</span>
    </label>
  );
}

/**
 * A miniature of the institute's home page.
 *
 * Inline styles from the resolved tokens rather than the page's own classes,
 * because the point is to show a theme that is not the one currently applied
 * to the settings page itself.
 */
function Preview({
  tokens,
  copy,
  logoUrl,
}: {
  tokens: Record<string, string>;
  copy: CopySettings;
  logoUrl: string;
}) {
  return (
    <div
      className="overflow-hidden border"
      style={{
        backgroundColor: tokens.background,
        color: tokens.foreground,
        borderColor: tokens.border,
        borderRadius: tokens.radius,
      }}
    >
      <div
        className="flex items-center gap-3 border-b px-4 py-3"
        style={{ backgroundColor: tokens.card, borderColor: tokens.border }}
      >
        {logoUrl ? (
          // A preview of a remote logo the admin is still typing, which must
          // not be proxied through the optimizer or cached by it.
          // eslint-disable-next-line @next/next/no-img-element -- see above
          <img src={logoUrl} alt="" className="h-6 w-auto object-contain" />
        ) : (
          <span className="text-sm font-semibold">Your institute</span>
        )}
        <span
          className="ml-auto px-3 py-1 text-xs"
          style={{
            backgroundColor: tokens.primary,
            color: tokens['primary-foreground'],
            borderRadius: tokens.radius,
          }}
        >
          Sign in
        </span>
      </div>

      <div className="flex flex-col gap-2 px-4 py-6">
        <span className="text-xs" style={{ color: tokens['muted-foreground'] }}>
          {copy.tagline ?? 'Study at your own pace.'}
        </span>
        <span className="text-lg font-semibold">
          {copy.hero ?? 'Courses from your institute.'}
        </span>
        <span className="text-sm" style={{ color: tokens['muted-foreground'] }}>
          {copy.about ?? 'A paragraph about who you are and what you teach.'}
        </span>
        <span
          className="mt-2 w-fit px-3 py-1.5 text-xs"
          style={{
            backgroundColor: tokens.accent,
            color: tokens['accent-foreground'],
            borderRadius: tokens.radius,
          }}
        >
          Browse courses
        </span>
      </div>
    </div>
  );
}
