"use client";
import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Clock,
  Lightbulb,
  ChevronRight,
  ChevronLeft,
  Mic,
  Video,
  PhoneOff,
  MessageSquare,
  MicOff,
  VideoOff,
  Plus,
  PenLine,
  User,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { TopBar } from "@/components/video-meeting/top-bar";
import { VideoArea } from "@/components/video-meeting/video-area";
import { ChatDialog } from "@/components/video-meeting/chat-dialog";
import { EndCallDialog } from "@/components/video-meeting/end-call-dialog";
import UserCard from "@/components/mvp/user-card";
import AfterCallScreen from "@/components/mvp/after-call-screen";
import {
  MOCK_USERS,
  MOCK_SPEAKING_STATES,
  simulateSpeaking,
  MOCK_CONNECTION_STATES,
} from "@/types/meeting";
import { TimeManager } from "@/components/video-meeting/time-manager";
import { SettingsDialog } from "@/components/video-meeting/settings-dialog";
import { ToastContainer } from "@/components/video-meeting/toast";

// FIGURE OUT HOW TO BUILD REAL-TIME

const userInterests = {
  user1: ["photography", "travel", "tech startups", "AI", "blockchain"],
  user2: ["sustainable design", "meditation", "indie games", "yoga", "writing"],
};

const generatePrompts = (interests1: string[], interests2: string[]) => [
  `How has your journey with ${interests1[0]} influenced your perspective on ${interests2[0]}?`,
  `What parallels do you see between ${interests1[1]} and ${interests2[1]}?`,
  `How do you think ${interests1[2]} could benefit from principles of ${interests2[2]}?`,
  "What's the most surprising connection you've discovered between our fields?",
];

const MOCK_MESSAGES = [
  { id: "1", sender: "John Doe", message: "Hey there!", timestamp: "10:30 AM" },
  {
    id: "2",
    sender: "You",
    message: "Hi! Ready to discuss?",
    timestamp: "10:31 AM",
  },
];

