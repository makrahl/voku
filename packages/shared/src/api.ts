import { z } from 'zod';
import {
  CefrLevelSchema,
  MixWeightsSchema,
  TestStatusSchema,
  TrickinessKindSchema,
  WordOriginSchema,
  type AchievedMix,
  type AttemptMode,
} from './domain.js';
import {
  QuestionTypeSchema,
  TestDirectionSchema,
  type QuestionPayload,
  type QuestionType,
  type StudentQuestionPayload,
} from './questions.js';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const LoginRequestSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export const ClassInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const ClassUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

/** One name per line. Blank lines and duplicates within the paste are dropped. */
export const BulkStudentsSchema = z.object({
  names: z.string().min(1),
});

export const StudentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

export const TestInputSchema = z.object({
  classId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});

export const TestUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  sourceText: z.string().optional(),
  direction: TestDirectionSchema.optional(),
  durationSeconds: z.number().int().min(30).max(3600).optional(),
  targetCount: z.number().int().min(1).optional(),
  mix: MixWeightsSchema.optional(),
});

export const ExtractRequestSchema = z.object({
  level: CefrLevelSchema.default('B1'),
  maxWords: z.number().int().min(5).max(200).default(80),
});

/**
 * Accepts `english;german`, `english<TAB>german`, or `english - german`,
 * one pair per line. Order of the paste is taken as difficulty order.
 */
export const WordPasteSchema = z.object({
  text: z.string().min(1),
});

export const WordUpdateSchema = z.object({
  headwordEn: z.string().trim().min(1).optional(),
  translationDe: z.string().trim().min(1).optional(),
  acceptedEn: z.array(z.string().trim().min(1)).optional(),
  acceptedDe: z.array(z.string().trim().min(1)).optional(),
  difficulty: z.number().int().min(1).max(10).optional(),
  trickiness: z.number().int().min(0).max(3).optional(),
  included: z.boolean().optional(),
});

export const WordCreateSchema = z.object({
  headwordEn: z.string().trim().min(1),
  translationDe: z.string().trim().min(1),
  difficulty: z.number().int().min(1).max(10).default(5),
  trickiness: z.number().int().min(0).max(3).default(0),
  trickinessKind: TrickinessKindSchema.default('none'),
  contextSentence: z.string().trim().optional(),
});

/** Keep the N most difficult included words, exclude the rest. */
export const CutoffSchema = z.object({
  keep: z.number().int().min(1),
});

export const ImportWordsSchema = z.object({
  fromTestId: z.string().min(1),
  wordIds: z.array(z.string().min(1)).min(1),
});

export const GenerateRequestSchema = z.object({
  /** Regenerate everything, discarding questions already reviewed. */
  force: z.boolean().default(false),
});

export const RegenerateQuestionSchema = z.object({
  type: QuestionTypeSchema.optional(),
});

export const AnswerSubmitSchema = z.object({
  questionId: z.string().min(1),
  /** Free text for typed formats; the option index as a string for MCQ. */
  given: z.string(),
});

export const StudentSessionSchema = z.object({
  token: z.string().min(1),
});

export const AcceptVariantSchema = z.object({
  questionId: z.string().min(1),
  variant: z.string().min(1),
  /** Also add it to the word's permanent alternatives, so it carries to future tests. */
  persist: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface ClassView {
  id: string;
  name: string;
  studentCount: number;
  testCount: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface StudentView {
  id: string;
  classId: string;
  name: string;
  token: string;
  loginUrl: string;
  archivedAt: string | null;
}

export interface TestView {
  id: string;
  classId: string;
  className: string;
  title: string;
  status: z.infer<typeof TestStatusSchema>;
  sourceText: string;
  direction: z.infer<typeof TestDirectionSchema>;
  durationSeconds: number;
  targetCount: number;
  mix: z.infer<typeof MixWeightsSchema>;
  wordCount: number;
  includedCount: number;
  questionCount: number;
  createdAt: string;
  publishedAt: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

export interface WordView {
  id: string;
  headwordEn: string;
  translationDe: string;
  pos: string | null;
  difficulty: number;
  trickiness: number;
  trickinessKind: z.infer<typeof TrickinessKindSchema>;
  trickinessNote: string | null;
  contextSentence: string | null;
  acceptedEn: string[];
  acceptedDe: string[];
  suitsFillBlank: boolean;
  suitsDefinitionMcq: boolean;
  included: boolean;
  origin: z.infer<typeof WordOriginSchema>;
  rank: number;
}

/** Teacher-facing: includes the answer. */
export interface QuestionView {
  id: string;
  wordId: string;
  headwordEn: string;
  type: QuestionType;
  payload: QuestionPayload;
  orderIndex: number;
}

/** Student-facing: the answer has been through stripAnswer(). */
export interface StudentQuestionView {
  id: string;
  index: number;
  total: number;
  payload: StudentQuestionPayload;
}

export interface AnswerFeedback {
  correct: boolean;
  correctAnswer: string;
  /** Set when the answer was a near miss — shown as "Almost — receive", scored wrong. */
  almost: boolean;
  correctCount: number;
  percent: number;
}

export interface AttemptView {
  id: string;
  testId: string;
  testTitle: string;
  mode: AttemptMode;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  serverNow: string;
  secondsRemaining: number | null;
  reachedIndex: number;
  correctCount: number;
  targetCount: number;
  percent: number;
  poolSize: number;
}

export interface StudentHomeView {
  student: { id: string; name: string };
  className: string;
  openTests: Array<{ id: string; title: string; durationSeconds: number; attemptId: string | null; submitted: boolean }>;
  studyLists: Array<{ id: string; title: string; wordCount: number }>;
  pastAttempts: Array<{ attemptId: string; testId: string; testTitle: string; percent: number; correctCount: number; targetCount: number; submittedAt: string }>;
}

export interface ResultRow {
  studentId: string;
  studentName: string;
  attemptId: string | null;
  state: 'not_started' | 'in_progress' | 'submitted';
  reachedIndex: number;
  correctCount: number;
  percent: number;
  secondsRemaining: number | null;
}

export interface ResultsView {
  test: TestView;
  rows: ResultRow[];
  classAveragePercent: number | null;
}

export interface RejectedAnswerGroup {
  questionId: string;
  headwordEn: string;
  correctAnswer: string;
  variant: string;
  count: number;
  studentNames: string[];
}

export interface RepeatCandidate {
  wordId: string;
  headwordEn: string;
  translationDe: string;
  difficulty: number;
  /** Correct rate among students who actually reached the question. Null if nobody did. */
  correctRate: number | null;
  reachedCount: number;
}

export interface AssignmentReport extends AchievedMix {}

export interface QuestionReviewView {
  questions: QuestionView[];
  report: AssignmentReport | null;
}
