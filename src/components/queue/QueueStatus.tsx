import React from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";

interface QueueStatusProps {
  queueType: "formal" | "casual";
  estimatedWaitTime: number;
}

export default function QueueStatus({
  queueType,
  estimatedWaitTime,
}: QueueStatusProps) {
  return (
    <div className="space-y-2 text-center">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{
          duration: 2,
          repeat: Number.POSITIVE_INFINITY,
          ease: "linear",
        }}
        className="mb-4 inline-block"
      >
        <Loader2 className="h-12 w-12 text-emerald-500 dark:text-emerald-300" />
      </motion.div>
      <h2 className="text-2xl font-semibold text-emerald-900 dark:text-emerald-200">
        In Queue
      </h2>
      <p className="text-sm text-emerald-900/70 dark:text-emerald-100/70">
        Searching for a {queueType === "formal" ? "professional" : "casual"}{" "}
        match
      </p>
      <p className="text-xs uppercase tracking-[0.3em] text-emerald-900/50 dark:text-emerald-200/50">
        Estimated wait: {Math.floor(estimatedWaitTime / 60)}:
        {(estimatedWaitTime % 60).toString().padStart(2, "0")}
      </p>
    </div>
  );
}
