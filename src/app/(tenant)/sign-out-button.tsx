'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Signing out, which had no button anywhere.
 *
 * A shared machine in a church office is the normal case for this product, so
 * "how do I get out of this account" is not a power user's question. The
 * session cookie is host-only, so signing out here ends it at this institute
 * and leaves any session at another one alone, which is the same rule the rest
 * of the tenancy model follows.
 *
 * router.refresh after the redirect, because every gated page is server
 * rendered: without it the browser would happily show the cached signed-in
 * version of whatever page you were on.
 */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={className ?? 'text-sm hover:underline disabled:opacity-60'}
        onClick={() => {
          startTransition(async () => {
            // THE CONTENT TYPE IS NOT OPTIONAL, AND OMITTING IT FAILS QUIETLY.
            // Better Auth answers 415 to a POST without one. The first version
            // of this sent none and ignored the response, so the button
            // appeared to work, the page re-rendered as a signed-out visitor,
            // and the session was still live on the server. On a shared office
            // machine that is the whole point of the button, undone.
            const response = await fetch('/api/auth/sign-out', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            });

            if (!response.ok) {
              setFailed(true);
              return;
            }

            setFailed(false);
            router.push('/');
            router.refresh();
          });
        }}
      >
        {pending ? 'Signing out...' : 'Sign out'}
      </button>

      {failed && (
        <span className="text-destructive text-sm">
          Could not sign out. Close the browser to be certain.
        </span>
      )}
    </>
  );
}
