"use client";

/**
 * DEV-ONLY preview route — /dev/notes-preview (M3 of connvo-notes-ledger-f1).
 *
 * Mounts MeetingNotesPanel against an in-memory demo backend with fault
 * toggles (offline / drop-ack / slow network / remote edit). It exists for
 * screenshots and manual verification only; functional proof lives in the
 * test/in-call suites. Not linked from any product surface.
 *
 * NOTE: the panel renders against the real ledger hook, which lands with the
 * ledger milestone (M2, docs/notes-ledger-f1/design.md §3). Until that join,
 * this route surfaces the hook's placeholder error — expected and honest.
 */

import { useState } from "react";
import { NotesTransportProvider } from "@/hooks/notes";
import { Id } from "@convex/_generated/dataModel";
import { MeetingNotesPanel } from "@/components/meeting-notes/MeetingNotesPanel";
import {
  createDemoNotesBackend,
  DEMO_SEED_CONTENT,
} from "@/components/meeting-notes/meeting-notes.demo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const DEMO_MEETING_ID = "demo-meeting" as Id<"meetings">;
const SLOW_NETWORK_MS = 1200;

function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <Label
        htmlFor={id}
        className="flex flex-col items-start gap-1 text-sm font-normal"
      >
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export default function NotesPreviewPage() {
  const [backend] = useState(() => createDemoNotesBackend());
  const [offline, setOffline] = useState(false);
  const [dropAck, setDropAck] = useState(false);
  const [slowNetwork, setSlowNetwork] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Notes panel preview</h1>
        <p
          data-testid="demo-backend-label"
          className="text-sm font-medium text-amber-600 dark:text-amber-400"
        >
          Demo backend, in-memory — not production
        </p>
        <p className="text-sm text-muted-foreground">
          Type in the notes below, then flip the fault switches to drive real
          sync states through the real hook contract.
        </p>
      </header>

      <section
        aria-label="Demo fault controls"
        className="rounded-md border border-border bg-muted/40 p-4"
      >
        <div className="divide-y divide-border">
          <ToggleRow
            id="demo-offline"
            label="Offline"
            description="Batches fail and snapshots stop — offline typing still queues."
            checked={offline}
            onCheckedChange={(checked) => {
              setOffline(checked);
              backend.controls.setOffline(checked);
            }}
          />
          <ToggleRow
            id="demo-drop-ack"
            label="Drop acknowledgements"
            description="The server applies a batch but the response is lost — edits stay visibly unconfirmed until the next fresh read."
            checked={dropAck}
            onCheckedChange={(checked) => {
              setDropAck(checked);
              backend.controls.setDropAck(checked);
            }}
          />
          <ToggleRow
            id="demo-slow-network"
            label={`Slow network (${SLOW_NETWORK_MS / 1000} s)`}
            description="Delays every batch response — the panel shows Saving while in flight."
            checked={slowNetwork}
            onCheckedChange={(checked) => {
              setSlowNetwork(checked);
              backend.controls.setSlowNetwork(checked ? SLOW_NETWORK_MS : null);
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => backend.controls.simulateRemoteEdit(DEMO_SEED_CONTENT)}
          >
            Simulate remote edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOffline(false);
              setDropAck(false);
              setSlowNetwork(false);
              backend.controls.reset();
            }}
          >
            Reset demo
          </Button>
        </div>
      </section>

      <NotesTransportProvider transport={backend.transport}>
        <MeetingNotesPanel meetingId={DEMO_MEETING_ID} />
      </NotesTransportProvider>
    </div>
  );
}
