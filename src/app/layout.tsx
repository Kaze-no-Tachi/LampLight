import type { Metadata } from 'next';
import { Karla, Spectral } from 'next/font/google';
import './globals.css';

/**
 * The platform's two typefaces, self-hosted by next/font at build time.
 *
 * Deliberately not a per-tenant setting. Type is the one part of the look an
 * institute cannot change, for the same reason the theme is a token allow-list
 * rather than a CSS field (src/lib/theme/theme.ts): a font is a request to a
 * third party, and a font *field* is an arbitrary URL loaded on a page served
 * before anyone signs in. If per-tenant type is ever wanted it belongs as a
 * two- or three-option preset, chosen from here.
 *
 * Loaded as variables rather than className so the tokens can be referenced
 * from globals.css and composed by Tailwind's font-serif / font-sans.
 */
const spectral = Spectral({
  subsets: ['latin'],
  weight: ['400', '600'],
  style: ['normal', 'italic'],
  variable: '--font-spectral',
  display: 'swap',
});

const karla = Karla({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-karla',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Lamplight',
  description: 'Multi-tenant learning platform for bible institutes.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${spectral.variable} ${karla.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
