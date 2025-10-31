"use client";

import React, { useState, useEffect } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Phone,
  Shield,
  Zap,
  Users,
  Star,
  ArrowRight,
  Timer,
  MessageSquare,
  Target,
  Award,
  TrendingUp,
  ChevronRight,
  UserCheck,
  Globe,
  Clock,
  Activity,
  Sun,
  Moon,
} from "lucide-react";
import { handleTransition } from "@/utils/TransitionLink";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useRouter } from "next/navigation";

// Retention data for the chart
const retentionData = [
  { month: "Jan", rate: 85 },
  { month: "Feb", rate: 87 },
  { month: "Mar", rate: 89 },
  { month: "Apr", rate: 92 },
  { month: "May", rate: 94 },
  { month: "Jun", rate: 95 },
];

// Glass Card Component for modern UI elements
const GlassCard = ({
  children,
  className = "",
  ...props
}: {
  children: React.ReactNode;
  className?: string;
  [key: string]: any;
}) => (
  <div
    className={`relative overflow-hidden rounded-2xl border border-white/20 bg-white/10 backdrop-blur-xl dark:border-white/10 dark:bg-white/5 ${className}`}
    {...props}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent dark:from-white/10" />
    <div className="relative">{children}</div>
  </div>
);

// MacBook Component with improved transitions
const MacbookScroll = () => {
  const { scrollYProgress } = useScroll();

  const scale = useTransform(scrollYProgress, [0, 0.3], [0.8, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.2], [0.5, 1]);
  const translateY = useTransform(scrollYProgress, [0, 0.3], [100, 0]);
  const rotateX = useTransform(scrollYProgress, [0, 0.3], [20, 0]);

  return (
    <div className="flex h-[60vh] items-center justify-center overflow-hidden bg-linear-to-b from-white to-emerald-50 md:h-[80vh] dark:from-gray-900 dark:to-gray-800">
      <motion.div
        style={{
          scale,
          opacity,
          y: translateY,
          rotateX,
          perspective: "1000px",
        }}
        className="relative w-full max-w-4xl"
      >
        <div className="relative aspect-16/10 w-full overflow-hidden rounded-t-xl border-[8px] border-b-0 border-gray-800 bg-gray-900 shadow-2xl">
          <img
            src="landerimage.png"
            alt="App Interface Screenshot"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
        <div className="h-6 w-full rounded-b-xl bg-gray-800"></div>
        <div className="mx-auto h-1 w-[40%] rounded-b-xl bg-gray-700"></div>
      </motion.div>
    </div>
  );
};

// Improved Stat Card component
interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  label: string;
  delay: number;
}

const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  value,
  label,
  delay,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.5 }}
    whileHover={{ y: -5, scale: 1.02 }}
    className="group"
  >
    <GlassCard className="p-6 transition-all duration-300 hover:bg-white/20 dark:hover:bg-white/10">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 p-3 backdrop-blur-sm">
          <Icon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <h4 className="mb-1 text-3xl font-light text-slate-900 dark:text-white">
            {value}
          </h4>
          <p className="text-slate-600 dark:text-slate-300">{label}</p>
        </div>
      </div>
    </GlassCard>
  </motion.div>
);

// Improved Feature Card component
interface FeatureCardProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  index: number;
}

const FeatureCard: React.FC<FeatureCardProps> = ({
  title,
  description,
  icon: Icon,
  index,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.1, duration: 0.5 }}
    whileHover={{ y: -8, scale: 1.03 }}
    className="group"
  >
    <GlassCard className="p-6 transition-all duration-300 hover:bg-white/20 dark:hover:bg-white/10">
      <div className="mb-4 w-fit rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 p-3 backdrop-blur-sm transition-all duration-300 group-hover:bg-gradient-to-br group-hover:from-emerald-500/20 group-hover:to-teal-500/20">
        <Icon className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
      </div>
      <h3 className="mb-3 text-xl font-medium text-slate-900 dark:text-white">
        {title}
      </h3>
      <p className="text-slate-600 dark:text-slate-300">{description}</p>
    </GlassCard>
  </motion.div>
);

// Improved Testimonial Card component
interface TestimonialCardProps {
  name: string;
  role: string;
  text: string;
  rating: number;
  index: number;
}

