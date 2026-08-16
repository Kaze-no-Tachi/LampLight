export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Lamplight</h1>
      <p className="text-muted-foreground">
        Foundation phase. Tenant resolution, auth, and the catalog arrive in
        later phases. See docs/adr for the decisions this build rests on.
      </p>
    </main>
  );
}
