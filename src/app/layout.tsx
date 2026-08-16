import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lectern',
  description: 'Multi-tenant learning platform for bible institutes.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
