"use client";

/**
 * Matching-preferences editor (cv6-profile-availability-ui): conversation
 * goals, timezone, weekly free-time grid and chat cadence. Controlled: the
 * surface that renders it (onboarding step, settings card) owns the value
 * and decides when to save. The grid is the client-side availability shape
 * from src/lib/availability/schedule.ts; replaceAvailability takes blocks.
 */

import { useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Eraser, Utensils, MoonStar } from "lucide-react";
import {
  BLOCK_STEP,
  DAYS_PER_WEEK,
  SLOTS_PER_DAY,
  blocksToGrid,
  detectedTimeZone,
  gridMinutes,
  isValidTimeZone,
  type AvailabilityGrid,
} from "@/lib/availability/schedule";

export const INTENTS = [
  "find_mentor",
  "mentor",
  "peers",
  "explore_field",
  "collaborate",
  "hiring",
  "job_seeking",
] as const;

export type Intent = (typeof INTENTS)[number];

export const INTENT_LABELS: Record<Intent, string> = {
  find_mentor: "Find a mentor",
  mentor: "Be a mentor",
  peers: "Meet peers",
  explore_field: "Explore my field",
  collaborate: "Collaborate on a project",
  hiring: "Hiring",
  job_seeking: "Job seeking",
};

export type ChatsPerWeek = 0 | 1 | 2;

