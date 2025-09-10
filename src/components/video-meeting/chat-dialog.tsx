"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import type { Message } from "@/types/meeting";

interface ChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: Message[];
  onSendMessage: (message: string) => void;
}

export function ChatDialog({
  open,
  onOpenChange,
  messages,
  onSendMessage,
}: ChatDialogProps) {
  const [newMessage, setNewMessage] = useState("");

  const handleSend = () => {
    if (newMessage.trim()) {
      onSendMessage(newMessage);
      setNewMessage("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-900 sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-zinc-200">Chat</DialogTitle>
        </DialogHeader>
        <div className="flex h-[400px] flex-col">
          <ScrollArea className="flex-1 px-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`mb-4 ${msg.sender === "You" ? "ml-auto text-right" : ""}`}
              >
                <div className="mb-1 flex items-center space-x-2">
                  <span className="text-xs text-zinc-400">{msg.sender}</span>
                  <span className="text-xs text-zinc-500">{msg.timestamp}</span>
                </div>
                <div
                  className={`inline-block max-w-[80%] rounded-lg px-3 py-2 ${
                    msg.sender === "You"
                      ? "bg-blue-500 text-white"
                      : "bg-zinc-800 text-zinc-200"
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            ))}
          </ScrollArea>
          <div className="mt-4 border-t border-zinc-800 px-4 pt-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex space-x-2"
            >
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-lg border-none bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:ring-2 focus:ring-blue-500"
              />
              <Button
                type="submit"
                size="sm"
                className="bg-blue-500 hover:bg-blue-600"
              >
                Send
              </Button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
