"use client";

/**
 * The /app home screen (docs/plan/MATCHING-PLAN.md, steps 5-6). It leads with
 * the matcher: a live proposal card when one is pending, else the upcoming
 * confirmed chat with its countdown and join window, else a calm state with
 * the next matcher run. The live queues move below as the "talk now" entry.
 */

import React, { Component, useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useQuery } from "convex/react";
import { motion } from "motion/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Briefcase, Phone } from "lucide-react";
import { ProposalCard } from "@/components/home/ProposalCard";
import { UpcomingChatCard } from "@/components/home/UpcomingChatCard";
import { HomeStates } from "@/components/home/HomeStates";
import { useNow } from "@/components/home/useCountdown";

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

/** Query failures need a retry boundary because useQuery throws during render. */
class MatcherBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const retry = () => this.setState({ failed: false });
    return (
      <section className="rounded-sm border border-surface bg-white/95 px-4 py-4 text-sm text-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-100/70">
        We couldn&apos;t load your matches.{" "}
        <button
          onClick={retry}
          className="font-semibold text-emerald-600 underline dark:text-emerald-300"
        >
          Try again
        </button>
        .
      </section>
    );
  }
}

function MatcherSection() {
  // The proposal card leads; when nothing is pending, the upcoming chat;
  // when neither, the calm state with the next run.
  const proposal = useQuery(api.matching.proposals.myProposal);
  const view = useQuery(api.matching.home.myHomeView);
  const now = useNow();

  if (proposal) {
    return <ProposalCard proposal={proposal} now={now} />;
  }
  if (view === undefined) return null; // still loading
  if (view === null) return null; // signed out mid-flight; auth wall handles it
  if (view.upcoming) {
    return <UpcomingChatCard upcoming={view.upcoming} now={now} />;
  }
  return <HomeStates view={view} />;
}

export default function HomePage() {
  const router = useRouter();
  // Identity comes from Convex (works under WorkOS and the eval test adapter
  // alike); no direct WorkOS hook here — /app is a proxy-exempt eval path.
  const me = useQuery(api.users.queries.getCurrentUser);
  const profile = useQuery(api.profiles.queries.getCurrentUserProfile);
  // The name the person chose at onboarding, never their email address.
  const name = profile?.displayName || me?.displayName;
  const { isAuthenticated } = useConvexAuth();
  const [talkNowOpen, setTalkNowOpen] = useState(true);

  const handleStartQueue = useCallback(
    (queueType: "casual" | "professional") => {
      if (me === null) {
        router.push("/auth/sign-in");
        return;
      }
      router.push(`/app/smart-connection?type=${queueType}`);
    },
    [router, me],
  );

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
            {name ? `Welcome to Connvo, ${name}` : "Welcome to Connvo"}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-emerald-900/70 dark:text-emerald-100/70">
            One good conversation at a time — proposed by the matcher, or live
            right now.
          </p>
        </motion.div>

        {isAuthenticated && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-4 shrink-0"
          >
            <MatcherBoundary>
              <MatcherSection />
            </MatcherBoundary>
          </motion.div>
        )}

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-emerald-900 dark:text-white">
                Talk now
              </h2>
              <p className="mt-1 text-sm text-emerald-900/70 dark:text-emerald-100/70">
                Skip the wait — pick a connection style and jump in.
              </p>
            </div>
            {isAuthenticated && (
              <button
                data-testid="toggle-talk-now"
                onClick={() => setTalkNowOpen((open) => !open)}
                aria-expanded={talkNowOpen}
                className="rounded-sm border border-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-900/70 hover:bg-emerald-50/60 dark:text-emerald-100/70 dark:hover:bg-emerald-900/60"
              >
                {talkNowOpen ? "Hide" : "Show"}
              </button>
            )}
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            {talkNowOpen && (
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
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
