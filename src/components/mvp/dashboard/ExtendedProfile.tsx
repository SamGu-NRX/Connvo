"use client";

import type React from "react";
import { useState } from "react";
import { motion } from "motion/react";
import { Award, Briefcase, Globe, Link, LogOut, Mail, User } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";

const ExtendedProfile: React.FC = () => {
  const { user, loading: authLoading, isAuthenticated } = useWorkOSAuth();
  const convexUser = useQuery(
    api.users.queries.getCurrentUser,
    isAuthenticated ? {} : undefined
  );
  const profile = useQuery(
    api.profiles.queries.getCurrentUserProfile,
    isAuthenticated ? {} : undefined
  );

  const [showPersonalDetails, setShowPersonalDetails] = useState(true);

  const loading = authLoading || (isAuthenticated && convexUser === undefined);

  const handleSignOut = () => {
    window.location.href = "/api/auth/signout";
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="rounded-lg bg-white p-6 shadow-xs dark:bg-zinc-900">
          <Skeleton className="mb-4 h-6 w-32" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="rounded-lg bg-white p-6 text-center shadow-xs dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* User Info Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-lg bg-white p-6 shadow-xs dark:bg-zinc-900"
      >
        <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Account Information
        </h3>
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <div className="rounded-full bg-indigo-100 p-2 dark:bg-indigo-900/40">
              <User size={16} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Name</p>
              <p className="text-sm font-medium">
                {profile?.displayName || 
                 convexUser?.displayName || 
                 [user.firstName, user.lastName].filter(Boolean).join(" ") ||
                 "No name set"}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900/40">
              <Mail size={16} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Email</p>
              <p className="text-sm font-medium">{user.email}</p>
            </div>
          </div>
          {profile?.jobTitle && (
            <div className="flex items-center space-x-3">
              <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/40">
                <Briefcase size={16} className="text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Job Title</p>
                <p className="text-sm font-medium">{profile.jobTitle}</p>
              </div>
            </div>
          )}
          {profile?.company && (
            <div className="flex items-center space-x-3">
              <div className="rounded-full bg-purple-100 p-2 dark:bg-purple-900/40">
                <Briefcase size={16} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Company</p>
                <p className="text-sm font-medium">{profile.company}</p>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Bio Section */}
      {profile?.bio && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-lg bg-white p-6 shadow-xs dark:bg-zinc-900"
        >
          <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            About
          </h3>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{profile.bio}</p>
        </motion.div>
      )}

      {/* Goals Section */}
      {profile?.goals && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="rounded-lg bg-white p-6 shadow-xs dark:bg-zinc-900"
        >
          <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Goals
          </h3>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">{profile.goals}</p>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Languages Section */}
        {profile?.languages && profile.languages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="rounded-lg bg-white p-4 shadow-xs dark:bg-zinc-900"
          >
            <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Languages
            </h3>
            <div className="flex flex-wrap gap-2">
              {profile.languages.map((language, index) => (
                <span
                  key={index}
                  className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {language}
                </span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Field/Experience Section */}
        {(profile?.field || profile?.experience) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.25 }}
            className="rounded-lg bg-white p-4 shadow-xs dark:bg-zinc-900"
          >
            <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Professional Background
            </h3>
            <div className="space-y-2">
              {profile.field && (
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Field</p>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {profile.field}
                  </p>
                </div>
              )}
              {profile.experience && (
                <div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Experience</p>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {profile.experience}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Privacy Settings */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
        className="rounded-lg bg-white p-4 shadow-xs dark:bg-zinc-900"
      >
        <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          Privacy
        </h3>
        <div className="flex items-center justify-between">
          <span className="text-sm">Show personal details to matches</span>
          <Switch
            checked={showPersonalDetails}
            onCheckedChange={setShowPersonalDetails}
          />
        </div>
      </motion.div>

      {/* External Links */}
      {profile?.linkedinUrl && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.35 }}
          className="rounded-lg bg-white p-4 shadow-xs dark:bg-zinc-900"
        >
          <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            External Links
          </h3>
          <div className="space-y-3">
            <div className="flex items-center">
              <Link size={16} className="mr-3 text-zinc-400" />
              <a
                href={profile.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
              >
                LinkedIn Profile
              </a>
            </div>
          </div>
        </motion.div>
      )}

      {/* Sign Out Button */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        className="pt-4"
      >
        <Button
          onClick={handleSignOut}
          variant="destructive"
          className="w-full"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </motion.div>
    </div>
  );
};

export default ExtendedProfile;
