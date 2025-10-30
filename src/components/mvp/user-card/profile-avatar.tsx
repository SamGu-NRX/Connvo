"use client";

import { motion } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { generateAvatarColor, getInitials } from "@/lib/avatar-utils";

export interface ProfileAvatarProps {
  name: string;
  avatar: string | null;
  size?: "sm" | "md" | "lg";
  isBot?: boolean;
  isSpeaking?: boolean;
  className?: string;
  showAnimation?: boolean;
  onClick?: () => void;
}

export function ProfileAvatar({
  name,
  avatar,
  size = "md",
  isBot = false,
  isSpeaking = false,
  className,
  showAnimation = true,
  onClick,
}: ProfileAvatarProps) {
  const avatarColors = generateAvatarColor(avatar || name);
  const shouldShowGradient = !avatar || isBot;

  const sizeClasses = {
    sm: "h-10 w-10",
    md: "h-12 w-12",
    lg: "h-16 w-16",
  };

  const AvatarWrapper = showAnimation ? motion.div : "div";
  const animationProps = showAnimation
    ? {
        whileHover: { scale: 1.05 },
      }
    : {};

  return (
    <AvatarWrapper className="relative" {...animationProps} onClick={onClick}>
      <Avatar
        className={cn(
          sizeClasses[size],
          "shadow-lg",
          shouldShowGradient
            ? `bg-gradient-to-br ${avatarColors.from} ${avatarColors.to}`
            : "",
          isSpeaking && "ring-primary ring-2 ring-offset-2",
          onClick && "cursor-pointer",
          className,
        )}
      >
        {avatar && !isBot ? (
          <AvatarImage src={avatar} alt={name} />
        ) : (
          <AvatarFallback
            className={`bg-transparent ${avatarColors.text} font-semibold`}
          >
            {getInitials(name)}
          </AvatarFallback>
        )}
      </Avatar>
    </AvatarWrapper>
  );
}
