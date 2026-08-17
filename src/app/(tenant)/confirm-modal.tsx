'use client';

import { Button, Modal } from 'rsuite';

/**
 * A destructive action behind an explicit yes/no (round 2, rsuite adoption
 * phase 2), replacing `window.confirm`: the two archive buttons
 * (`archive-course-button.tsx`, the lesson row in `lesson-list.tsx`) shared
 * an identical shape once the browser's own dialog was gone, so it is one
 * component rather than two copies of the same Modal wiring.
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Archive',
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} size="xs">
      <Modal.Header>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{body}</Modal.Body>
      <Modal.Footer>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          color="red"
          appearance="primary"
          onClick={onConfirm}
          loading={pending}
        >
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
