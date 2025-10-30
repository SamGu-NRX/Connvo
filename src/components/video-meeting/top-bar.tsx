"use client";

import { motion } from "motion/react";
import { Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { User } from "@/types/meeting";
import { TimeDisplay } from "./time-display";

interface TopBarProps {
  partner: User;
  timeElapsed: number;
  timeRemaining: number;
  showTimeLeft: boolean;
  isAlmostOutOfTime: boolean;
  isSidebarOpen: boolean;
  onToggleTimeDisplay: () => void;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  theme?: "light" | "dark";
}

export function TopBar({
  partner,
  timeElapsed,
  timeRemaining,
  showTimeLeft,
  isAlmostOutOfTime,
  isSidebarOpen,
  onToggleTimeDisplay,
  onToggleSidebar,
  onOpenSettings,
  theme = "dark",
}: TopBarProps) {
  return (
    <motion.div className={`z-10 flex h-16 items-center justify-between border-b px-6 backdrop-blur-lg ${
      theme === "dark"
        ? "border-zinc-800 bg-zinc-900/80"
        : "border-zinc-200 bg-white/80"
    }`}>
      <div className="flex items-center space-x-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          className={`h-8 w-8 rounded-full ${theme === "dark" ? "hover:bg-zinc-800/50" : "hover:bg-zinc-100/50"}`}
        >
          {isSidebarOpen ? (
            <PanelLeftClose className={`h-5 w-5 ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`} />
          ) : (
            <PanelLeftOpen className={`h-5 w-5 ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`} />
          )}
        </Button>
        <div>
          <h3 className={`text-sm font-medium ${theme === "dark" ? "text-zinc-200" : "text-zinc-800"}`}>
            Meeting with {partner.name}
          </h3>
          <p className={`text-xs ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`}>1-on-1 discussion</p>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <TimeDisplay
          showTimeLeft={showTimeLeft}
          timeElapsed={timeElapsed}
          timeRemaining={timeRemaining}
          isAlmostOutOfTime={isAlmostOutOfTime}
          onToggleTimeDisplay={onToggleTimeDisplay}
          theme={theme}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          className={`h-8 w-8 rounded-full ${theme === "dark" ? "hover:bg-zinc-800/50" : "hover:bg-zinc-100/50"}`}
        >
          <Settings className={`h-4 w-4 ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`} />
        </Button>
      </div>
    </motion.div>
  );
}
