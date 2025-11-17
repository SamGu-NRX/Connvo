"use client";

import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function SettingsPage() {
  const { isAuthenticated, loading: authLoading } = useWorkOSAuth();
  const settings = useQuery(
    api.settings.queries.getCurrentUserSettings,
    isAuthenticated ? {} : undefined
  );
  const updateSettings = useMutation(api.settings.mutations.updateSettings);
  
  // Local state for optimistic updates
  const [localSettings, setLocalSettings] = useState({
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
    profileVisibility: true,
    dataSharing: false,
    activityTracking: true,
  });
  
  // Sync with backend when settings load
  useEffect(() => {
    if (settings) {
      setLocalSettings({
        emailNotifications: settings.emailNotifications,
        pushNotifications: settings.pushNotifications,
        smsNotifications: settings.smsNotifications,
        profileVisibility: settings.profileVisibility,
        dataSharing: settings.dataSharing,
        activityTracking: settings.activityTracking,
      });
    }
  }, [settings]);
  
  const handleToggle = async (
    key: keyof typeof localSettings,
    value: boolean
  ) => {
    // Optimistic update
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
    
    try {
      await updateSettings({ [key]: value });
      toast.success("Settings updated");
    } catch (error) {
      // Rollback on error
      setLocalSettings((prev) => ({ ...prev, [key]: !value }));
      toast.error("Failed to update settings");
      console.error("Settings update error:", error);
    }
  };
  
  const loading = authLoading || (isAuthenticated && settings === undefined);
  
  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="px-4 py-4 sm:px-5 md:px-6">
          <Skeleton className="mb-6 h-9 w-40" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Skeleton className="h-64 rounded-sm" />
            <Skeleton className="h-64 rounded-sm" />
          </div>
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
        <div className="flex h-full flex-col px-4 py-4 sm:px-5 md:px-6">
          <Card>
            <CardContent className="pt-5">
              <p className="text-center text-emerald-900/70 dark:text-emerald-100/70">
                Please log in to view settings.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
      <div className="flex h-full flex-col overflow-hidden px-4 py-4 sm:px-5 md:px-6">
        <motion.h1
          className="mb-4 text-3xl font-semibold text-emerald-900 dark:text-emerald-200"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          Settings
        </motion.h1>

        <div className="grid flex-1 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
          {/* Notification Settings */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card className="rounded-sm bg-white/95 before:hidden dark:bg-emerald-950/30">
              <CardHeader className="pb-2.5">
                <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                  Notification Settings
                </CardTitle>
                <CardDescription className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
                  Manage your notification preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="emailNotifications">Email Notifications</Label>
                  <Switch
                    id="emailNotifications"
                    checked={localSettings.emailNotifications}
                    onCheckedChange={(checked) =>
                      handleToggle("emailNotifications", checked)
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="pushNotifications">Push Notifications</Label>
                  <Switch
                    id="pushNotifications"
                    checked={localSettings.pushNotifications}
                    onCheckedChange={(checked) =>
                      handleToggle("pushNotifications", checked)
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="smsNotifications">SMS Notifications</Label>
                  <Switch
                    id="smsNotifications"
                    checked={localSettings.smsNotifications}
                    onCheckedChange={(checked) =>
                      handleToggle("smsNotifications", checked)
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>
 
          {/* Privacy Settings */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="rounded-sm bg-white/95 before:hidden dark:bg-emerald-950/30">
              <CardHeader className="pb-2.5">
                <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                  Privacy Settings
                </CardTitle>
                <CardDescription className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
                  Manage your privacy preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="profileVisibility">Profile Visibility</Label>
                    <p className="text-xs text-muted-foreground">
                      Make your profile visible to other users
                    </p>
                  </div>
                  <Switch
                    id="profileVisibility"
                    checked={localSettings.profileVisibility}
                    onCheckedChange={(checked) =>
                      handleToggle("profileVisibility", checked)
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="dataSharing">Data Sharing</Label>
                    <p className="text-xs text-muted-foreground">
                      Share anonymous usage data
                    </p>
                  </div>
                  <Switch
                    id="dataSharing"
                    checked={localSettings.dataSharing}
                    onCheckedChange={(checked) =>
                      handleToggle("dataSharing", checked)
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="activityTracking">Activity Tracking</Label>
                    <p className="text-xs text-muted-foreground">
                      Track activity for analytics
                    </p>
                  </div>
                  <Switch
                    id="activityTracking"
                    checked={localSettings.activityTracking}
                    onCheckedChange={(checked) =>
                      handleToggle("activityTracking", checked)
                    }
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>
 
          {/* Account Settings */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="md:col-span-2"
          >
            <Card className="rounded-sm bg-white/95 before:hidden dark:bg-emerald-950/30">
              <CardHeader className="pb-2.5">
                <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                  Account Settings
                </CardTitle>
                <CardDescription className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
                  Manage your account preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="rounded-sm border border-surface bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/80 transition-colors duration-200 hover:bg-emerald-50/60 dark:bg-emerald-950/40 dark:text-emerald-100/80 dark:hover:bg-emerald-900/60"
                    onClick={() => {
                      toast.info("Password change is managed through WorkOS");
                    }}
                  >
                    Change Password
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Password management is handled by your authentication provider
                  </p>
                </div>

                <div className="space-y-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        className="rounded-sm bg-rose-500/85 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-rose-500"
                      >
                        Delete Account
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. This will permanently delete your
                          account and remove your data from our servers.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-sm border border-surface bg-white/80 px-3 py-2 text-xs font-semibold text-emerald-900/80 transition-colors duration-200 hover:bg-white dark:bg-emerald-950/40 dark:text-emerald-100/80 dark:hover:bg-emerald-900/60">
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="rounded-sm bg-rose-500/85 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-rose-500"
                          onClick={() => {
                            toast.error("Account deletion is not yet implemented");
                            // TODO: Implement account deletion mutation
                          }}
                        >
                          Delete Account
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <p className="text-xs text-muted-foreground">
                    This will permanently delete all your data
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
