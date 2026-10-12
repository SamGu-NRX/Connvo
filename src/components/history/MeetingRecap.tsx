import { type RecapResult } from "@/lib/history/recap";

interface MeetingRecapProps {
  recap: RecapResult;
  className?: string;
}

/**
 * Renders the deterministic recap builder output. Purely presentational:
 * every list item is a verbatim line produced by src/lib/history/recap.ts,
 * so this component adds no content of its own.
 */
export function MeetingRecap({ recap, className }: MeetingRecapProps) {
  return (
    <section
      className={className}
      aria-labelledby="meeting-recap-heading"
      data-testid="meeting-recap"
    >
      <h2
        id="meeting-recap-heading"
        className="text-lg font-semibold text-emerald-900 dark:text-emerald-200"
      >
        Recap
      </h2>
      <div className="mt-3 space-y-4">
        {recap.sections.map((section) => (
          <section
            key={section.kind}
            aria-labelledby={`recap-section-${section.kind}`}
          >
            <h3
              id={`recap-section-${section.kind}`}
              className="text-sm font-medium text-emerald-900 dark:text-emerald-200"
            >
              {section.title}
            </h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
              {section.items.map((item, index) => (
                <li key={`${section.kind}-${index}`}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
