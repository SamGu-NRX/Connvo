"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { User } from "@/types/meeting";
import { Clock, Star, Users } from "lucide-react";

interface UserCardProps {
  user: User;
}

export function UserCard({ user }: UserCardProps) {
  return (
    <Card className="border-none bg-zinc-800/30 shadow-lg">
      <CardContent className="p-3">
        <div className="mb-3 flex items-center space-x-3">
          <Avatar className="h-10 w-10 ring-2 ring-blue-500/50">
            <AvatarImage src={user.avatar} />
            <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="text-sm font-medium text-zinc-200">{user.name}</h3>
            <p className="text-xs text-zinc-400">
              {user.role} • {user.company}
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-zinc-400">Meeting Stats</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex items-center space-x-1.5">
                <Users className="h-3 w-3 text-blue-400" />
                <span className="text-xs text-zinc-300">
                  {user.meetingStats.totalMeetings}
                </span>
              </div>
              <div className="flex items-center space-x-1.5">
                <Clock className="h-3 w-3 text-blue-400" />
                <span className="text-xs text-zinc-300">
                  {Math.round(user.meetingStats.totalMinutes / 60)}h
                </span>
              </div>
              <div className="flex items-center space-x-1.5">
                <Star className="h-3 w-3 text-blue-400" />
                <span className="text-xs text-zinc-300">
                  {user.meetingStats.averageRating}
                </span>
              </div>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-400">Interests</p>
            <div className="flex flex-wrap gap-1">
              {user.interests.map((interest) => (
                <Badge
                  key={interest}
                  variant="secondary"
                  className="bg-blue-500/10 px-2 py-0 text-xs text-blue-400"
                >
                  {interest}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
