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

export default function SettingsPage() {
  const { isAuthenticated, loading: authLoading } = useWorkOSAuth();
  const convexAuthState = useConvexAuth();
  const readyForSettingsQuery =
    isAuthenticated &&
    !authLoading &&
    convexAuthState.isAuthenticated &&
    !convexAuthState.isLoading;
  const settings = (() => {
    try {
      return useQuery(
        api.settings.queries.getCurrentUserSettings,
        readyForSettingsQuery ? {} : "skip"
      );
    } catch (error) {
      console.error("[SettingsPage] useQuery threw", {
        readyForSettingsQuery,
        authLoading,
        workosAuthenticated: isAuthenticated,
        convexAuth: {
          isAuthenticated: convexAuthState.isAuthenticated,
          isLoading: convexAuthState.isLoading,
        },
      }, error);
      throw error;
    }
  })();
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
  
  const loading =
    authLoading ||
    convexAuthState.isLoading ||
    (readyForSettingsQuery && settings === undefined);

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