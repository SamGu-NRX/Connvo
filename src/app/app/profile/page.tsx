"use client";

import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

// Form validation schema
const profileSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters"),
  bio: z.string().max(500, "Bio must be less than 500 characters").optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  field: z.string().optional(),
  linkedinUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { user, isAuthenticated, loading: authLoading } = useWorkOSAuth();
  const convexUser = useQuery(
    api.users.queries.getCurrentUser,
    isAuthenticated ? {} : "skip"
  );
  const profile = useQuery(
    api.profiles.queries.getCurrentUserProfile,
    isAuthenticated ? {} : "skip"
  );
  const updateProfile = useMutation(api.profiles.mutations.updateProfile);
  
  const [isSaving, setIsSaving] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);

  // Debug logging - track profile page state
  useEffect(() => {
    console.log('[ProfilePage] State:', {
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      isAuthenticated,
      authLoading,
      convexUser: convexUser ? {
        _id: convexUser._id,
        email: convexUser.email,
        displayName: convexUser.displayName,
      } : null,
      profile: profile ? {
        _id: profile._id,
        userId: profile.userId,
        displayName: profile.displayName,
      } : null,
      profileIsUndefined: profile === undefined,
      profileIsNull: profile === null,
      formInitialized,
    });
  }, [user, isAuthenticated, authLoading, convexUser, profile, formInitialized]);
  
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: "",
      bio: "",
      company: "",
      jobTitle: "",
      field: "",
      linkedinUrl: "",
    },
  });
  
  // Update form when profile loads or create default from user data
  useEffect(() => {
    // Wait until we have definitive data (not undefined)
    if (profile === undefined || formInitialized) return;
    
    console.log('[ProfilePage] Form initialization effect triggered:', {
      hasProfile: !!profile,
      profileDisplayName: profile?.displayName,
      hasUser: !!user,
      formInitialized,
    });
    
    // Build form data from profile or fallback to user data
    const formData = {
      displayName: profile?.displayName ||
                   convexUser?.displayName ||
                   [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
                   user?.email?.split('@')[0] ||
                   "",
      bio: profile?.bio || "",
      company: profile?.company || "",
      jobTitle: profile?.jobTitle || "",
      field: profile?.field || "",
      linkedinUrl: profile?.linkedinUrl || "",
    };
    
    console.log('[ProfilePage] Initializing form with data:', formData);
    
    // Use reset with keepDefaultValues: false to force update
    form.reset(formData, {
      keepDefaultValues: false,
      keepDirty: false,
      keepTouched: false
    });
    
    setFormInitialized(true);
  }, [profile, convexUser, user, formInitialized, form]);
  
  const onSubmit = async (data: ProfileFormValues) => {
    if (!isAuthenticated) {
      toast.error("Please sign in to update your profile");
      return;
    }
    
    setIsSaving(true);
    try {
      console.log('[ProfilePage] Submitting profile update:', {
        data,
        isAuthenticated,
        hasConvexUser: !!convexUser,
        hasProfile: !!profile,
      });
      
      await updateProfile({
        displayName: data.displayName,
        bio: data.bio || undefined,
        company: data.company || undefined,
        jobTitle: data.jobTitle || undefined,
        field: data.field || undefined,
        linkedinUrl: data.linkedinUrl || undefined,
      });
      
      toast.success("Profile updated successfully!");
      
      // Mark form as pristine after successful save
      form.reset(data, { keepValues: true });
    } catch (error) {
      console.error("[ProfilePage] Failed to update profile:", error);
      
      // Handle specific error types
      if (error instanceof Error) {
        if (error.message.includes("UNAUTHORIZED") || error.message.includes("Authentication required")) {
          toast.error("Session expired. Please sign in again.");
        } else if (error.message.includes("Profile not found")) {
          toast.error("Profile not found. Please try refreshing the page.");
        } else {
          toast.error(`Failed to update profile: ${error.message}`);
        }
      } else {
        toast.error("An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsSaving(false);
    }
  };
  
  // Loading state: show loading until we have definitive data (not undefined)
  const loading = authLoading || (isAuthenticated && (convexUser === undefined || profile === undefined));
  
  if (loading) {
    return (
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
        <div className="flex h-full flex-col overflow-hidden px-4 py-4 sm:px-5 md:px-6">
          <Skeleton className="mb-4 h-9 w-40" />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Skeleton className="h-96 rounded-sm" />
            <Skeleton className="h-96 rounded-sm" />
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
        <div className="flex h-full flex-col px-4 py-4 sm:px-5 md:px-6">
          <Card className="rounded-sm bg-white/95 before:hidden dark:bg-emerald-950/30">
            <CardContent className="pt-4">
              <p className="text-center text-emerald-900/70 dark:text-emerald-100/70">
                Please log in to view your profile.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  
  const displayName = profile?.displayName || 
                      convexUser?.displayName || 
                      [user.firstName, user.lastName].filter(Boolean).join(" ") || 
                      "No name set";
  const initials = displayName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden">
      <div className="flex h-full flex-col overflow-hidden px-4 py-4 sm:px-5 md:px-6">
        <motion.h1
          className="mb-4 text-3xl font-semibold text-emerald-900 dark:text-emerald-200"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          My Profile
        </motion.h1>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex h-full flex-col overflow-hidden"
          >
            <div className="grid flex-1 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                <Card className="flex h-full flex-col rounded-sm bg-white/95 before:hidden dark:bg-emerald-950/30">
                  <CardHeader className="pb-2.5">
                    <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                      Personal Information
                    </CardTitle>
                    <CardDescription className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
                      Manage your personal details
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2.5">
                    <div className="mb-4 flex items-center gap-4">
                      <Avatar className="h-16 w-16 rounded-sm">
                        <AvatarImage src={user.profilePictureUrl} alt={displayName} />
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Profile picture managed by WorkOS
                        </p>
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="displayName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Display Name</FormLabel>
                          <FormControl>
                            <Input placeholder="John Doe" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="space-y-1.5">
                      <Label>Email</Label>
                      <Input value={user.email} disabled />
                      <p className="text-xs text-muted-foreground">
                        Email is managed by your authentication provider
                      </p>
                    </div>

                    <FormField
                      control={form.control}
                      name="bio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bio</FormLabel>
                          <FormControl>
                            <Textarea
                              className="max-h-40 resize-y"
                              placeholder="Tell us about yourself"
                              rows={4}
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>Max 500 characters</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <Card className="flex h-full flex-col rounded-sm bg-white/95 before:hidden dark:bg-emerald-950/30">
                  <CardHeader className="pb-2.5">
                    <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                      Professional Information
                    </CardTitle>
                    <CardDescription className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
                      Manage your professional details
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2.5">
                    <FormField
                      control={form.control}
                      name="company"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company</FormLabel>
                          <FormControl>
                            <Input placeholder="Acme Inc." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="jobTitle"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Job Title</FormLabel>
                          <FormControl>
                            <Input placeholder="Software Engineer" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="field"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Field/Industry</FormLabel>
                          <FormControl>
                            <Input placeholder="Technology" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="linkedinUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>LinkedIn URL</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="https://linkedin.com/in/username"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="mt-4 flex justify-end"
            >
              <Button
                type="submit"
                disabled={isSaving || !form.formState.isDirty}
                className="w-full rounded-sm bg-emerald-500/85 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-emerald-500 disabled:opacity-60 md:w-auto"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </motion.div>
          </form>
        </Form>
      </div>
    </div>
  );
}
