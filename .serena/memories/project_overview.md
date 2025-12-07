# Inbox Zero - Project Overview

## Purpose
AI-powered email assistant for Gmail/Outlook with rule-based automation, bulk unsubscriber, cold email blocker, and reply tracker. Helps users reach inbox zero faster.

## Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS, shadcn/ui components
- **Backend**: Next.js API routes, Server Actions
- **Database**: Prisma ORM + PostgreSQL
- **Caching**: Redis (local + Upstash)
- **Authentication**: Better Auth
- **AI**: AI SDK with multiple LLM providers (OpenAI, Anthropic, AWS Bedrock, Google Gemini, Groq, Ollama)
- **Email APIs**: Gmail API, Microsoft Graph API
- **Monorepo**: Turborepo with pnpm workspaces
- **Testing**: Vitest, Testing Library
- **Deployment**: Docker, Vercel

## Key Features
- AI Personal Assistant for email organization
- Cursor Rules for email handling
- Reply Zero tracking
- Smart Categories
- Bulk Unsubscriber
- Cold Email Blocker
- Email Analytics
- Knowledge Base for drafting assistance

## Project Structure
- `apps/web/` - Main Next.js application
- `packages/` - Shared packages (loops, resend, tinybird)
- Monorepo with Turborepo and pnpm workspaces