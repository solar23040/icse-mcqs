export type Subject =
  | 'history'
  | 'economics'
  | 'geography'
  | 'maths'
  | 'english-lit'
  | 'physics'
  | 'chemistry'
  | 'computer-applications'
  | 'physical-education';

export interface Question {
  id: string;
  question: string;
  options: string[]; /* exactly 4 */
  answer: number; /* index into options, 0-3 */
  explanation: string;
  verified: boolean;
  source?: string; /* INTERNAL ONLY, never render */
}

export interface SessionQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}
