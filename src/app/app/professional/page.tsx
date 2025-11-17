"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";

export default function ProfessionalConnectionPage() {
  const router = useRouter();
  const { user } = useWorkOSAuth();
  const [purpose, setPurpose] = useState("");
  const [description, setDescription] = useState("");

  const handleStartQueue = (type: string) => {
    if (!user) {
      router.push("/auth/sign-in");
      return;
    }
    router.push(
      `/app/professional/${type}?purpose=${encodeURIComponent(purpose)}&description=${encodeURIComponent(description)}`,
    );
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden">
      <div className="flex h-full flex-col overflow-hidden px-4 py-5 sm:px-6 md:px-7">
        <motion.h1
          className="mb-6 text-3xl font-semibold text-emerald-900 dark:text-emerald-200"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          Professional Connection
        </motion.h1>
        <Card className="flex h-full flex-col rounded-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold text-emerald-900 dark:text-emerald-200">
              Choose Your Connection Purpose
            </CardTitle>
            <CardDescription className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
              {`Select the type of professional connection you're looking for`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-4 overflow-y-auto">
            <div className="space-y-3">
              <Label htmlFor="purpose">Connection Purpose</Label>
              <Input
                id="purpose"
                placeholder="e.g., Seeking advice on startup funding"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="rounded-md border-white/30 bg-white/50 placeholder:text-emerald-900/40 dark:border-white/10 dark:bg-white/10"
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                placeholder="Provide more details about what you're looking for"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-md border-white/30 bg-white/50 placeholder:text-emerald-900/40 dark:border-white/10 dark:bg-white/10"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Button
                className="rounded-md bg-emerald-500/85 px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-200 hover:bg-emerald-500"
                onClick={() => handleStartQueue("b2b")}
              >
                B2B Networking
              </Button>
              <Button
                className="rounded-md bg-emerald-500/85 px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-200 hover:bg-emerald-500"
                onClick={() => handleStartQueue("collaboration")}
              >
                Find Collaborators
              </Button>
              <Button
                className="rounded-md bg-emerald-500/85 px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-200 hover:bg-emerald-500"
                onClick={() => handleStartQueue("mentorship")}
              >
                Seek Mentorship
              </Button>
              <Button
                className="rounded-md bg-emerald-500/85 px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.2em] text-white transition-colors duration-200 hover:bg-emerald-500"
                onClick={() => handleStartQueue("investment")}
              >
                Pitch to Investors
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
