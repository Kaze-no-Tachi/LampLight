'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Input, SelectPicker } from 'rsuite';
import { toSlug } from '@/lib/catalog/slug';
import { createCourseAction } from '../../catalog-actions';
import { FieldLabel, FormCard } from '../../form-chrome';
import { PricingPicker, type SoldAs } from '../../pricing-picker';
import { TagPicker } from '../../tag-picker';

/**
 * Everything a course needs to exist, on one screen (mockup 7).
 *
 * THE ADDRESS IS SHOWN, NOT ASKED FOR. The mockup has no slug field, only the
 * line under the title reading back what the address will be. That is right
 * for almost everybody and wrong for the institute migrating from a site whose
 * links they want to keep, so the line carries a way in: it is derived until
 * somebody says otherwise, and stays whatever they typed after that. The old
 * inline form had a plain second input, which asked every institute a question
 * that only one of them has.
 *
 * Creating lands in the course's own settings, not back on the list, which is
 * the round 2 decision and is still the only useful destination: a course that
 * exists and has no lessons has exactly one next step.
 */
export function NewCourse({
  host,
  tags,
  staff,
}: {
  host: string;
  tags: string[];
  staff: { userId: string; name: string; email: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [chosenTags, setChosenTags] = useState<string[]>([]);
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [sold, setSold] = useState<SoldAs>('free');
  const [price, setPrice] = useState('');

  const address = slug ?? toSlug(title);

  function create() {
    const data = new FormData();
    data.set('title', title);
    // Sent only when somebody set it by hand. Left out, the server derives the
    // same thing this line is showing.
    if (slug !== null) data.set('slug', slug);
    data.set('description', description);
    for (const tag of chosenTags) data.append('tags', tag);
    if (instructorId) data.set('instructorId', instructorId);
    data.set('sold', sold);
    data.set('price', price);

    startTransition(async () => {
      const result = await createCourseAction(data);
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      setError(null);
      router.push(`/teach/courses/${result.courseId}`);
    });
  }

  return (
    <div className="flex max-w-[780px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/teach"
          className="text-muted-foreground w-fit text-(length:--text-label) font-medium underline-offset-4 hover:underline"
        >
          Teaching
        </Link>
        <h1 className="text-(length:--text-staff-page) leading-[1.2]">
          New course
        </h1>
        <p className="text-muted-foreground max-w-[66ch] text-(length:--text-ui) leading-[1.6]">
          Nothing is on your public catalogue until you publish it, so you can
          build it in the open.
        </p>
      </div>

      <FormCard>
        <label className="flex flex-col gap-[7px]">
          <FieldLabel>Title</FieldLabel>
          <Input
            value={title}
            onChange={(next: string) => setTitle(next)}
            placeholder="The Minor Prophets"
            size="lg"
          />
          <span className="text-muted-foreground font-mono text-(length:--text-meta)">
            {host}/catalogue/{address || '...'}
            {slug === null ? (
              <button
                type="button"
                onClick={() => setSlug(address)}
                className="ml-2.5 cursor-pointer font-sans underline underline-offset-[3px]"
              >
                Set the address yourself
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSlug(null)}
                className="ml-2.5 cursor-pointer font-sans underline underline-offset-[3px]"
              >
                Take it from the title again
              </button>
            )}
          </span>
          {slug !== null && (
            <Input
              value={slug}
              onChange={(next: string) => setSlug(toSlug(next))}
              placeholder="the-minor-prophets"
              aria-label="Web address"
            />
          )}
        </label>

        <TagPicker
          value={chosenTags}
          onChange={setChosenTags}
          suggestions={tags}
          emptyNote="Pick from what this institute already uses, or type your own."
        />

        <label className="flex flex-col gap-[7px]">
          <FieldLabel>Who teaches it</FieldLabel>
          <SelectPicker
            data={staff.map((person) => ({
              value: person.userId,
              label: `${person.name} (${person.email})`,
            }))}
            value={instructorId}
            onChange={(next: string | null) => setInstructorId(next)}
            // Nobody is a real answer: an unassigned course can still be
            // edited by an admin, and an institute of one has no separate
            // instructor to name.
            placeholder="Nobody yet"
            searchable={staff.length > 8}
            block
          />
        </label>

        <label className="flex flex-col gap-[7px]">
          <FieldLabel>What a visitor reads in the catalogue</FieldLabel>
          <Input
            as="textarea"
            rows={4}
            value={description}
            onChange={(next: string) => setDescription(next)}
            placeholder="Two or three sentences. What the course covers, and who it is for."
          />
        </label>

        <PricingPicker
          sold={sold}
          onSold={setSold}
          priceDollars={price}
          onPriceDollars={setPrice}
          note="Shown on your catalogue. Taking payment is not switched on yet."
        />

        <div className="border-border flex flex-wrap items-center gap-3.5 border-t pt-[18px]">
          <button
            type="button"
            disabled={pending}
            onClick={create}
            className="bg-primary text-primary-foreground cursor-pointer rounded-(--radius) px-[17px] py-[11px] text-(length:--text-ui) font-medium disabled:opacity-60"
          >
            {pending ? 'Creating' : 'Create course'}
          </button>
          <Link
            href="/teach"
            className="text-muted-foreground text-(length:--text-label) font-medium underline-offset-4 hover:underline"
          >
            Cancel
          </Link>
          {error && (
            <span
              role="status"
              className="text-destructive text-(length:--text-label)"
            >
              {error}
            </span>
          )}
        </div>
      </FormCard>
    </div>
  );
}
