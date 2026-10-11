---
# kgu.one builds this project's page from this file (https://kgu.one/projects/connvo).
# When a change alters what the project does, its results, awards, stack or links,
# update this file in the same change. Rules:
# - Facts only, each one backed by this repo, the resume or a public source.
# - No em dashes and no middle dots.
# - line: at most 120 characters, ending in a period. What someone does or gets,
#   then one mechanism. No adjectives.
# - The body opens with one paragraph of 50 to 80 words, first person: what it is,
#   who used it, the hard part, one fact. The site uses it as the summary.
# - The rest of the body is the full write-up, in plain Markdown (## and ###
#   headings, lists, emphasis, inline code, https links), at most 1,500 words.
title: Connvo
kind: project
date: 2025-09
line: Coffee chats, without the cold email. Connvo pairs you with someone whose goals fit yours and hosts the video call.
stack: [Next.js, Convex, Stream]
links:
  - label: connvo.app
    href: https://connvo.app/
  - label: Code
    href: https://github.com/SamGu-NRX/Connvo
---

Connvo sets up one-on-one video coffee chats between people whose interests, goals and experience fit. You join a matching queue, it pairs you with someone and tells you why, and it hosts the call with shared notes and suggested prompts beside the video. I wrote most of its Convex backend, including the matching engine, and Andrew Wang built most of the Next.js front end. Its site is connvo.app.

Connvo is built around one conversation at a time, so a match has to be worth showing up for, and both people should be able to see why it was made.

## How a pair gets scored

The matching engine scores each pair on eight features, weighted by default like this:

- Shared interests, 25%
- Embedding similarity between the two profiles, 20%
- Experience gap, 15%, because a mentor and someone newer can both get something out of a chat
- Industry, time zone and language, 10% each
- Organization preferences and complementary roles, 5% each

The score comes back with plain-language reasons, such as “Strong interest alignment,” so the explanation travels with the match. The weights aren’t fixed. Accept, decline and completion outcomes feed an analysis that measures how well each feature predicts a successful match and proposes new weights from that.

You tell the queue when you’re free, and an entry expires on its own once that window passes. The queue is processed in shards, and match creation uses optimistic concurrency to prevent race conditions.

## The rest of the backend

Convex holds the database, the server functions and the realtime subscriptions. The front end and backend share Zod schemas and generated TypeScript types, so both sides check against the same definitions. Sign-in runs on WorkOS AuthKit. Calls run on the Stream Video SDK, with a browser WebRTC fallback. Profiles are embedded with OpenAI for the similarity feature.

Access control lives in the backend too. Meeting data sits behind permission guards that check who’s in the meeting, and data access is written to an audit log. The API reference regenerates from docstrings on the Convex functions.

The git history shows the split with Andrew. Most commits under `convex/` are mine, and most under `src/` are his.
