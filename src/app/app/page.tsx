"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useWorkOSAuth } from "@/hooks/useWorkOSAuth";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Phone, Briefcase } from "lucide-react";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};
export default function HomePage() {
  const router = useRouter();
  const { user } = useWorkOSAuth();
  const handleStartQueue = (queueType: "casual" | "professional") => {
    if (!user) {
      router.push("/auth/sign-in");
      return;
    }
    router.push(`/app/smart-connection?type=${queueType}`);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden px-4 py-4 sm:px-5 md:px-6">
      <div className="flex h-full flex-col overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          className="mb-4 overflow-hidden text-left sm:text-center"
        >
          <h1 className="bg-linear-to-r from-emerald-400 via-emerald-500 to-teal-400 bg-clip-text pb-1 text-4xl font-semibold text-transparent md:text-5xl">
            Welcome to Connvo, {user?.firstName || user?.email || "Guest"}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-emerald-900/70 dark:text-emerald-100/70">
            Connect with professionals and casual contacts through beautifully
            orchestrated voice calls.
          </p>
        </motion.div>

        <section className="flex h-full flex-col overflow-hidden">
          <header className="mb-3">
            <h2 className="text-2xl font-semibold text-emerald-900 dark:text-white">
              Start a New Connection
            </h2>
            <p className="mt-1 text-sm text-emerald-900/70 dark:text-emerald-100/70">
              Pick a connection style and jump in.
            </p>
          </header>
          <div className="flex-1 overflow-hidden">
            <motion.div
              variants={container}
              initial="hidden"
              animate="show"
              className="grid h-full grid-cols-1 gap-3 overflow-y-auto overscroll-contain pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid-cols-2"
            >
              <motion.div variants={item}>
                <div className="space-y-2.5 rounded-sm border border-surface bg-white/95 px-4 py-3 dark:bg-emerald-950/40">
                  <h3 className="flex items-center text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                    <Phone className="mr-3 h-5 w-5 text-emerald-500 dark:text-emerald-300" />
                    Casual
                  </h3>
                  <p className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
                    Connect with someone for a friendly, low-key conversation.
                  </p>
                  <Button
                    className="w-full rounded-sm bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition-colors duration-200 hover:bg-emerald-600 md:w-auto"
                    onClick={() => handleStartQueue("casual")}
                  >
                    Start Casual Matching
                  </Button>
                </div>
              </motion.div>

              <motion.div variants={item}>
                <div className="space-y-2.5 rounded-sm border border-surface bg-white/95 px-4 py-3 dark:bg-emerald-950/40">
                  <h3 className="flex items-center text-lg font-semibold text-emerald-900 dark:text-emerald-200">
                    <Briefcase className="mr-3 h-5 w-5 text-sky-500 dark:text-sky-300" />
                    Professional
                  </h3>
                  <p className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
                    Get matched with professionals tailored to your goals.
                  </p>
                  <Button
                    variant="outline"
                    className="w-full rounded-sm border border-surface bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900/80 transition-colors duration-200 hover:bg-emerald-50/60 dark:bg-emerald-950/50 dark:text-emerald-100/80 dark:hover:bg-emerald-900/60 md:w-auto"
                    onClick={() => handleStartQueue("professional")}
                  >
                    Start Professional Matching
                  </Button>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  );
}
