"use client";

/**
 * Your network (docs/plan/MATCHING-PLAN.md, step 5): the people you actually
 * met and both chose to keep. Every connection comes from a real meeting
 * where both people tapped Connect — nothing here is mock data. Each entry
 * shows who the person is, what you share, and how you met, linked to the
 * meeting's recap.
 */
import Link from "next/link";
import { useQuery } from "convex/react";
import { format } from "date-fns";
import { api } from "@convex/_generated/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SIGNED_OUT_MESSAGE,
  useHistoryAuth,
} from "@/components/history/useHistoryAuth";

/** Deterministic avatar tint from the name, so the server and client agree. */
const AVATAR_TINTS = [
  "from-emerald-400 to-teal-500",
  "from-sky-400 to-indigo-500",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-500",
  "from-violet-400 to-purple-500",
] as const;

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

export default function DashboardPage() {
  const auth = useHistoryAuth();
  const connections = useQuery(
    api.network.queries.listMyConnections,
    auth === "ready" ? {} : "skip",
  );

  if (auth === "signed-out") {
    return (
      <p className="text-muted-foreground mx-auto max-w-6xl px-4 py-4 text-sm sm:px-5 md:px-6">
        {SIGNED_OUT_MESSAGE}
      </p>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
      <div className="flex h-full flex-col overflow-y-auto px-4 py-4 sm:px-5 md:px-6">
        <header className="mb-4">
          <h1 className="text-3xl font-semibold text-emerald-900 dark:text-emerald-200">
            Your network
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            People from your coffee chats who you both wanted to keep.
          </p>
        </header>

        {connections === undefined ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <span className="sr-only">Loading your network…</span>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : connections.length === 0 ? (
          <Card className="rounded-sm">
            <CardContent className="flex flex-col items-start gap-3 py-8">
              <p className="font-medium text-emerald-900 dark:text-emerald-100">
                No connections yet
              </p>
              <p className="text-muted-foreground max-w-md text-sm">
                After a chat, tap Connect on the ended call or the recap. When
                you both do, the person shows up here.
              </p>
              <Button asChild className="mt-1">
                <Link href="/app/match-queue">Find someone to talk to</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul data-testid="network-list" className="flex flex-col gap-3">
            {connections.map((person) => (
              <li key={person.userId}>
                <Card className="rounded-lg py-0">
                  <CardContent className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-11 w-11">
                        <AvatarFallback
                          className={`bg-linear-to-br font-semibold text-white ${tintFor(person.name ?? "Connvo")}`}
                        >
                          {initialsFor(person.name ?? "Connvo")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-emerald-900 dark:text-emerald-50">
                          {person.name ?? "Connvo member"}
                        </p>
                        {person.jobTitle || person.company ? (
                          <p className="text-muted-foreground truncate text-xs">
                            {[person.jobTitle, person.company]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                        {person.sharedInterests.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {person.sharedInterests.map((interest) => (
                              <Badge
                                key={interest}
                                variant="secondary"
                                className="text-[11px] font-normal"
                              >
                                {interest}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <p className="text-muted-foreground text-xs">
                        Met via coffee chat
                        {person.metAt
                          ? ` · ${format(new Date(person.metAt), "MMM d, yyyy")}`
                          : ""}
                      </p>
                      {person.meetingId ? (
                        <Link
                          href={`/app/meetings/${person.meetingId}`}
                          className="text-primary text-sm underline-offset-4 hover:underline"
                        >
                          View recap
                        </Link>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
