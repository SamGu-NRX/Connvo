import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Moon, Sun } from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: "light" | "dark";
  onThemeChange: (theme: "light" | "dark") => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-[400px] ${
        theme === "dark"
          ? "border-zinc-800 bg-zinc-900"
          : "border-zinc-200 bg-white"
      }`}>
        <DialogHeader>
          <DialogTitle className={theme === "dark" ? "text-zinc-200" : "text-zinc-800"}>Call Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className={theme === "dark" ? "text-zinc-200" : "text-zinc-800"}>Video Quality</Label>
              <p className={`text-xs ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`}>Adjust video resolution</p>
            </div>
            <Select defaultValue="720p">
              <SelectTrigger className={`w-24 ${
                theme === "dark"
                  ? "border-zinc-700 bg-zinc-800"
                  : "border-zinc-300 bg-zinc-100"
              }`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={theme === "dark" ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-white"}>
                <SelectItem value="1080p">1080p</SelectItem>
                <SelectItem value="720p">720p</SelectItem>
                <SelectItem value="480p">480p</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className={theme === "dark" ? "text-zinc-200" : "text-zinc-800"}>Noise Suppression</Label>
              <p className={`text-xs ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`}>Reduce background noise</p>
            </div>
            <Switch className="data-[state=checked]:bg-blue-500" />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className={theme === "dark" ? "text-zinc-200" : "text-zinc-800"}>Auto-gain Control</Label>
              <p className={`text-xs ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`}>
                Automatically adjust mic volume
              </p>
            </div>
            <Switch className="data-[state=checked]:bg-blue-500" />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className={theme === "dark" ? "text-zinc-200" : "text-zinc-800"}>Theme</Label>
              <p className={`text-xs ${theme === "dark" ? "text-zinc-400" : "text-zinc-600"}`}>Choose light or dark mode</p>
            </div>
            <div className="flex items-center space-x-2">
              <Sun
                className={`h-4 w-4 ${theme === "light" ? "text-yellow-400" : "text-zinc-600"}`}
              />
              <Switch
                checked={theme === "dark"}
                onCheckedChange={(checked) =>
                  onThemeChange(checked ? "dark" : "light")
                }
                className="data-[state=checked]:bg-blue-500"
              />
              <Moon
                className={`h-4 w-4 ${theme === "dark" ? "text-blue-400" : "text-zinc-600"}`}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
