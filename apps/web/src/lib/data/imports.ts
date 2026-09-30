import type { DraftEvent, ParseJob, PendingUpload } from '@/lib/types';
import { minutesAgo } from '@/lib/mock/selectors';

const DRAFT: DraftEvent[] = [
  {
    id: 'e1',
    title: 'COMP2140 Lecture',
    category: 'class',
    start: '10:00',
    end: '12:00',
    when: { kind: 'weekly', days: ['mon', 'wed', 'fri'], pattern: { type: 'every' } },
    confidence: 0.96,
  },
  {
    id: 'e2',
    title: 'MATH1141 Tutorial',
    category: 'tutorial',
    start: '13:00',
    end: '14:00',
    when: { kind: 'weekly', days: ['tue', 'thu'], pattern: { type: 'every' } },
    confidence: 0.91,
  },
  {
    id: 'e3',
    title: 'CHEM1901 Lab',
    category: 'lab',
    start: '09:00',
    end: '12:00',
    when: {
      kind: 'weekly',
      days: ['tue'],
      pattern: { type: 'alternating', parity: 'odd' },
    },
    confidence: 0.58,
  },
  {
    id: 'e4',
    title: 'FOUN1101 Seminar',
    category: 'class',
    start: '16:00',
    end: '17:00',
    when: { kind: 'weekly', days: ['thu'], pattern: { type: 'every' } },
    confidence: 0.64,
  },
];

/**
 * A parse job and its draft (FR-IMP-9). `manual` starts an empty draft for manual entry
 * (FR-IMP-12, WF-031). TODO(WF-027/WF-029): read parseJobs.draft for the viewer (RLS) and
 * a short-lived signed URL for the original file.
 */
export async function getParseJob(id: string): Promise<ParseJob | null> {
  if (id === 'manual') {
    return {
      id,
      fileName: '',
      status: 'needs_review',
      events: [],
      period: { start: '2026-08-31', end: '2026-12-12' },
    };
  }
  if (id !== 'job-1') return null;
  return {
    id,
    fileName: 'Sem1-timetable.pdf',
    status: 'needs_review',
    events: DRAFT,
    period: { start: '2026-08-31', end: '2026-12-12' },
  };
}

/**
 * Files that haven't been confirmed yet, each with its deletion date (FR-IMP-16, D38).
 * TODO(WF-032): query scheduleFiles + parseJobs for the viewer.
 */
export async function getPendingUploads(): Promise<PendingUpload[]> {
  const deleteAt = (ago: number) => minutesAgo(ago - 7 * 24 * 60);
  return [
    {
      id: 'u1',
      fileName: 'Sem1-timetable.pdf',
      uploadedAt: minutesAgo(60 * 26),
      deleteAt: deleteAt(60 * 26),
      jobId: 'job-1',
      jobStatus: 'needs_review',
    },
    {
      id: 'u2',
      fileName: 'roster-photo.jpg',
      uploadedAt: minutesAgo(60 * 3),
      deleteAt: deleteAt(60 * 3),
      jobId: 'job-2',
      jobStatus: 'failed',
      error: 'We couldn’t read a schedule in that photo.',
    },
  ];
}
