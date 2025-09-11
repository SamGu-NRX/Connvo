import { Volume2 } from "lucide-react";
import { motion } from "motion/react";

export default function VolumeIndicator() {
  return (
    <motion.div
      className="absolute top-4 right-4 flex items-center space-x-2 rounded-full bg-gray-800/50 p-2 backdrop-blur-md"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1 }}
    >
      <Volume2 className="h-4 w-4 text-gray-300" />
      <div className="h-1 w-16 overflow-hidden rounded-full bg-gray-600">
        <motion.div
          className="h-full bg-green-500"
          initial={{ width: 0 }}
          animate={{ width: "70%" }}
          transition={{ delay: 1.2, duration: 0.5 }}
        />
      </div>
    </motion.div>
  );
}
