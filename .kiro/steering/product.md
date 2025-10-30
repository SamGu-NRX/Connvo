# **CURRENT** Connvo Product Overview (WIP, subject to change)

Connvo is a professional networking platform designed as the antithesis of LinkedIn. It focuses on authentic, real-time connections through advanced AI-powered collaboration features:

## Core Features

- **Tiered video calling**: GetStream Video (paid tier) + WebRTC/custom pipeline (free tier)
- **AI-powered smart matching** using vector similarity and compatibility scoring
- **Live collaborative notes** with operational transform for real-time editing
- **Live transcription** with speaker identification and searchable segments
- **AI conversation prompts** for pre-call preparation and in-call assistance
- **Post-call insights** with action items and connection recommendations
- **Enterprise authentication** with WorkOS for secure, scalable access
- **Minimalist UI** built with Next.js, Tailwind CSS, and Shadcn UI

## Target Users

Professional individuals and enterprise teams seeking genuine networking opportunities with advanced collaboration tools, without the clutter and bot-filled interactions of traditional platforms.

## Key Differentiators

- **Real-time collaboration**: Live notes, transcription, and AI assistance during calls
- **Intelligent matching**: Vector-based similarity matching with feedback loops
- **Enterprise-grade security**: WorkOS authentication with per-meeting data isolation
- **AI-enhanced conversations**: Pre-call ideas, in-call prompts, post-call insights
- **Reactive architecture**: Sub-100ms updates via Convex reactive queries
- **Clean, distraction-free interface** focused on productivity and human connection

## Technical Architecture

- **Backend**: Convex reactive backend with real-time WebSocket subscriptions
- **Database**: Convex with time-sharded collections for high-frequency data
- **Authentication**: WorkOS Auth Kit for enterprise identity management
- **Video**: Hybrid architecture - GetStream Video (paid tier) + WebRTC/custom pipeline (free tier) (paid tier) + WebRTC/custom pipeline (free tier)
- **AI**: Provider-agnostic AI integration for embeddings and conversation assistance
- **Real-time**: Operational transform for collaborative editing, live transcription streaming

## Current Status

Advanced MVP with comprehensive real-time collaboration features, intelligent matching, and enterprise-grade security. Core functionality includes meeting lifecycle management, live transcription, collaborative notes, AI-powered prompts, and post-call insights.
