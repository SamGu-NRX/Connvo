import type React from "react";
import { useState } from "react";
import { motion } from "framer-motion";
import { Award, Briefcase, Globe, Link } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const ExtendedProfile: React.FC = () => {
  const [showPersonalDetails, setShowPersonalDetails] = useState(true);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-lg bg-white p-4 shadow-xs dark:bg-zinc-900"
        >
          <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Badges
          </h3>
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              <Award size={14} className="mr-1.5" /> Top Connector
            </span>
            <span className="flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <Briefcase size={14} className="mr-1.5" /> Industry Expert
            </span>
            <span className="flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <Globe size={14} className="mr-1.5" /> Global Networker
            </span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-lg bg-white p-4 shadow-xs dark:bg-zinc-900"
        >
          <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Skills
          </h3>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              JavaScript
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              React
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              Node.js
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              UX Design
            </span>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              Project Management
            </span>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
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

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
        className="rounded-lg bg-white p-4 shadow-xs dark:bg-zinc-900"
      >
        <h3 className="mb-4 text-sm font-medium text-zinc-500 dark:text-zinc-400">
          External Links
        </h3>
        <div className="space-y-3">
          <div className="flex items-center">
            <Link size={16} className="mr-3 text-zinc-400" />
            <input
              type="text"
              placeholder="Personal Website"
              className="w-full border-b border-zinc-200 bg-transparent pb-1 text-sm focus:border-indigo-500 focus:outline-hidden dark:border-zinc-700"
            />
          </div>
          <div className="flex items-center">
            <Link size={16} className="mr-3 text-zinc-400" />
            <input
              type="text"
              placeholder="LinkedIn Profile"
              className="w-full border-b border-zinc-200 bg-transparent pb-1 text-sm focus:border-indigo-500 focus:outline-hidden dark:border-zinc-700"
            />
          </div>
          <div className="flex items-center">
            <Link size={16} className="mr-3 text-zinc-400" />
            <input
              type="text"
              placeholder="GitHub Profile"
              className="w-full border-b border-zinc-200 bg-transparent pb-1 text-sm focus:border-indigo-500 focus:outline-hidden dark:border-zinc-700"
            />
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default ExtendedProfile;
