// Temporary local copy for Agent A tests. Agent C owns the real types.ts.
export type Subject = 'history' | 'economics' | 'geography' | 'maths' | 'english-lit';

export interface Question {
  id: string;
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  verified: boolean;
  source?: string;
}

export interface SessionQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}
