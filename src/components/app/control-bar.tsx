import { Mic, Video, PhoneOff, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "motion/react";

export default function ControlBar() {
  return (
    <motion.div
      className="flex space-x-2 rounded-full bg-gray-800/50 p-2 backdrop-blur-md"
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 400, damping: 10 }}
    >
      <Button variant="ghost" size="icon" className="rounded-full">
        <Mic className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" className="rounded-full">
        <Video className="h-5 w-5" />
      </Button>
      <Button variant="destructive" size="icon" className="rounded-full">
        <PhoneOff className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" className="rounded-full">
        <MessageSquare className="h-5 w-5" />
      </Button>
    </motion.div>
  );
}
