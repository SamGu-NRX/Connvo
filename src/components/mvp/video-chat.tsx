import Image from "next/image";
import { Card } from "@/components/ui/card";
import { motion } from "motion/react";
import VolumeIndicator from "./volume-indicator";

export default function VideoChat() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
      <Card className="relative aspect-video w-full max-w-4xl overflow-hidden shadow-2xl">
        <Image
          src="/placeholder.svg?height=720&width=1280&text=Partner"
          alt="Partner"
          layout="fill"
          objectFit="cover"
          className="brightness-95 filter"
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute bottom-4 left-4 rounded-full bg-black/50 px-3 py-1 text-sm"
        >
          Partner
        </motion.div>
        <VolumeIndicator />
      </Card>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3 }}
        className="absolute right-8 bottom-8 aspect-video w-48"
      >
        <Card className="h-full w-full overflow-hidden shadow-xl">
          <Image
            src="/placeholder.svg?height=270&width=480&text=You"
            alt="You"
            layout="fill"
            objectFit="cover"
            className="brightness-95 filter"
          />
          <div className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-1 text-xs">
            You
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