export type AvailabilityValue = {
  intents: Intent[];
  timezone: string;
  chatsPerWeek: ChatsPerWeek;
  grid: AvailabilityGrid;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minuteLabel(slot: number): string | null {
  if (slot % 4 !== 0) return null; // a label every two hours
  const h = Math.floor((slot * BLOCK_STEP) / 60);
  return `${String(h).padStart(2, "0")}:00`;
}

/** Every cell's clock time ("09:30"), so each cell can be named. */
function slotTimeLabel(slot: number): string {
  const minutes = slot * BLOCK_STEP;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function labelForZone(zone: string): string {
  const offset = zoneOffsetLabel(zone);
  return `${zone.replace(/_/g, " ")}${offset ? ` (UTC${offset})` : ""}`;
}

function zoneOffsetLabel(zone: string): string {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return tz.replace(/^GMT/, "");
  } catch {
    return "";
  }
}

const ALL_ZONES = (
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : []
).filter((z) => isValidTimeZone(z));

function PresetButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-1.5 rounded-full text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** Adds one preset's slots to the grid (Mon–Fri, inclusive of end half hour). */
function applyWeekdayRange(
  grid: AvailabilityGrid,
  startMinute: number,
  endMinute: number,
): AvailabilityGrid {
  const next = grid.map((day) => [...day]);
  for (let weekday = 1; weekday <= 5; weekday++) {
    for (
      let minute = startMinute;
      minute < endMinute;
      minute += BLOCK_STEP
    ) {
      next[weekday][Math.floor(minute / BLOCK_STEP)] = true;
    }
  }
  return next;
}

export function AvailabilityEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: AvailabilityValue;
  onChange: (next: AvailabilityValue) => void;
  disabled?: boolean;
}) {
  const painting = useRef<boolean | null>(null);
  const [zoneOpen, setZoneOpen] = useState(false);

  const timezones = useMemo(
    () => (ALL_ZONES.length > 0 ? ALL_ZONES : [value.timezone]),
    [value.timezone],
  );

  const toggleIntent = (intent: Intent) => {
    const picked = value.intents.includes(intent);
    if (!picked && value.intents.length >= 3) return; // at most three
    onChange({
      ...value,
      intents: picked
        ? value.intents.filter((i) => i !== intent)
        : [...value.intents, intent],
    });
  };

  const setSlot = (weekday: number, slot: number, paint: boolean) => {
    if (value.grid[weekday][slot] === paint) return;
    const next = value.grid.map((day) => [...day]);
    next[weekday][slot] = paint;
    onChange({ ...value, grid: next });
  };

  const onCellPointerDown = (weekday: number, slot: number) => {
    if (disabled) return;
    const paint = !value.grid[weekday][slot];
    painting.current = paint;
    setSlot(weekday, slot, paint);
  };

  const onCellPointerEnter = (weekday: number, slot: number) => {
    if (disabled || painting.current === null) return;
    setSlot(weekday, slot, painting.current);
  };

  const endPaint = () => {
    painting.current = null;
  };

  const hours = Math.round((gridMinutes(value.grid) / 60) * 10) / 10;

  return (
    <div className="flex flex-col gap-6" onPointerUp={endPaint} onPointerLeave={endPaint}>
      {/* Goals */}
      <div className="flex flex-col gap-2">
        <Label>What do you want from conversations?</Label>
        <p className="text-muted-foreground text-xs">
          Pick up to three. We use these to find your people.
        </p>
        <div className="flex flex-wrap gap-2">
          {INTENTS.map((intent) => {
            const picked = value.intents.includes(intent);
            const full = !picked && value.intents.length >= 3;
            return (
              <button
                key={intent}
                type="button"
                disabled={disabled || full}
                aria-pressed={picked}
                onClick={() => toggleIntent(intent)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  picked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:border-primary/50",
                  full && "cursor-not-allowed opacity-40",
                )}
              >
                {INTENT_LABELS[intent]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Timezone */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone-combobox">Timezone</Label>
        <p className="text-muted-foreground text-xs">
          Detected from your browser — change it if you&apos;ll usually be
          somewhere else.
        </p>
        <Popover open={zoneOpen} onOpenChange={setZoneOpen}>
          <PopoverTrigger asChild>
            <Button
              id="timezone-combobox"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={zoneOpen}
              disabled={disabled}
              className="w-full justify-between font-normal sm:w-96"
            >
              <span className="truncate">{labelForZone(value.timezone)}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[340px] p-0 sm:w-96" align="start">
            <Command>
              <CommandInput placeholder="Search timezones…" />
              <CommandList className="max-h-60">
                <CommandEmpty>No timezone found.</CommandEmpty>
                <CommandGroup>
                  {timezones.map((zone) => (
                    <CommandItem
                      key={zone}
                      value={`${zone} ${labelForZone(zone)}`}
                      onSelect={() => {
                        onChange({ ...value, timezone: zone });
                        setZoneOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          zone === value.timezone ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {labelForZone(zone)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Weekly grid */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Weekly free time</Label>
          <span className="text-muted-foreground text-xs" data-testid="availability-hours">
            {hours} {hours === 1 ? "hour" : "hours"} a week
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          Drag to mark when you&apos;re usually free, in 30-minute blocks.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <PresetButton
            onClick={() =>
              onChange({ ...value, grid: applyWeekdayRange(value.grid, 12 * 60, 13 * 60) })
            }
          >
            <Utensils className="h-3.5 w-3.5" /> Weekday lunches
          </PresetButton>
          <PresetButton
            onClick={() =>
              onChange({ ...value, grid: applyWeekdayRange(value.grid, 18 * 60, 21 * 60) })
            }
          >
            <MoonStar className="h-3.5 w-3.5" /> Weekday evenings
          </PresetButton>
          <PresetButton onClick={() => onChange({ ...value, grid: blocksToGrid([]) })}>
            <Eraser className="h-3.5 w-3.5" /> Clear
          </PresetButton>
        </div>
        <div className="bg-muted/30 overflow-x-auto rounded-lg border p-2">
          <div className="min-w-[680px] select-none">
            <div className="flex">
              <div className="w-10 shrink-0" />
              {/* Same gap-[2px] as the day rows below: without it each label
                  drifted 2px per half-hour cell and sat ~2h off by day's end.
                  Hidden from the accessibility tree — the cells carry the
                  names ("Mon 09:30"); these are visual hints only. */}
              <div className="flex flex-1 gap-[2px]" aria-hidden="true">
                {Array.from({ length: SLOTS_PER_DAY }, (_, slot) => (
                  <div
                    key={slot}
                    className="text-muted-foreground w-[13px] shrink-0 text-left text-[9px] leading-4 sm:w-[15px]"
                  >
                    {minuteLabel(slot)}
                  </div>
                ))}
              </div>
            </div>
            {Array.from({ length: DAYS_PER_WEEK }, (_, weekday) => (
              <div key={weekday} className="flex items-center">
                <button
                  type="button"
                  className={cn(
                    "text-muted-foreground hover:text-foreground w-10 shrink-0 rounded text-left text-xs font-medium",
                    disabled && "pointer-events-none",
                  )}
                  title="Toggle the whole day"
                  onClick={() => {
                    const dayFull = value.grid[weekday].every(Boolean);
                    const next = value.grid.map((day) => [...day]);
                    next[weekday] = next[weekday].map(() => !dayFull);
                    onChange({ ...value, grid: next });
                  }}
                >
                  {WEEKDAYS[weekday]}
                </button>
                <div className="flex flex-1 gap-[2px] py-[2px]">
                  {value.grid[weekday].map((on, slot) => (
                    <button
                      key={slot}
                      type="button"
                      tabIndex={-1}
                      aria-label={`${WEEKDAYS[weekday]} ${slotTimeLabel(slot)}`}
                      disabled={disabled}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        onCellPointerDown(weekday, slot);
                      }}
                      onPointerEnter={() => onCellPointerEnter(weekday, slot)}
                      className={cn(
                        "h-6 w-[13px] shrink-0 rounded-[3px] sm:w-[15px]",
                        on ? "bg-primary" : "bg-primary/10 hover:bg-primary/25",
                      )}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cadence */}
      <div className="flex flex-col gap-2">
        <Label>Chats per week</Label>
        <p className="text-muted-foreground text-xs">
          How often you&apos;d like to be matched. Paused stops new matches.
        </p>
        <div className="inline-flex w-fit overflow-hidden rounded-lg border">
          {(
            [
              [0, "Paused"],
              [1, "1 a week"],
              [2, "2 a week"],
            ] as Array<[ChatsPerWeek, string]>
          ).map(([count, label]) => (
            <button
              key={count}
              type="button"
              disabled={disabled}
              aria-pressed={value.chatsPerWeek === count}
              onClick={() => onChange({ ...value, chatsPerWeek: count })}
              className={cn(
                "px-4 py-2 text-sm transition-colors",
                value.chatsPerWeek === count
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function defaultTimezone(): string {
  return detectedTimeZone() ?? "UTC";
}
