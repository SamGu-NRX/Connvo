"use client";

import { useState } from "react";
import type { UserInfo } from "@/types/user";
import { cn } from "@/lib/utils";
import { ProfileAvatar } from "@/components/mvp/user-card/profile-avatar";
import { UserCardActions } from "@/components/mvp/user-card/user-card-actions";
import { MessageModal } from "@/components/mvp/user-card/message-modal";
import { ScheduleModal } from "@/components/mvp/user-card/schedule-modal";
import { Briefcase } from "lucide-react";

interface UserCardHeaderProps {
  user: UserInfo;
  inChat?: boolean;
  isSpeaking?: boolean;
  onMessage: (message: string) => void;
  onSchedule: (date: Date, duration: number, topic: string) => void;
  className?: string;
  showActions?: boolean;
}

export function UserCardHeader({
  user,
  inChat = false,
  isSpeaking = false,
  onMessage,
  onSchedule,
  className,
  showActions = true,
}: UserCardHeaderProps) {
  const { name, avatar, profession, company, isBot } = user;
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);

  const handleSendMessage = (message: string) => {
    if (message.trim()) {
      onMessage(message);
      setMessageModalOpen(false);
    }
  };

  const handleScheduleMeeting = (
    date: Date,
    duration: number,
    topic: string,
  ) => {
    onSchedule(date, duration, topic);
    setScheduleModalOpen(false);
  };

  return (
    <>
      {showActions && (
        <>
          <MessageModal
            isOpen={messageModalOpen}
            onClose={() => setMessageModalOpen(false)}
            name={name}
            avatar={avatar}
            onSend={handleSendMessage}
          />

          <ScheduleModal
            isOpen={scheduleModalOpen}
            onClose={() => setScheduleModalOpen(false)}
            name={name}
            avatar={avatar}
            onSchedule={handleScheduleMeeting}
          />
        </>
      )}

      <div
        className={cn(
          "flex items-center gap-4 p-5 pb-3",
          inChat && "p-4 pb-2",
          className,
        )}
      >
        <ProfileAvatar
          name={name}
          avatar={avatar}
          size={inChat ? "md" : "lg"}
          isBot={isBot}
          isSpeaking={isSpeaking}
          className="shrink-0"
        />

        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                "truncate font-semibold tracking-tight",
                inChat ? "text-base" : "text-lg",
              )}
            >
              {name}
            </h3>
            <p className="flex items-center truncate text-sm text-gray-500 dark:text-gray-400">
              <Briefcase className="mr-1 h-3 w-3 shrink-0 opacity-70" />
              <span className="truncate">{profession}</span>
              {company && (
                <>
                  <span className="mx-1 shrink-0">•</span>
                  <span className="truncate">{company}</span>
                </>
              )}
            </p>
          </div>

          {showActions && (
            <UserCardActions
              onOpenMessage={() => setMessageModalOpen(true)}
              onOpenSchedule={() => setScheduleModalOpen(true)}
              className="shrink-0"
            />
          )}
        </div>
      </div>
    </>
  );
}
