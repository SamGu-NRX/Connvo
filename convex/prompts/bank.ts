export type PromptStage =
  | "opener"
  | "shared-interest"
  | "career"
  | "going-deeper"
  | "wrap-up";

export interface BankPrompt {
  id: string;
  stage: PromptStage;
  tags: string[];
  content: string;
}

export const PROMPT_BANK: BankPrompt[] = [
  {
    id: "opener-small-highlight",
    stage: "opener",
    tags: ["general"],
    content: "What's been a small highlight of your week?",
  },
  {
    id: "opener-current-curiosity",
    stage: "opener",
    tags: ["general", "learning"],
    content: "What have you been curious about lately?",
  },
  {
    id: "opener-free-afternoon",
    stage: "opener",
    tags: ["general"],
    content: "If you had a free afternoon this week, how would you spend it?",
  },
  {
    id: "opener-good-recommendation",
    stage: "opener",
    tags: ["general"],
    content: "Have you come across anything lately you'd recommend?",
  },
  {
    id: "opener-chat-hopes",
    stage: "opener",
    tags: ["general"],
    content: "Was there anything you were hoping we'd get to talk about today?",
  },
  {
    id: "opener-repeat-song",
    stage: "opener",
    tags: ["music"],
    content: "Is there a song you've had on repeat lately?",
  },
  {
    id: "opener-reading-mood",
    stage: "opener",
    tags: ["books"],
    content:
      "What kind of reading do you tend to reach for when you have some time?",
  },
  {
    id: "opener-food-find",
    stage: "opener",
    tags: ["food"],
    content: "Have you tried any food lately that you'd happily have again?",
  },
  {
    id: "opener-nearby-place",
    stage: "opener",
    tags: ["travel", "community"],
    content:
      "Is there a place nearby you like to send people who are visiting?",
  },
  {
    id: "opener-useful-technology",
    stage: "opener",
    tags: ["technology"],
    content: "What's one bit of technology you actually enjoy using?",
  },
  {
    id: "opener-design-noticed",
    stage: "opener",
    tags: ["design", "art"],
    content: "Have you noticed anything well designed lately?",
  },
  {
    id: "opener-sports-interest",
    stage: "opener",
    tags: ["sports"],
    content: "What do you enjoy most about following or playing a sport?",
  },
  {
    id: "opener-science-question",
    stage: "opener",
    tags: ["science", "learning"],
    content: "Is there a science question you wish you knew the answer to?",
  },
  {
    id: "opener-creative-time",
    stage: "opener",
    tags: ["art", "design"],
    content: "What do you like to make when you're in a creative mood?",
  },
  {
    id: "opener-new-experience",
    stage: "opener",
    tags: ["general", "learning"],
    content: "Is there something you'd like to try for the first time?",
  },

  {
    id: "shared-interest-first-spark",
    stage: "shared-interest",
    tags: ["general"],
    content: "How did you first get interested in that?",
  },
  {
    id: "shared-interest-starting-point",
    stage: "shared-interest",
    tags: ["general", "learning"],
    content:
      "Where would you tell someone to start if they wanted to get into it?",
  },
  {
    id: "shared-interest-surprising-part",
    stage: "shared-interest",
    tags: ["general"],
    content: "What's a part of it that people tend to overlook?",
  },
  {
    id: "shared-interest-next-to-explore",
    stage: "shared-interest",
    tags: ["general", "learning"],
    content: "What would you like to explore next within that interest?",
  },
  {
    id: "shared-interest-music-discovery",
    stage: "shared-interest",
    tags: ["music"],
    content: "How do you usually find new music you like?",
  },
  {
    id: "shared-interest-book-conversation",
    stage: "shared-interest",
    tags: ["books"],
    content:
      "Is there a book you wish you had more people to talk about it with?",
  },
  {
    id: "shared-interest-travel-pace",
    stage: "shared-interest",
    tags: ["travel"],
    content:
      "When you explore somewhere new, do you like having a plan or seeing where the day goes?",
  },
  {
    id: "shared-interest-food-tradition",
    stage: "shared-interest",
    tags: ["food"],
    content: "Is there a dish you enjoy hearing other people's versions of?",
  },
  {
    id: "shared-interest-design-detail",
    stage: "shared-interest",
    tags: ["design"],
    content:
      "What design detail do you notice that most people probably walk past?",
  },
  {
    id: "shared-interest-technology-experiment",
    stage: "shared-interest",
    tags: ["technology"],
    content:
      "Is there a tool or piece of technology you've been wanting to try?",
  },
  {
    id: "shared-interest-sports-draw",
    stage: "shared-interest",
    tags: ["sports"],
    content:
      "What's a moment in a sport that makes you stop and pay attention?",
  },
  {
    id: "shared-interest-science-discovery",
    stage: "shared-interest",
    tags: ["science"],
    content: "What's a scientific idea you enjoyed finding out about?",
  },
  {
    id: "shared-interest-art-taste",
    stage: "shared-interest",
    tags: ["art"],
    content: "What tends to make a piece of art stay with you?",
  },
  {
    id: "shared-interest-business-observation",
    stage: "shared-interest",
    tags: ["entrepreneurship"],
    content:
      "Is there a small business you think does something especially well?",
  },
  {
    id: "shared-interest-community-spaces",
    stage: "shared-interest",
    tags: ["community"],
    content: "What makes a group or gathering worth coming back to for you?",
  },

  {
    id: "career-current-focus",
    stage: "career",
    tags: ["general"],
    content:
      "What's taking up most of your attention these days, work or otherwise?",
  },
  {
    id: "career-path-curiosity",
    stage: "career",
    tags: ["general"],
    content: "How did you find your way to what you're doing now?",
  },
  {
    id: "career-enjoyable-part",
    stage: "career",
    tags: ["general"],
    content: "Which parts of what you do tend to be the most enjoyable?",
  },
  {
    id: "career-unexpected-reality",
    stage: "career",
    tags: ["general"],
    content:
      "What's something about your field that surprised you once you got closer to it?",
  },
  {
    id: "career-exploring-options",
    stage: "career",
    tags: ["general", "learning"],
    content: "Is there a kind of work you're curious to learn more about?",
  },
  {
    id: "career-useful-skill",
    stage: "career",
    tags: ["general", "learning"],
    content:
      "What's a skill you've found useful in more places than you expected?",
  },
  {
    id: "career-good-collaboration",
    stage: "career",
    tags: ["general", "community"],
    content: "What helps you enjoy working with someone?",
  },
  {
    id: "career-project-choice",
    stage: "career",
    tags: ["general"],
    content:
      "What makes a project interesting enough for you to want to spend time on it?",
  },
  {
    id: "career-learning-method",
    stage: "career",
    tags: ["learning"],
    content:
      "When you need to learn something new, what usually helps it click?",
  },
  {
    id: "career-technology-tradeoff",
    stage: "career",
    tags: ["technology"],
    content:
      "When you're choosing a tool for a project, what matters most to you?",
  },
  {
    id: "career-design-process",
    stage: "career",
    tags: ["design", "art"],
    content:
      "When you're making something, how do you decide it's ready to share?",
  },
  {
    id: "career-business-problem",
    stage: "career",
    tags: ["entrepreneurship"],
    content:
      "Is there an everyday problem you'd enjoy building a business around?",
  },
  {
    id: "career-science-work",
    stage: "career",
    tags: ["science"],
    content: "What kind of scientific work would you like to see up close?",
  },
  {
    id: "career-advice-that-stuck",
    stage: "career",
    tags: ["general"],
    content:
      "Have you heard any advice about work that turned out to be useful?",
  },
  {
    id: "career-room-to-try",
    stage: "career",
    tags: ["general", "learning"],
    content:
      "If you could try a different kind of work for a week, what would you pick?",
  },

  {
    id: "going-deeper-changing-taste",
    stage: "going-deeper",
    tags: ["general"],
    content: "Has your taste in anything changed in a way that surprised you?",
  },
  {
    id: "going-deeper-good-conversation",
    stage: "going-deeper",
    tags: ["general", "community"],
    content: "What makes a conversation feel worth having to you?",
  },
  {
    id: "going-deeper-quiet-pride",
    stage: "going-deeper",
    tags: ["general"],
    content:
      "Is there something you've made or learned that you're especially pleased with?",
  },
  {
    id: "going-deeper-reconsidered-idea",
    stage: "going-deeper",
    tags: ["general", "learning"],
    content:
      "Have you come across an idea lately that made you reconsider something?",
  },
  {
    id: "going-deeper-time-well-spent",
    stage: "going-deeper",
    tags: ["general"],
    content: "What makes a day feel like time well spent for you?",
  },
  {
    id: "going-deeper-keep-learning",
    stage: "going-deeper",
    tags: ["learning"],
    content:
      "What keeps you interested in something after the early excitement wears off?",
  },
  {
    id: "going-deeper-music-memory",
    stage: "going-deeper",
    tags: ["music"],
    content:
      "Is there music you hear differently now than when you first found it?",
  },
  {
    id: "going-deeper-book-perspective",
    stage: "going-deeper",
    tags: ["books"],
    content: "Has something you've read changed what you pay attention to?",
  },
  {
    id: "going-deeper-place-perspective",
    stage: "going-deeper",
    tags: ["travel", "community"],
    content:
      "Has spending time somewhere different changed what you appreciate about a place?",
  },
  {
    id: "going-deeper-food-connection",
    stage: "going-deeper",
    tags: ["food", "community"],
    content: "What do you think makes a meal with other people memorable?",
  },
  {
    id: "going-deeper-technology-boundaries",
    stage: "going-deeper",
    tags: ["technology"],
    content: "Is there something you prefer doing without technology?",
  },
  {
    id: "going-deeper-design-priorities",
    stage: "going-deeper",
    tags: ["design"],
    content: "What's something you wish more designers paid attention to?",
  },
  {
    id: "going-deeper-sports-lessons",
    stage: "going-deeper",
    tags: ["sports", "learning"],
    content:
      "Has following or playing a sport changed how you think about getting better at something?",
  },
  {
    id: "going-deeper-art-questions",
    stage: "going-deeper",
    tags: ["art"],
    content:
      "Do you enjoy art more when it answers a question or leaves you with one?",
  },
  {
    id: "going-deeper-business-values",
    stage: "going-deeper",
    tags: ["entrepreneurship", "community"],
    content: "What makes you want a particular business to do well?",
  },

  {
    id: "wrap-up-unasked-question",
    stage: "wrap-up",
    tags: ["general"],
    content: "Is there anything you wanted to ask before we finish?",
  },
  {
    id: "wrap-up-unfinished-thread",
    stage: "wrap-up",
    tags: ["general"],
    content: "Was there a topic we touched on that you'd like to come back to?",
  },
  {
    id: "wrap-up-recommendation-swap",
    stage: "wrap-up",
    tags: ["general"],
    content: "Would you like to swap one recommendation before we go?",
  },
  {
    id: "wrap-up-looking-ahead",
    stage: "wrap-up",
    tags: ["general"],
    content:
      "What's something you're looking forward to in the next few weeks?",
  },
  {
    id: "wrap-up-next-chat",
    stage: "wrap-up",
    tags: ["general"],
    content: "If we talk again, what would be fun to pick up next time?",
  },
  {
    id: "wrap-up-stay-in-touch",
    stage: "wrap-up",
    tags: ["general", "community"],
    content: "Would you like to stay in touch after this?",
  },
  {
    id: "wrap-up-music-swap",
    stage: "wrap-up",
    tags: ["music"],
    content: "Want to leave each other with a song to listen to?",
  },
  {
    id: "wrap-up-reading-list",
    stage: "wrap-up",
    tags: ["books"],
    content: "Is there something you'd suggest I add to my reading list?",
  },
  {
    id: "wrap-up-place-to-save",
    stage: "wrap-up",
    tags: ["travel"],
    content: "What's one place you'd suggest I keep in mind for a future trip?",
  },
  {
    id: "wrap-up-food-recommendation",
    stage: "wrap-up",
    tags: ["food"],
    content: "Is there a dish or a food spot you'd recommend I try?",
  },
  {
    id: "wrap-up-design-reference",
    stage: "wrap-up",
    tags: ["design", "art"],
    content: "Is there a designer or artist you think I should look up?",
  },
  {
    id: "wrap-up-tool-to-try",
    stage: "wrap-up",
    tags: ["technology"],
    content: "Is there a tool you'd suggest I try after this conversation?",
  },
  {
    id: "wrap-up-learning-resource",
    stage: "wrap-up",
    tags: ["learning", "science"],
    content:
      "Is there a good place to read more about what we were discussing?",
  },
  {
    id: "wrap-up-sports-watch",
    stage: "wrap-up",
    tags: ["sports"],
    content: "Is there an upcoming game or event you'd recommend watching?",
  },
  {
    id: "wrap-up-community-find",
    stage: "wrap-up",
    tags: ["community", "entrepreneurship"],
    content: "Is there a group or event you'd recommend checking out?",
  },
];
