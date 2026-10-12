"use client";

import { notFound } from "next/navigation";
import { MeetingList } from "@/components/history/MeetingList";
import { isAfterCallEnabled } from "@/lib/featureFlags";

export default function MeetingsPage() {
  if (!isAfterCallEnabled()) notFound();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-2">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <p className="text-muted-foreground text-sm">
          The meetings you took part in, newest first, with what each one
          recorded.
        </p>
      </header>
      <MeetingList />
    </main>
  );
}
