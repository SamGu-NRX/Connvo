"use client";

import React, { useState, useEffect } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import Image from "next/image";
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
    className={`relative overflow-hidden rounded-2xl border border-white/40 bg-white/60 shadow-[0_12px_45px_-18px_rgba(15,118,110,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5 dark:shadow-[0_12px_45px_-18px_rgba(8,145,178,0.4)] ${className}`}
    {...props}
  >
    <div className="absolute inset-0 bg-linear-to-br from-white/80 via-white/40 to-white/10 dark:from-white/10 dark:via-white/5 dark:to-transparent" />
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
        <div className="rounded-xl bg-linear-to-br from-emerald-500/10 to-teal-500/10 p-3 backdrop-blur-sm">
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
    className="group h-full"
  >
    <GlassCard className="flex h-full flex-col gap-4 p-6 transition-all duration-300 hover:bg-white/20 dark:hover:bg-white/10">
      <div className="mb-4 w-fit rounded-xl bg-linear-to-br from-emerald-500/10 to-teal-500/10 p-3 backdrop-blur-sm transition-all duration-300 group-hover:bg-linear-to-br group-hover:from-emerald-500/20 group-hover:to-teal-500/20">
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
    className="group h-full"
  >
    <GlassCard className="flex h-full flex-col p-6 transition-all duration-300 hover:bg-white/20 dark:hover:bg-white/10">
      <div className="mb-4 flex gap-1">
        {[...Array(rating)].map((_, i) => (
          <Star key={i} className="h-5 w-5 fill-current text-amber-400" />
        ))}
      </div>
      <p className="mb-4 text-slate-600 italic dark:text-slate-300">
        &quot;{text}&quot;
      </p>
      <div className="mt-auto flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-emerald-500/20 to-teal-500/20 font-medium text-slate-700 backdrop-blur-sm dark:text-slate-200">
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
      <div className="absolute inset-0 bg-linear-to-br from-emerald-50 via-white to-teal-50/50 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950/20" />
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
  const { user, loading } = useAuth();

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

  const logoSrc =
    theme === "dark"
      ? "/ConnvoLogos/Connvo-white.png"
      : "/ConnvoLogos/Connvo-black.png";

  return (
    <div className={`min-h-screen ${theme === "dark" ? "dark" : ""}`}>
      <div className="bg-white transition-colors duration-300 dark:bg-gray-900">
        {/* Modern Glass Nav */}
        <nav className="fixed top-0 z-50 w-full">
          <div className="mx-auto mt-6 w-full max-w-6xl px-6">
            <GlassCard className="w-full px-6 py-4">
              <div className="flex items-center">
                <div className="flex flex-1 items-center gap-3">
                  <Image
                    src={logoSrc}
                    alt="Connvo logo"
                    width={36}
                    height={36}
                    className="h-9 w-auto"
                    priority
                  />
                  <span className="text-2xl font-light tracking-tight text-slate-900 dark:text-white">
                    Connvo
                  </span>
                </div>

                <div className="hidden flex-1 items-center justify-center gap-8 md:flex">
                  {[
                    { label: "Features", id: "features" },
                    { label: "Testimonials", id: "testimonials" },
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

                <div className="flex flex-1 items-center justify-end gap-3">
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

          <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-32">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="mx-auto max-w-6xl text-center"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="mb-8 inline-block"
              >
                <GlassCard className="px-6 py-3">
                  <span className="bg-linear-to-r from-emerald-600 to-teal-600 bg-clip-text text-sm font-medium text-transparent dark:from-emerald-400 dark:to-teal-400">
                    People-first networking, at your fingertips
                  </span>
                </GlassCard>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.8 }}
                className="mb-8 text-4xl font-light tracking-tight text-slate-900 md:text-6xl lg:text-7xl dark:text-white"
              >
                Meet the people
                <br />
                <span className="bg-linear-to-r from-emerald-600 to-teal-700 bg-clip-text font-medium text-transparent dark:from-emerald-400 dark:to-teal-300">
                  you were meant to talk to.
                </span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.6 }}
                className="mx-auto mb-12 max-w-2xl text-xl leading-relaxed text-slate-600 dark:text-slate-300"
              >
                Connvo opens the door to intentional connections. Have authentic
                "coffee-chat" conversations with peers, mentors, and
                collaborators who align with your goals, interests, and
                personality.
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
                    Start Your First Connvo
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
        </section>

        {/* MacBook Scroll Component */}
        <MacbookScroll />

        {/* Improved Stats Section */}
        <section className="bg-linear-to-b from-emerald-50 to-white py-20 dark:from-gray-800/50 dark:to-gray-900">
          <div className="mx-auto w-full max-w-6xl px-6">
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
                value="10+"
                label="Conversations facilitated"
                delay={0.1}
              />
              <StatCard
                icon={Clock}
                value="90%"
                label="Schedule a second call"
                delay={0.2}
              />
              <StatCard
                icon={Activity}
                value="4.8/5"
                label="Average call satisfaction"
                delay={0.3}
              />
              <StatCard
                icon={Globe}
                value="5+"
                label="Countries Represented"
                delay={0.4}
              />
            </div>
          </div>
        </section>

        {/* Improved Features Section */}
        <section id="features" className="py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-16 max-w-3xl text-center"
            >
              <div className="mb-4 inline-block rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                Designed for meaningful conversations.
              </div>
              <h2 className="mb-6 text-4xl font-semibold text-gray-900 dark:text-white">
                Everything you need for intentional networking. No fluff, no
                humble brags.
              </h2>
              <p className="text-xl text-gray-600 dark:text-gray-300">
                Connvo guides every step—from your first intro to the follow-up
                message.
              </p>
            </motion.div>

            <div className="grid items-stretch gap-8 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  icon: Target,
                  title: "AI matching that understands people",
                  description:
                    "Proprietary models blend interests, goals, and complementary personalities to introduce the right people at the right moment.",
                },
                {
                  icon: Users,
                  title: "Connections beyond your bubble",
                  description:
                    "Discover peers, mentors, and collaborators you would never meet in existing networks or feeds.",
                },
                {
                  icon: Shield,
                  title: "Safety and compliance first",
                  description:
                    "SOC and FERPA-aligned guardrails, guided topics, and moderation tools keep every conversation respectful and secure.",
                },
                {
                  icon: MessageSquare,
                  title: "Guided coffee chats",
                  description:
                    "Dynamic icebreakers, suggested questions, and conversation prompts remove first-minute awkwardness.",
                },
                {
                  icon: Activity,
                  title: "Collaborative call workspace",
                  description:
                    "Shared notes, profiles, and action items live beside the call so everyone stays focused and aligned.",
                },
                {
                  icon: Phone,
                  title: "Seamless voice or video",
                  description:
                    "Launch high-quality calls instantly with hybrid WebRTC + GetStream performance that scales with your team.",
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
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-16 max-w-3xl text-center"
            >
              <div className="mb-4 inline-block rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                Teams and communities who tried Connvo
              </div>
              <h2 className="mb-6 text-4xl font-semibold text-gray-900 dark:text-white">
                Conversations people keep coming back for
              </h2>
              <p className="text-xl text-gray-600 dark:text-gray-300">
                Every pilot cohort highlighted deeper connections, faster
                follow-ups, and less awkward small talk.
              </p>
            </motion.div>

            <div className="grid items-stretch gap-8 md:grid-cols-3">
              {[
                {
                  name: "Sara G.",
                  role: "Startup Founder, ex-SWE",
                  text: "The personality quiz nailed the kind of people I needed to meet. Our first Connvo call turned into a weekly product strategy session.",
                  rating: 5,
                },
                {
                  name: "Alex T.",
                  role: "University Mentor",
                  text: "Connvo removes all the friction. Notes, follow-ups, and context are ready the moment the call ends—my mentees feel supported.",
                  rating: 5,
                },
                {
                  name: "Shrey S.",
                  role: "Student",
                  text: "As a student, Connvo is really tuff. I love matching with like-minded people, and working together on solving real problems.",
                  rating: 5,
                },
              ].map((testimonial, index) => (
                <TestimonialCard key={index} {...testimonial} index={index} />
              ))}
            </div>
          </div>
        </section>

        {/* Retention Data Visualization */}
        {/* <section className="py-20">
          <div className="mx-auto w-full max-w-6xl px-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto mb-12 max-w-3xl text-center"
            >
              <div className="mb-4 inline-block rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                Early cohort outcomes
              </div>
              <h2 className="mb-6 text-4xl font-semibold text-gray-900 dark:text-white">
                Relationships that keep moving forward
              </h2>
              <p className="text-xl text-gray-600 dark:text-gray-300">
                Connvo users return for follow-up conversations, driving 90%+ retention through meaningful matches.
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
        </section> */}

        {/* Primary CTA */}
        <section id="start" className="relative overflow-hidden py-28 sm:py-32">
          <div className="absolute inset-0 -z-20 bg-linear-to-br from-emerald-100/70 via-white/30 to-teal-100/60 dark:from-emerald-900/60 dark:via-slate-950/70 dark:to-emerald-950/60" />
          <div className="absolute inset-0 -z-10">
            <div className="absolute -top-40 left-1/4 h-[540px] w-[540px] rounded-full bg-emerald-200/50 blur-3xl dark:bg-emerald-500/25" />
            <div className="absolute -bottom-48 right-1/5 h-[520px] w-[520px] rounded-full bg-teal-300/45 blur-3xl dark:bg-teal-600/25" />
            <div className="absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30 blur-[160px] dark:bg-emerald-400/10" />
          </div>
          <div className="relative mx-auto w-full max-w-[1650px] px-4 sm:px-8 lg:px-12">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ amount: 0.35, once: true }}
              transition={{ duration: 0.7, ease: "easeOut" }}
            >
              <div className="relative w-full overflow-hidden rounded-2xl border border-white/60 bg-white/45 px-8 py-16 backdrop-blur-3xl backdrop-saturate-[1.35] sm:px-16 lg:px-24 dark:border-white/20 dark:bg-white/10">
                <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-white/60 via-white/20 to-transparent opacity-80 dark:from-white/15 dark:via-white/10" />
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute -top-16 left-0 h-52 w-52 -translate-x-1/3 rounded-full bg-emerald-300/40 blur-2xl dark:bg-emerald-500/20" />
                  <div className="absolute -bottom-12 right-6 h-48 w-48 translate-x-1/4 rounded-full bg-teal-300/35 blur-2xl dark:bg-teal-500/25" />
                </div>
                <div className="relative mx-auto max-w-4xl text-center">
                  <span className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-2 text-sm font-medium text-emerald-700 backdrop-blur-sm dark:bg-white/15 dark:text-emerald-200">
                    The next wave of intentional networking
                  </span>
                  <h2 className="mb-6 text-3xl font-semibold text-gray-900 sm:text-4xl md:text-5xl dark:text-white">
                    Ready to host coffee chats your community will remember?
                  </h2>
                  <p className="mx-auto mb-10 max-w-3xl text-lg text-slate-600 sm:text-xl dark:text-slate-300">
                    Launch Connvo for mentors, students, and teammates in minutes.
                    Curated matches, guided prompts, and follow-ups come standard—
                    so your people spend less time scheduling and more time connecting.
                  </p>
                  <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                    <StartCta
                      className="group relative overflow-hidden rounded-full px-10 py-4 text-base font-medium text-white transition-colors duration-300"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(16,185,129,1) 0%, rgba(13,148,136,1) 100%)",
                      }}
                    >
                      <span className="relative flex items-center gap-2">
                        Start in Private Beta
                        <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                      </span>
                    </StartCta>
                    <motion.a
                      href="/auth/sign-in"
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={(e) => handleTransition(e, "/auth/sign-in", router)}
                      className="flex items-center gap-2 rounded-full border border-emerald-200/70 bg-white/70 px-10 py-4 text-base font-medium text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-white/90 dark:border-emerald-400/30 dark:bg-white/10 dark:text-emerald-200 dark:hover:border-emerald-300/50 dark:hover:bg-emerald-500/10"
                    >
                      Talk to the team
                    </motion.a>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Improved Footer */}
        <footer className="border-t border-emerald-100 py-12 dark:border-gray-800">
          <div className="mx-auto w-full max-w-6xl px-6">
              <div className="flex flex-col items-center justify-between md:flex-row">
                <div className="mb-6 flex items-center gap-3 md:mb-0">
                  <Image
                    src={logoSrc}
                    alt="Connvo logo"
                    width={32}
                    height={32}
                    className="h-8 w-auto"
                  />
                <span className="text-xl font-medium text-gray-900 dark:text-white">
                  Connvo
                </span>
              </div>

              <div className="text-center text-gray-600 md:text-right dark:text-gray-300">
                © {new Date().getFullYear()} Connvo. All rights reserved.
                <div className="mt-1 text-sm">
                  Built to help every conversation feel intentional and human.
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
