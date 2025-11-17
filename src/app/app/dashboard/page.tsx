"use client";

import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import DashboardMetrics from "@/components/mvp/dashboard/DashboardMetrics";
import { mockUsers } from "@/data/mock-users";
import {
  generateAvatarColor,
  getInitials,
  getStatusColor,
} from "@/data/avatar-utils";

export default function DashboardPage() {
  const [isClient, setIsClient] = useState(false);
  const totalConnections = mockUsers.length;
  const featuredConnections = mockUsers.slice(0, 8);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
      <div className="flex h-full flex-col overflow-hidden px-4 py-4 sm:px-5 md:px-6">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-4"
        >
          <h1 className="text-3xl font-semibold text-emerald-900 dark:text-emerald-200">
            Dashboard
          </h1>
        </motion.div>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col rounded-sm">
            <CardHeader className="pb-2.5">
              <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                Performance Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-visible">
              <DashboardMetrics totalConnections={totalConnections} />
            </CardContent>
          </Card>

          <Card className="flex flex-col rounded-sm">
            <CardHeader className="space-y-1 pb-3">
              <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                Connections Overview
              </CardTitle>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Showing {featuredConnections.length} of {totalConnections} total
                connections from your network.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 overflow-hidden">
              <div className="grid max-h-[28rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                {featuredConnections.map((user) => {
                  const avatarColors = generateAvatarColor(user.name);
                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between rounded-lg border border-zinc-100 bg-white px-3 py-2.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar
                          className={`h-10 w-10 ${user.avatar ? "" : `bg-linear-to-br ${avatarColors.from} ${avatarColors.to}`}`}
                        >
                          {user.avatar ? (
                            <img
                              src={user.avatar}
                              alt={user.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <AvatarFallback
                              className={`bg-transparent ${avatarColors.text} font-semibold`}
                            >
                              {getInitials(user.name)}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-50">
                            {user.name}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {user.profession} · {user.company}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="secondary"
                        className="flex items-center gap-1 text-xs font-medium"
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${getStatusColor(user.status)}`}
                        />
                        {user.status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
