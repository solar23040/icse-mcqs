import type { Subject } from './types';

export interface SubjectInfo {
  slug: Subject;
  title: string;
  /** No questions yet: show a coming-soon page instead of the quiz. */
  placeholder?: boolean;
}

export const SUBJECTS: SubjectInfo[] = [
  { slug: 'history', title: 'History & Civics' },
  { slug: 'economics', title: 'Economics' },
  { slug: 'geography', title: 'Geography' },
  { slug: 'maths', title: 'Maths' },
  { slug: 'english-lit', title: 'English Literature' },
  { slug: 'physics', title: 'Physics' },
  { slug: 'chemistry', title: 'Chemistry', placeholder: true },
  { slug: 'computer-applications', title: 'Computer Applications', placeholder: true },
  { slug: 'physical-education', title: 'Physical Education' },
];