const TestimonialCard: React.FC<TestimonialCardProps> = ({
  name,
  role,
  text,
  rating,
  index,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.2, duration: 0.5 }}
    whileHover={{ y: -5, scale: 1.02 }}
    className="group"
  >
    <GlassCard className="p-6 transition-all duration-300 hover:bg-white/20 dark:hover:bg-white/10">
      <div className="mb-4 flex gap-1">
        {[...Array(rating)].map((_, i) => (
          <Star key={i} className="h-5 w-5 fill-current text-amber-400" />
        ))}
      </div>
      <p className="mb-4 text-slate-600 italic dark:text-slate-300">
        &quot;{text}&quot;
      </p>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 font-medium text-slate-700 backdrop-blur-sm dark:text-slate-200">
          {name.charAt(0)}
        </div>
        <div>
          <p className="font-medium text-slate-900 dark:text-white">{name}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{role}</p>
        </div>
      </div>
    </GlassCard>
  </motion.div>
);

// Clean Gradient Background Component
const LiquidGlassBackground = () => {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 via-white to-teal-50/50 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950/20" />
      <div
        className="absolute inset-0 opacity-[0.02] dark:opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
};

// Unified StartCta (merged)
function StartCta({
  className,
  children,
  style,
  ...props
}: {
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  [key: string]: any;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();
  return (
    <motion.a
      href="#start"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={className}
      style={style}
      onClick={(e) => {
        e.preventDefault();
        if (loading) return;
        const dest = user ? "/app" : "/auth/sign-in";
        handleTransition(e, dest, router);
      }}
      {...props}
    >
      {children}
    </motion.a>
  );
}

// Main Landing Page component
const LandingPage = () => {
  const [theme, setTheme] = useState("light");
  const { scrollY } = useScroll();
  const parallaxY = useTransform(scrollY, [0, 1000], [0, -150]);
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme") || "light";
      setTheme(savedTheme);
      if (savedTheme === "dark") {
        document.documentElement.classList.add("dark");
      }
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    document.documentElement.classList.toggle("dark");
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", newTheme);
    }
  };

  const scrollToSection = (elementId: string) => {
    const element = document.getElementById(elementId);
    if (element) {
      window.scrollTo({
        top: element.offsetTop - 100,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className={`min-h-screen ${theme === "dark" ? "dark" : ""}`}>
      <div className="bg-white transition-colors duration-300 dark:bg-gray-900">
        {/* Modern Glass Nav */}
        <nav className="fixed top-0 z-50 w-full">
          <div className="mx-6 mt-6">
            <GlassCard className="mx-auto max-w-6xl px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-light tracking-tight text-slate-900 dark:text-white">
                    Connvo
                  </span>
                </div>

                <div className="hidden items-center gap-8 md:flex">
                  {[
                    { label: "Features", id: "features" },
                    { label: "Testimonials", id: "testimonials" },
                    { label: "Pricing", id: "pricing" },
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => scrollToSection(item.id)}
                      className="relative text-sm font-medium text-slate-600 transition-colors hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={toggleTheme}
                    className="rounded-xl p-2 transition-colors hover:bg-white/20 dark:hover:bg-white/10"
                    aria-label="Toggle theme"
                  >
                    {theme === "light" ? (
                      <Moon className="h-5 w-5 text-slate-600" />
                    ) : (
                      <Sun className="h-5 w-5 text-slate-300" />
                    )}
                  </button>

                  <StartCta
                    className="rounded-xl px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300 hover:shadow-xl"
                    style={{
                      background:
                        "radial-gradient(ellipse at center, #10b981, #0d9488)",
                    }}
                  >
                    Start Connecting
                  </StartCta>
                </div>
              </div>
            </GlassCard>
          </div>
        </nav>

        {/* Modern Glass Hero Section */}
        <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
          <LiquidGlassBackground />

          <div className="relative z-10 container mx-auto px-6 py-32">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="mx-auto max-w-5xl text-center"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="mb-8 inline-block"
              >
                <GlassCard className="px-6 py-3">
                  <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-sm font-medium text-transparent dark:from-emerald-400 dark:to-teal-400">
                    Professional networking reimagined
                  </span>
                </GlassCard>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.8 }}
                className="mb-8 text-6xl font-light tracking-tight text-slate-900 md:text-7xl lg:text-8xl dark:text-white"
              >
                Professional Networking
                <br />
                <span className="bg-gradient-to-r from-emerald-600 to-teal-700 bg-clip-text font-medium text-transparent dark:from-emerald-400 dark:to-teal-300">
                  Without the BS.
                </span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.6 }}
                className="mx-auto mb-12 max-w-2xl text-xl leading-relaxed text-slate-600 dark:text-slate-300"
              >
                Where professionals come to actually connect, not to share
                inspirational quotes or humble brag about their morning
                routines.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8, duration: 0.6 }}
                className="flex flex-col items-center justify-center gap-4 sm:flex-row"
              >
                <StartCta
                  className="group relative overflow-hidden rounded-2xl px-8 py-4 font-medium text-white shadow-lg transition-all duration-300 hover:shadow-2xl sm:w-auto"
                  style={{
                    background:
                      "radial-gradient(ellipse at center, #10b981, #0d9488)",
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      background:
                        "radial-gradient(ellipse at center, #059669, #0f766e)",
                    }}
                  />
                  <span className="relative flex items-center gap-2">
                    Start Real Networking
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </span>
                </StartCta>

                <button
                  onClick={() => scrollToSection("how-it-works")}
                  className="group relative sm:w-auto"
                >
                  <GlassCard className="px-8 py-4 transition-all duration-300 hover:bg-white/20 dark:hover:bg-white/10">
                    <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
                      See How It Works
                      <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                    </span>
                  </GlassCard>
                </button>
              </motion.div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5, duration: 1 }}
            className="absolute bottom-8 left-1/2 -translate-x-1/2"
          >
            <div className="flex flex-col items-center gap-2">
              <GlassCard className="p-2">
                <div className="h-6 w-1 rounded-full bg-gradient-to-b from-emerald-500 to-transparent" />
              </GlassCard>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Scroll
              </span>
            </div>
          </motion.div>
        </section>

        {/* MacBook Scroll Component */}
        <MacbookScroll />

        {/* Improved Stats Section */}
        <section className="bg-linear-to-b from-emerald-50 to-white py-20 dark:from-gray-800/50 dark:to-gray-900">
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-12 text-center"
            >
              <h2 className="mb-4 text-3xl font-semibold text-gray-900 dark:text-white">
                Why professionals choose Connvo
              </h2>
              <div className="mx-auto h-1 w-20 rounded-full bg-emerald-600"></div>
            </motion.div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={UserCheck}
                value="50K+"
                label="BS-Free Conversations"
                delay={0.1}
              />
              <StatCard
                icon={Clock}
                value="92%"
                label="Less Cringe Than LinkedIn"
                delay={0.2}
              />
              <StatCard
                icon={Activity}
                value="4.8/5"
                label="User Satisfaction"
                delay={0.3}
              />
              <StatCard
                icon={Globe}
                value="120+"
                label="Countries Represented"
                delay={0.4}
              />
            </div>
          </div>
        </section>

        {/* Improved Features Section */}
        <section id="features" className="py-20">
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-16 max-w-3xl text-center"
            >
              <div className="mb-4 inline-block rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                What makes us different
              </div>
              <h2 className="mb-6 text-4xl font-semibold text-gray-900 dark:text-white">
                Features That Actually Matter
              </h2>
              <p className="text-xl text-gray-600 dark:text-gray-300">
                No fluff. No filler. Just real connection tools.
              </p>
            </motion.div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Timer,
                  title: "5-Minute Calls",
                  description:
                    "Because 'quick coffee chats' are never quick. Get straight to the point.",
                },
                {
                  icon: Users,
                  title: "Smart Matching",
                  description:
                    "Like dating apps, but for people who want to talk about more than their Myers-Briggs.",
                },
                {
                  icon: Shield,
                  title: "BS Detection",
                  description:
                    "Our AI flags corporate buzzwords faster than you can say 'synergy'.",
                },
                {
                  icon: MessageSquare,
                  title: "Real Talk Only",
                  description:
                    "Save the weather small talk for your next awkward elevator ride.",
                },
                {
                  icon: Award,
                  title: "Trust Score",
                  description:
                    "Earned by being interesting, not by posting motivational quotes.",
                },
                {
                  icon: TrendingUp,
                  title: "Actual Growth",
                  description:
                    "Track connections that matter, not your endorsement count.",
                },
              ].map((feature, index) => (
                <FeatureCard key={index} {...feature} index={index} />
              ))}
            </div>
          </div>
        </section>

        {/* Improved Social Proof Section */}
        <section
          id="testimonials"
          className="bg-linear-to-b from-white to-emerald-50 py-20 dark:from-gray-900 dark:to-gray-800/50"
        >
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-16 max-w-3xl text-center"
            >
              <div className="mb-4 inline-block rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                {`Don't take our word for it`}
              </div>
              <h2 className="mb-6 text-4xl font-semibold text-gray-900 dark:text-white">
                What Real Humans Say
              </h2>
              <p className="text-xl text-gray-600 dark:text-gray-300">
                No paid testimonials. Just honest feedback.
              </p>
            </motion.div>

            <div className="grid gap-8 md:grid-cols-3">
              {[
                {
                  name: "Sarah K.",
                  role: "Reformed LinkedIn Influencer",
                  text: "Found my co-founder in 5 minutes. My LinkedIn connection requests are still pending.",
                  rating: 5,
                },
                {
                  name: "Alex T.",
                  role: "Professional Human",
                  text: "Finally, networking that doesn't feel like a bad LinkedIn post. Actually made meaningful connections.",
                  rating: 5,
                },
                {
                  name: "Mike R.",
                  role: "Ex-Corporate Buzzword Expert",
                  text: "Turns out, real conversations work better than 'touching base' emails. Who knew?",
                  rating: 5,
                },
              ].map((testimonial, index) => (
                <TestimonialCard key={index} {...testimonial} index={index} />
              ))}
            </div>
          </div>
        </section>

        {/* Retention Data Visualization */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-12 max-w-3xl text-center"
            >
              <div className="mb-4 inline-block rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                Users stick around
              </div>
              <h2 className="mb-6 text-4xl font-semibold text-gray-900 dark:text-white">
                Industry-Leading Retention
              </h2>
              <p className="text-xl text-gray-600 dark:text-gray-300">
                People who join Connvo actually keep using it. Imagine that.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="mb-12 rounded-2xl border border-emerald-100 bg-white p-6 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={retentionData}>
                    <XAxis
                      dataKey="month"
                      stroke={theme === "dark" ? "#94a3b8" : "#64748b"}
                    />
                    <YAxis stroke={theme === "dark" ? "#94a3b8" : "#64748b"} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor:
                          theme === "dark" ? "#1e293b" : "#ffffff",
                        borderColor: theme === "dark" ? "#334155" : "#e2e8f0",
                        color: theme === "dark" ? "#f8fafc" : "#0f172a",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      name="Retention %"
                      stroke="#10b981"
                      strokeWidth={3}
                      dot={{
                        r: 6,
                        strokeWidth: 2,
                        fill: theme === "dark" ? "#1e293b" : "#ffffff",
                      }}
                      activeDot={{ r: 8 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Improved CTA Section */}
        <section
          id="pricing"
          className="bg-linear-to-r from-emerald-600 to-teal-600 py-20 text-white"
        >
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              className="mx-auto max-w-4xl text-center"
            >
              <h2 className="mb-6 text-4xl font-semibold">
                Ready for Real Professional Growth?
              </h2>
              <p className="mb-10 text-xl text-emerald-100">
                Join thousands of professionals building meaningful connections
                through authentic conversations.
              </p>
              <motion.a
                href="/app"
                onClick={(e) => handleTransition(e, "/app", router)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 font-medium text-emerald-600 shadow-md transition-all hover:bg-gray-100 hover:shadow-lg"
              >
                Start Your Journey <ArrowRight className="h-5 w-5" />
              </motion.a>
            </motion.div>
          </div>
        </section>

        {/* Improved Footer */}
        <footer className="border-t border-emerald-100 py-12 dark:border-gray-800">
          <div className="container mx-auto px-6">
            <div className="flex flex-col items-center justify-between md:flex-row">
              <div className="mb-6 flex items-center md:mb-0">
                <span className="pl-2 text-xl font-medium text-gray-900 dark:text-white">
                  Connvo
                </span>
              </div>

              <div className="text-center text-gray-600 md:text-right dark:text-gray-300">
                © {new Date().getFullYear()} Connvo. All rights reserved.
                <div className="mt-1 text-sm">
                  No corporate jargon was harmed in the making of this site.
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default LandingPage;
