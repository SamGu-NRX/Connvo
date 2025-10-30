import { cn } from "@/lib/utils";
import type { ConnectionType } from "@/components/mvp/user-card/connection-badge";
import { ExperienceBadge } from "@/components/mvp/user-card/experience-badge";
import { ConnectionBadge } from "@/components/mvp/user-card/connection-badge";

interface UserCardTagsProps {
  connectionType: ConnectionType;
  experience: number;
  inChat?: boolean;
  className?: string;
}

export function UserCardTags({
  connectionType,
  experience,
  inChat = false,
  className,
}: UserCardTagsProps) {
  // Safety check: ensure we have valid data before rendering
  if (!connectionType && experience === undefined) {
    return null;
  }

  return (
    <div className={cn("mb-3 px-5", inChat && "px-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {experience !== undefined && <ExperienceBadge years={experience} />}
        {connectionType && <ConnectionBadge type={connectionType} />}
      </div>
    </div>
  );
}
