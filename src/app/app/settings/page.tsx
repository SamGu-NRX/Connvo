"use client";

import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
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
import {
  AvailabilityEditor,
  defaultTimezone,
  type AvailabilityValue,
  type Intent,
} from "@/components/availability/AvailabilityEditor";
import { blocksToGrid, gridToBlocks } from "@/lib/availability/schedule";

export default function SettingsPage() {
  const { isAuthenticated, loading: authLoading } = useWorkOSAuth();
  const convexAuthState = useConvexAuth();
  const readyForSettingsQuery =
    isAuthenticated &&
    !authLoading &&
    convexAuthState.isAuthenticated &&
    !convexAuthState.isLoading;
  const settings = useQuery(
    api.settings.queries.getCurrentUserSettings,
    readyForSettingsQuery ? {} : "skip",
  );
  const updateSettings = useMutation(api.settings.mutations.updateSettings);
  const chatPreferences = useQuery(
    api.profiles.availability.getMyChatPreferences,
    readyForSettingsQuery ? {} : "skip",
  );
  const availability = useQuery(
    api.profiles.availability.getMyAvailability,
    readyForSettingsQuery ? {} : "skip",
  );
  const setChatPreferences = useMutation(api.profiles.availability.setChatPreferences);
  const replaceAvailability = useMutation(api.profiles.availability.replaceAvailability);

  // Matching & availability editor state, prefilled once both queries land.
  const [editor, setEditor] = useState<AvailabilityValue | null>(null);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const preferencesLoaded = chatPreferences !== undefined;
  const availabilityLoaded = availability !== undefined;
  if (editor === null && preferencesLoaded && availabilityLoaded) {
    // The queries are typed, but a mocked or partially-provisioned client can
    // answer with unexpected shapes; degrade to defaults instead of crashing.
    const blocks = Array.isArray(availability) ? availability : [];
    const prefs = chatPreferences && typeof chatPreferences === "object" ? chatPreferences : null;
    setEditor({
      intents: (prefs?.intents ?? []) as Intent[],
      timezone: prefs?.timezone ?? defaultTimezone(),
      chatsPerWeek: prefs?.chatsPerWeek ?? 1,
      grid: blocksToGrid(blocks),
    });
  }

  const handleSaveAvailability = async () => {
    if (!editor) return;
    setSavingAvailability(true);
    try {
      await setChatPreferences({
        intents: editor.intents,
        timezone: editor.timezone,
        chatsPerWeek: editor.chatsPerWeek,
      });
      await replaceAvailability({ blocks: gridToBlocks(editor.grid) });
      toast.success("Matching preferences saved");
    } catch (error) {
      console.error("Availability save error:", error);
      toast.error("Couldn't save your matching preferences");
    } finally {
      setSavingAvailability(false);
    }
  };

  
  // Local state for optimistic updates
  const [localSettings, setLocalSettings] = useState({
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
    profileVisibility: true,
    dataSharing: false,
    activityTracking: true,
  });
  
  const [previousSettings, setPreviousSettings] = useState<typeof settings>(undefined);
  if (settings !== previousSettings) {
    setPreviousSettings(settings);
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
  }
  
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
  
  const loading =
    authLoading ||
    convexAuthState.isLoading ||
    (readyForSettingsQuery && settings === undefined);

  // The home nudge links to #matching, but the card mounts only once auth,
  // settings and the availability queries have all resolved, in any order,
  // which is too late for the browser's own hash scroll.
  const matchingCardReady = !loading && editor !== null;
  useEffect(() => {
    if (matchingCardReady && window.location.hash === "#matching") {
      document.getElementById("matching")?.scrollIntoView({ block: "start" });
    }
  }, [matchingCardReady]);

  useEffect(() => {
    console.log("[SettingsPage] Query readiness", {
      readyForSettingsQuery,
      authLoading,
      workosAuthenticated: isAuthenticated,
      convexAuthLoading: convexAuthState.isLoading,
      convexAuthenticated: convexAuthState.isAuthenticated,
      settingsState: settings
        ? { hasSettings: true, id: settings._id }
        : { hasSettings: false, isUndefined: settings === undefined },
    });
  }, [
    readyForSettingsQuery,
    authLoading,
    isAuthenticated,
    convexAuthState.isLoading,
    convexAuthState.isAuthenticated,
    settings,
  ]);
  
  if (loading) {
    return (
      <div className="container mx-auto p-4 md:p-8">
        <Skeleton className="mb-8 h-10 w-48" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto p-4 md:p-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">
              Please log in to view settings.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto p-4 md:p-8">
      <motion.h1
        className="mb-8 text-3xl font-bold"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        Settings
      </motion.h1>
      
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Notification Settings */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>
                Manage your notification preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
          <Card>
            <CardHeader>
              <CardTitle>Privacy Settings</CardTitle>
              <CardDescription>Manage your privacy preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
        
        {/* Matching & Availability */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="md:col-span-2"
        >
          <Card id="matching" data-testid="matching-settings" className="scroll-mt-6">
            <CardHeader>
              <CardTitle>Matching &amp; availability</CardTitle>
              <CardDescription>
                What you want from conversations and when you&apos;re free —
                the matcher uses this to pair your coffee chats.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {editor ? (
                <>
                  <AvailabilityEditor value={editor} onChange={setEditor} />
                  <div className="flex justify-end">
                    <Button
                      onClick={handleSaveAvailability}
                      disabled={savingAvailability}
                    >
                      Save matching preferences
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-8 w-2/3" />
                  <Skeleton className="h-40 w-full" />
                </div>
              )}
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
          <Card>
            <CardHeader>
              <CardTitle>Account Settings</CardTitle>
              <CardDescription>Manage your account preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Button 
                  variant="outline"
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
                    <Button variant="destructive">Delete Account</Button>
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
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
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
  );
}