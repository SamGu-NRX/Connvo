---
# kgu.one builds this project's page from this file (https://kgu.one/projects/connvo).
# When a change alters what the project does, its results, awards, stack or links,
# update this file in the same change. Rules:
# - Facts only, each one backed by this repo, the resume or a public source.
# - No em dashes and no middle dots.
# - line: at most 120 characters, ending in a period. What someone does or gets,
#   then one mechanism. No adjectives.
# - The paragraph after this header: 50 to 80 words, first person. What it is, who
#   used it, the hard part, one fact.
title: Connvo
kind: project
date: 2025-09
line: Pairs you with someone worth a coffee chat and hosts the video call.
stack: [Next.js, Convex, Stream]
links:
  - label: connvo.app
    href: https://connvo.app/
  - label: Code
    href: https://github.com/SamGu-NRX/Connvo
---

Connvo sets up one-on-one video coffee chats between people whose interests, goals and experience fit. With Andrew Wang, I wrote most of its Convex backend. The matching queue scores each pair on shared interests, complementary experience and roles, and embedding similarity, then explains the score. Calls run on Stream video, sign-in on WorkOS, and every meeting has permission checks and an audit log.
