PROJECT: Static ICSE Class 10 MCQ practice site. Astro + Tailwind + Svelte, TypeScript. No backend.
You are one of 4 agents working IN PARALLEL in separate worktrees. Edit ONLY the files you own. Never edit another agent's files. If you need a contract change, don't make it; write it in NOTES-<agent>.md and code to the contract as written.

SUBJECTS (slug -> title): history -> "History & Civics", economics -> "Economics" (NOT Economic Applications), geography -> "Geography", maths -> "Maths", english-lit -> "English Literature".

TYPES (src/lib/types.ts)
export type Subject = 'history'|'economics'|'geography'|'maths'|'english-lit';
export interface Question { id: string; question: string; options: string[]; /* exactly 4 */ answer: number; /* index into options, 0-3 */ explanation: string; verified: boolean; source?: string; /* INTERNAL ONLY, never render */ }
export interface SessionQuestion { id: string; question: string; options: string[]; correctIndex: number; explanation: string; }

ENGINE (src/lib/engine.ts)
export function shuffle<T>(arr: T[], rng?: () => number): T[]            // Fisher-Yates, returns a new array
export function buildSession(all: Question[], seenIds: string[], length: number | 'all'): { questions: SessionQuestion[]; unseenCount: number; poolExhausted: boolean }
  // picks only unseen questions, shuffled; shuffles options and recomputes correctIndex; if fewer unseen than length, returns all unseen; if zero unseen: questions=[] and poolExhausted=true

STORAGE (src/lib/storage.ts), every access wrapped in try/catch, in-memory fallback if localStorage throws
export function getSeen(subject: Subject): string[]
export function markSeen(subject: Subject, id: string): void
export function resetSeen(subject: Subject): void
export function getStats(subject: Subject): { attempted: number; correct: number }
export function recordAnswer(subject: Subject, correct: boolean): void   // also increments attempted

QUIZ COMPONENT (src/components/quiz/Quiz.svelte)
props: { subject: Subject; questions: Question[] }   // questions = full pool for that subject
Handles everything internally: session length picker (10/20/30/All), the quiz, results, reset.

DATA: src/data/<slug>.json = Question[]. Year/paper must NEVER appear in any UI.

SCRIPTS (package.json): "dev","build" (astro), "validate": "tsx scripts/validate.ts", "test": "vitest run". devDependencies include tsx and vitest.

FILE OWNERSHIP
Agent A: src/lib/engine.ts, src/lib/storage.ts, src/lib/engine.test.ts, src/lib/storage.test.ts
Agent B: src/components/quiz/** 
Agent C: package.json, astro/tailwind/ts configs, src/lib/types.ts, src/lib/subjects.ts, src/layouts/**, src/pages/**, src/components/shell/**, src/styles/**
Agent D: scripts/**, src/data/*.json, README.md