export default function VideoMeeting() {
  const LS_KEYS = {
    MESSAGES: "connvo:call:messages",
    NOTES: "connvo:call:notes",
    MUTED: "connvo:call:muted",
    VIDEO_OFF: "connvo:call:videoOff",
    TIME_REMAINING: "connvo:call:timeRemaining",
    ACTIVE_VIDEO: "connvo:call:activeVideo",
  };

  const [timeManager] = useState(() => new TimeManager());
  const [timeRemaining, setTimeRemaining] = useState(() => {
    try {
      const v = localStorage.getItem(LS_KEYS.TIME_REMAINING);
      return v ? Number(v) : timeManager.getRemainingTime();
    } catch {
      return timeManager.getRemainingTime();
    }
  });
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [showTimeLeft, setShowTimeLeft] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState(0);
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem(LS_KEYS.MUTED) === "true";
    } catch {
      return false;
    }
  });
  const [isVideoOff, setIsVideoOff] = useState(() => {
    try {
      return localStorage.getItem(LS_KEYS.VIDEO_OFF) === "true";
    } catch {
      return false;
    }
  });
  const [isChatOpen, setIsChatOpen] = useState(false);
  // Defer reading localStorage until client mount to avoid SSR/client hydration mismatch
  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEYS.ACTIVE_VIDEO);
      if (raw === null) return;
      try {
        const parsed = JSON.parse(raw);
        setActiveVideo(parsed === null ? null : String(parsed));
      } catch {
        setActiveVideo(raw === "null" ? null : raw);
      }
    } catch {}
  }, []);
  const [showTimeAddedToast, setShowTimeAddedToast] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAlmostOutOfTime, setIsAlmostOutOfTime] = useState(false);
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEYS.MESSAGES);
      return raw ? JSON.parse(raw) : MOCK_MESSAGES;
    } catch {
      return MOCK_MESSAGES;
    }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddTimeRequestOpen, setIsAddTimeRequestOpen] = useState(false);
  const [addTimeRequester, setAddTimeRequester] = useState<string | null>(null);
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(LS_KEYS.NOTES) || "";
    } catch {
      return "";
    }
  });
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [speakingStates, setSpeakingStates] = useState(MOCK_SPEAKING_STATES);
  const [isEndCallOpen, setIsEndCallOpen] = useState(false);
  const [isCallEnded, setIsCallEnded] = useState(false);
  const [currentTimeRequest, setCurrentTimeRequest] = useState(null);
  const [isLeaveRequestPending, setIsLeaveRequestPending] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [activeTab, setActiveTab] = useState<"profile" | "notes">("profile");

  // Helpers: persist small pieces of state to localStorage
  const persist = (key: string, value: any) => {
    try {
      localStorage.setItem(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    } catch {}
  };

  const sendMessage = (message: string, sender = "You") => {
    const msg = {
      id: String(Date.now()),
      sender,
      message,
      timestamp: "Now",
    };
    setMessages((prev: any[]) => {
      const next = [...prev, msg];
      persist(LS_KEYS.MESSAGES, next);
      return next;
    });

    // If this is a user message, simulate partner auto-response
    if (sender === "You") {
      setTimeout(
        () => {
          const reply = {
            id: String(Date.now() + 1),
            sender: MOCK_USERS.partner.name,
            message: [
              "Nice!",
              "Thanks for that.",
              "Great point!",
              "Love that idea.",
            ][Math.floor(Math.random() * 4)],
            timestamp: "Now",
          };
          setMessages((prev: any[]) => {
            const next = [...prev, reply];
            persist(LS_KEYS.MESSAGES, next);
            return next;
          });
        },
        1200 + Math.floor(Math.random() * 1500),
      );
    }
  };

  const toggleMute = () => {
    setIsMuted((prev) => {
      const v = !prev;
      persist(LS_KEYS.MUTED, String(v));
      return v;
    });
  };

  const toggleVideo = () => {
    setIsVideoOff((prev) => {
      const v = !prev;
      persist(LS_KEYS.VIDEO_OFF, String(v));
      return v;
    });
  };

  // Ensure other interactive state is persisted
  useEffect(() => persist(LS_KEYS.NOTES, notes), [notes]);
  useEffect(() => persist(LS_KEYS.MESSAGES, messages), [messages]);
  useEffect(
    () => persist(LS_KEYS.TIME_REMAINING, timeRemaining),
    [timeRemaining],
  );
  useEffect(() => persist(LS_KEYS.ACTIVE_VIDEO, activeVideo), [activeVideo]);

  const prompts = generatePrompts(userInterests.user1, userInterests.user2);

  useEffect(() => {
    const timer = setInterval(() => {
      timeManager.decrementTime();
      setTimeRemaining(timeManager.getRemainingTime());
      setTimeElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timeManager]);

  useEffect(() => {
    // Check if time remaining is less than 1 minute
    if (timeRemaining <= 60 && timeRemaining > 0) {
      setShowTimeLeft(true);
      setIsAlmostOutOfTime(true);
    } else {
      setIsAlmostOutOfTime(false);
    }
  }, [timeRemaining]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSpeakingStates(simulateSpeaking());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleVideoClick = (userId: string) => {
    setActiveVideo((prev) => (prev === userId ? null : userId));
  };
  const addTime = () => {
    setTimeRemaining((prev) => prev + 300); // 300 seconds
    setShowTimeAddedToast(true);
    setTimeout(() => setShowTimeAddedToast(false), 3000);
  };

  const handleSidebarToggle = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const handleSendMessage = (message: string) => {
    sendMessage(message, "You");
  };

  const handleEndCall = useCallback(() => {
    setIsEndCallOpen(false);
    setIsLeaveRequestPending(true);

    window.addToast({
      message: "Leave request sent to John Doe",
      type: "info",
      icon: PhoneOff,
    });

    // Simulate partner response after a short delay and then end the call locally
    setTimeout(
      () => {
        setIsLeaveRequestPending(false);
        window.addToast({
          message: "John Doe approved your leave request",
          type: "success",
          icon: PhoneOff,
        });
        // End the simulated call locally and show after-call screen
        setIsCallEnded(true);
        // Cleanup localStorage for call-related keys
        try {
          Object.values(LS_KEYS).forEach((k) => localStorage.removeItem(k));
        } catch {}
      },
      1500 + Math.floor(Math.random() * 1000),
    );
  }, []);

  const handleAcceptTimeRequest = () => {
    addTime();
    setCurrentTimeRequest(null);
  };

  const handleTimeRequest = useCallback(() => {
    if (!timeManager.canRequestTime()) {
      window.addToast({
        message: "You can only request time every 5 minutes",
        type: "error",
        duration: 3000,
      });
      return;
    }

    window.addToast({
      message: "Time extension request sent",
      type: "info",
      icon: Clock,
    });

    // Simulate partner response/approval after a short delay
    setTimeout(
      () => {
        const success = timeManager.addTime();
        if (success) {
          const addedMsg = timeManager.getTimeAddedMessage();
          window.addToast({
            message: addedMsg,
            type: "success",
            icon: Clock,
          });
          const newRemaining = timeManager.getRemainingTime();
          setTimeRemaining(newRemaining);
          persist("connvo:call:timeRemaining", newRemaining);
        } else {
          window.addToast({
            message: "Partner denied the request",
            type: "error",
          });
        }
      },
      1500 + Math.floor(Math.random() * 1500),
    );
  }, [timeManager]);

  if (isCallEnded) {
    // This is a demo page - pass a placeholder ID
    // In real implementation, this would come from the URL params
    return <AfterCallScreen meetingId={"demo_meeting" as any} />;
  }

  return (
    <div
      className={`flex h-screen flex-col ${theme === "dark" ? "bg-zinc-950" : "bg-zinc-50"}`}
    >
      <TopBar
        partner={MOCK_USERS.partner}
        timeElapsed={timeElapsed}
        timeRemaining={timeRemaining}
        showTimeLeft={showTimeLeft}
        isAlmostOutOfTime={isAlmostOutOfTime}
        isSidebarOpen={isSidebarOpen}
        onToggleTimeDisplay={() => setShowTimeLeft(!showTimeLeft)}
        onToggleSidebar={handleSidebarToggle}
        onOpenSettings={() => setIsSettingsOpen(true)}
        theme={theme}
      />

      <div className="relative flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "tween", duration: 0.2 }}
              className={`sidebar z-10 flex w-80 flex-col space-y-4 overflow-y-auto border-r p-4 backdrop-blur-lg ${
                theme === "dark"
                  ? "border-zinc-800 bg-zinc-900/70"
                  : "border-zinc-200 bg-white/70"
              }`}
            >
              {/* Tab Navigation */}
              <div className="flex gap-2 shrink-0">
                <Button
                  variant={activeTab === "profile" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("profile")}
                  className="flex-1"
                >
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </Button>
                <Button
                  variant={activeTab === "notes" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setActiveTab("notes")}
                  className="flex-1"
                >
                  <PenLine className="mr-2 h-4 w-4" />
                  Notes
                </Button>
              </div>

              {/* Tab Content */}
              <AnimatePresence mode="wait">
                {activeTab === "profile" ? (
                  <motion.div
                    key="profile"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col space-y-4 flex-1 min-h-0"
                  >
                    {/* User Card */}
                    <div className="shrink-0">
                      <UserCard
                        user={{
                          id: "match123",
                          name: "Jane Doe",
                          avatar: null,
                          bio: "Software Engineer | AI Enthusiast",
                          profession: "Software Engineer",
                          company: "TechCorp Inc.",
                          school: "Stanford University",
                          experience: 5,
                          sharedInterests: [
                            { type: "academic" as const, name: "Machine Learning" },
                            { type: "industry" as const, name: "Open Source" },
                            { type: "skill" as const, name: "Hiking" },
                          ],
                          connectionType: "collaboration",
                          isBot: false,
                          status: "online",
                          connectionStatus:
                            MOCK_CONNECTION_STATES[MOCK_USERS.partner.id]?.status ===
                            "excellent"
                              ? "excellent"
                              : MOCK_CONNECTION_STATES[MOCK_USERS.partner.id]
                                    ?.status === "good"
                                ? "good"
                                : "poor",
                          isSpeaking:
                            MOCK_SPEAKING_STATES[MOCK_USERS.partner.id] || false,
                        }}
                        inMeeting={true}
                        forceVisible={true}
                      />
                    </div>
                    
                    {/* Compact Prompts Card */}
                    <Card className={`shrink-0 border-none ${theme === "dark" ? "bg-zinc-800/30 shadow-lg" : "bg-zinc-100/50"}`}>
                      <CardContent className="p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Lightbulb className="h-4 w-4 text-amber-400" />
                            <h3 className={`text-xs font-medium ${theme === "dark" ? "text-zinc-300" : "text-zinc-700"}`}>
                              Discussion Prompt
                            </h3>
                          </div>
                          <div className="flex space-x-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setCurrentPrompt((prev) => Math.max(0, prev - 1))
                              }
                              disabled={currentPrompt === 0}
                              className={`h-6 w-6 ${theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-zinc-200"}`}
                            >
                              <ChevronLeft className={`h-3 w-3 ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setCurrentPrompt((prev) =>
                                  Math.min(prompts.length - 1, prev + 1),
                                )
                              }
                              disabled={currentPrompt === prompts.length - 1}
                              className={`h-6 w-6 ${theme === "dark" ? "hover:bg-zinc-700" : "hover:bg-zinc-200"}`}
                            >
                              <ChevronRight className={`h-3 w-3 ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`} />
                            </Button>
                          </div>
                        </div>
                        <Separator className={`my-2 ${theme === "dark" ? "bg-zinc-700" : "bg-zinc-300"}`} />
                        <AnimatePresence mode="wait">
                          <motion.p
                            key={currentPrompt}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className={`text-xs leading-relaxed ${theme === "dark" ? "text-zinc-300" : "text-zinc-700"}`}
                          >
                            {prompts[currentPrompt]}
                          </motion.p>
                        </AnimatePresence>
                      </CardContent>
                    </Card>
                  </motion.div>
                ) : (
                  <motion.div
                    key="notes"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.2 }}
                    className="flex-1 min-h-0"
                  >
                    <Card className={`h-full border-none ${theme === "dark" ? "bg-zinc-800/30 shadow-lg" : "bg-zinc-100/50"}`}>
                      <CardContent className="flex h-full flex-col p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <PenLine className={`h-4 w-4 ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`} />
                            <h3 className={`text-xs font-medium ${theme === "dark" ? "text-zinc-300" : "text-zinc-700"}`}>
                              Meeting Notes
                            </h3>
                          </div>
                          <AnimatePresence>
                            {isAutosaving && (
                              <motion.span
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className={`text-xs ${theme === "dark" ? "text-zinc-500" : "text-zinc-400"}`}
                              >
                                Saving...
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </div>
                        <Separator className={`my-2 ${theme === "dark" ? "bg-zinc-700" : "bg-zinc-300"}`} />
                        <textarea
                          value={notes}
                          onChange={(e) => {
                            setNotes(e.target.value);
                            setIsAutosaving(true);
                            // Simulate autosave
                            setTimeout(() => setIsAutosaving(false), 1000);
                          }}
                          placeholder="Type your notes here..."
                          className={`min-h-0 flex-1 w-full resize-none border-none bg-transparent text-sm focus:outline-none focus:ring-0 ${
                            theme === "dark"
                              ? "text-zinc-300 placeholder:text-zinc-600"
                              : "text-zinc-700 placeholder:text-zinc-400"
                          }`}
                        />
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <motion.div
          layout
          className={`main-content relative flex-1 p-4 ${isSidebarOpen ? "" : "ml-0"}`}
        >
          <VideoArea
            activeVideo={activeVideo}
            users={MOCK_USERS}
            speakingStates={speakingStates}
            connectionStates={MOCK_CONNECTION_STATES}
            onVideoClick={handleVideoClick}
            isMuted={isMuted}
            isVideoOff={isVideoOff}
            theme={theme}
          />

          {/* Control Bar */}
          <TooltipProvider>
            <motion.div className={`absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center space-x-3 rounded-2xl p-2 shadow-xl backdrop-blur-xs ${
              theme === "dark" ? "bg-zinc-900/70" : "bg-white/70"
            }`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isMuted ? "destructive" : "secondary"}
                    size="icon"
                    onClick={toggleMute}
                    className={`h-11 w-11 rounded-full transition-all duration-200 ${
                      isMuted
                        ? "bg-red-500/90 text-white hover:bg-red-600"
                        : theme === "dark"
                          ? "bg-zinc-700/90 text-zinc-100 hover:bg-zinc-600"
                          : "bg-zinc-200/90 text-zinc-700 hover:bg-zinc-300"
                    }`}
                  >
                    {isMuted ? (
                      <MicOff className="h-5 w-5" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{isMuted ? "Unmute" : "Mute"}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={isVideoOff ? "destructive" : "secondary"}
                    size="icon"
                    onClick={toggleVideo}
                    className={`h-11 w-11 rounded-full transition-all duration-200 ${
                      isVideoOff
                        ? "bg-red-500/90 text-white hover:bg-red-600"
                        : theme === "dark"
                          ? "bg-zinc-700/90 text-zinc-100 hover:bg-zinc-600"
                          : "bg-zinc-200/90 text-zinc-700 hover:bg-zinc-300"
                    }`}
                  >
                    {isVideoOff ? (
                      <VideoOff className="h-5 w-5" />
                    ) : (
                      <Video className="h-5 w-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    {isVideoOff ? "Start Video" : "Stop Video"}
                  </p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setIsChatOpen(true)}
                    className={`h-11 w-11 rounded-full ${
                      theme === "dark"
                        ? "bg-zinc-700/90 text-zinc-100 hover:bg-zinc-600"
                        : "bg-zinc-200/90 text-zinc-700 hover:bg-zinc-300"
                    }`}
                  >
                    <MessageSquare className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Chat</p>
                </TooltipContent>
              </Tooltip>

              <Separator orientation="vertical" className={`h-8 ${theme === "dark" ? "bg-zinc-600" : "bg-zinc-300"}`} />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => {
                      setAddTimeRequester("You");
                      setIsAddTimeRequestOpen(true);
                      handleTimeRequest();
                    }}
                    className={`h-11 w-11 rounded-full ${
                      theme === "dark"
                        ? "bg-zinc-700/90 text-zinc-100 hover:bg-zinc-600"
                        : "bg-zinc-200/90 text-zinc-700 hover:bg-zinc-300"
                    }`}
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Request More Time</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => setIsEndCallOpen(true)}
                    className="h-11 w-11 rounded-full bg-red-500/90 text-white hover:bg-red-600"
                  >
                    <PhoneOff className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">End Call</p>
                </TooltipContent>
              </Tooltip>
            </motion.div>
          </TooltipProvider>

          {/* Time Added Toast */}
          <AnimatePresence>
            {showTimeAddedToast && (
              <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 50 }}
                className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center space-x-2 rounded-full bg-emerald-500 px-4 py-2 text-white shadow-lg"
              >
                <Clock className="h-4 w-4" />
                <span className="text-sm">Added 5 minutes</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Dialogs and Toasts */}
        <ChatDialog
          open={isChatOpen}
          onOpenChange={setIsChatOpen}
          messages={messages}
          onSendMessage={(message) => sendMessage(message, "You")}
          theme={theme}
        />
        <EndCallDialog
          open={isEndCallOpen}
          onOpenChange={setIsEndCallOpen}
          onConfirm={handleEndCall}
          theme={theme}
        />
        <SettingsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          theme={theme}
          onThemeChange={setTheme}
        />
        <ToastContainer />
      </div>
    </div>
  );
}
