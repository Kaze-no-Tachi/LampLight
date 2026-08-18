'use client';

import { InputNumber } from 'rsuite';
import { FieldLabel } from './form-chrome';

/**
 * "How it is sold", the three-card control on mockups 7 and 9.
 *
 * Three cards rather than a price field and a checkbox, because the question
 * an institute is answering is which of three things this course is, and the
 * two-control version lets them describe a fourth thing that does not exist
 * (a program-only course with a price on it).
 *
 * WHAT THIS DOES AND DOES NOT DO. Checkout is not built. Setting a price here
 * decides what the catalogue says a course costs and nothing else, so the note
 * under the field says that rather than the mockup's line about charging once
 * on your own Stripe account, which would be a promise the app cannot keep
 * today. Confirmed with Jeremy before building it this way.
 */

export type SoldAs = 'standalone' | 'program' | 'free';

const OPTIONS: { key: SoldAs; label: string; note: string }[] = [
  {
    key: 'standalone',
    label: 'Sold on its own',
    note: 'Anybody can buy this one course, whether or not they take the rest.',
  },
  {
    key: 'program',
    label: 'Program only',
    note: 'Part of a program and not sold separately. No price of its own.',
  },
  {
    key: 'free',
    label: 'Free',
    note: 'Open to anybody who enrols. Nothing to pay.',
  },
];

/**
 * Reads the two stored columns back as one of the three choices.
 *
 * A course that is purchasable and priced at nothing is free, which is the one
 * case where the stored shape is ambiguous and the reading has to be decided
 * somewhere rather than in each screen.
 */
export function soldAsOf(course: {
  priceCents: number;
  isStandalonePurchasable: boolean;
}): SoldAs {
  if (!course.isStandalonePurchasable) return 'program';
  return course.priceCents > 0 ? 'standalone' : 'free';
}

export function PricingPicker({
  sold,
  onSold,
  priceDollars,
  onPriceDollars,
  note,
}: {
  sold: SoldAs;
  onSold: (next: SoldAs) => void;
  priceDollars: string;
  onPriceDollars: (next: string) => void;
  /** The one line that differs between creating a course and repricing one. */
  note: string;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <FieldLabel>How it is sold</FieldLabel>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        {OPTIONS.map((option) => {
          const picked = option.key === sold;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={picked}
              onClick={() => onSold(option.key)}
              className={`flex flex-1 cursor-pointer flex-col gap-1 rounded-(--radius) border px-3.5 py-[13px] text-left transition-colors ${
                picked
                  ? 'border-primary bg-accent'
                  : 'border-border hover:border-primary'
              }`}
            >
              <span className="text-(length:--text-ui) font-medium">
                {option.label}
              </span>
              <span className="text-muted-foreground text-(length:--text-meta) leading-[1.45]">
                {option.note}
              </span>
            </button>
          );
        })}
      </div>

      {sold === 'standalone' && (
        <label className="text-muted-foreground flex flex-wrap items-center gap-2.5 text-(length:--text-ui)">
          Price in USD
          <InputNumber
            value={priceDollars}
            onChange={(next) =>
              onPriceDollars(next === null ? '' : String(next))
            }
            min={0}
            step={1}
            prefix="$"
            style={{ width: 140 }}
            aria-label="Price in USD"
          />
          <span className="text-(length:--text-meta)">{note}</span>
        </label>
      )}
    </div>
  );
}
