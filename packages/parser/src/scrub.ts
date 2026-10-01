// D35 post-processing: no locations or personal details in what the parser outputs (FR-IMP-3,
// WF-028). zod already strips unknown keys such as `location` or `room`, and the prompt tells
// the model to leave them out, but a model can still type a room into a title
// ("COMP1161 Lecture - Room 12"). This scrubber removes what can be recognised reliably: rooms
// and buildings named as such, emails, links, phone and ID numbers, street addresses, and
// people's names after an honorific or a role ("Dr. Brown", "Lecturer: J. Brown").
//
// It is deliberately conservative: it only removes text that matches one of these patterns,
// and keeps course codes ("COMP1161"), kinds ("Lab", "Tutorial"), group labels ("Group B") and
// words that merely look like a keyword ("Theatre Studies", "Office hours"). A bare name or a
// room without a keyword ("SLT 2") can't be told apart from a course name, so the review screen
// remains the last check (FR-IMP-9).
import type { EventCategory, ParseDraft } from '@whosfree/shared';

/** What an event is called when nothing is left of its title. */
export const CATEGORY_TITLES: Record<EventCategory, string> = {
  class: 'Class',
  lab: 'Lab',
  tutorial: 'Tutorial',
  work: 'Work',
  meeting: 'Meeting',
  event: 'Event',
  other: 'Busy',
};

/** A case-insensitive alternation of plain ASCII words, for regexes that must stay case-sensitive elsewhere. */
function anyCase(words: readonly string[]): string {
  return words
    .map((w) =>
      [...w]
        .map((c) =>
          /[a-z]/.test(c) ? `[${c.toUpperCase()}${c}]` : c === ' ' ? String.raw`\s+` : c,
        )
        .join(''),
    )
    .join('|');
}

/** A capitalised name of up to four words: "Brown", "J. Brown", "Anne-Marie O'Neil". */
const NAME = String.raw`[\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}`;
const ROLES = anyCase([
  'lecturer',
  'lecturers',
  'instructor',
  'instructors',
  'tutor',
  'tutors',
  'teacher',
  'teachers',
  'professor',
  'supervisor',
  'manager',
  'coordinator',
  'facilitator',
]);
const ROOM_WORDS = anyCase([
  'lecture theatre',
  'room',
  'rm',
  'bldg',
  'building',
  'block',
  'hall',
  'theatre',
  'theater',
  'auditorium',
  'campus',
  'floor',
  'flr',
  'suite',
]);
const LOCATION_LABELS = anyCase(['location', 'loc', 'venue', 'where', 'room', 'rm']);
const ID_WORDS = anyCase([
  'student id',
  'student no',
  'student number',
  'staff id',
  'staff no',
  'employee id',
  'employee no',
  'badge',
  'id',
]);
const STREETS = anyCase([
  'street',
  'st',
  'road',
  'rd',
  'avenue',
  'ave',
  'drive',
  'lane',
  'ln',
  'boulevard',
  'blvd',
  'crescent',
  'terrace',
  'highway',
  'hwy',
]);
/** Where a removed phrase that runs "to the end of the part" stops. */
const PART = String.raw`[^,;|()[\]]+`;

/** Each pattern removes the whole match. Order matters: the more specific ones go first. */
const PATTERNS: RegExp[] = [
  // Links and emails.
  /\bhttps?:\/\/\S+/gu,
  /\b[Ww]{3}\.\S+/gu,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu,
  // A labelled location: "Location: Main Campus", "Venue - SLT 2", "Room: B12".
  new RegExp(String.raw`\b(?:${LOCATION_LABELS})\b\s*[:\-–—]\s*${PART}`, 'gu'),
  // A role followed by a name: "Lecturer: J. Brown", "Tutor - Grant", "taught by Brown".
  new RegExp(String.raw`\b(?:${ROLES})\b\s*[:\-–—]\s*${PART}`, 'gu'),
  new RegExp(String.raw`\b(?:${anyCase(['taught by', 'led by', 'run by'])})\s+${NAME}`, 'gu'),
  // An honorific followed by a name: "Dr. Brown", "Prof Smith-Jones", "Mrs. A. Grant".
  new RegExp(String.raw`\b(?:Dr|Prof|Mr|Mrs|Ms|Miss|Mx|Sir)\.?\s+${NAME}`, 'gu'),
  // ID numbers named as such: "ID 620123456", "Student No. 12345", "Staff ID: A123".
  new RegExp(String.raw`\b(?:${ID_WORDS})\b\.?\s*[:#]?\s*[A-Za-z]{0,3}\d[\w-]*`, 'gu'),
  // A room or building with a number or a short code: "Room 12", "Rm. 4B", "Bldg C",
  // "Hall 3", "Lecture Theatre 2". "Theatre Studies" keeps its words.
  new RegExp(
    String.raw`\b(?:${ROOM_WORDS})\b\.?\s*#?\s*(?:\d[\w-]*|[A-Z]{1,4}\d*(?:-?\d+)?)(?![\p{L}])`,
    'gu',
  ),
  // Street addresses: "12 Hope Road", "4 Main St.".
  new RegExp(String.raw`\b\d{1,5}\s+(?:[\p{Lu}][\p{L}'’-]*\s+){1,3}(?:${STREETS})\b\.?`, 'gu'),
  // Phone numbers and other long digit runs (IDs): 7+ digits, allowing separators.
  /\+?\d(?:[\s().-]*\d){6,}/gu,
  // "COMP1161 @ SLT 2": anything after a lone @.
  /\s@.*$/gu,
];

const SEPARATORS = String.raw`,;:|/\-–—`;

/** Removes leftover separators and empty brackets after removals. */
function tidy(text: string): string {
  let out = text;
  for (let i = 0; i < 3; i++) {
    out = out
      .replace(
        new RegExp(String.raw`\(\s*[${SEPARATORS}\s]*\)|\[\s*[${SEPARATORS}\s]*\]`, 'gu'),
        ' ',
      )
      .replace(new RegExp(String.raw`\s*([${SEPARATORS}])(?:\s*[${SEPARATORS}])+`, 'gu'), ' $1 ')
      .replace(/\s{2,}/gu, ' ')
      .trim()
      .replace(new RegExp(String.raw`^[${SEPARATORS}.@\s]+|[${SEPARATORS}@\s]+$`, 'gu'), '')
      .trim();
  }
  return out;
}

/**
 * The title with locations and personal details removed (D35), or the category's name if
 * nothing usable is left.
 */
export function scrubTitle(title: string, category: EventCategory): string {
  let out = title.normalize('NFC');
  for (const pattern of PATTERNS) out = out.replace(pattern, ' ');
  out = tidy(out);
  // Nothing but punctuation or digits left is no title.
  return /\p{L}/u.test(out) ? out : CATEGORY_TITLES[category];
}

/** Applies {@link scrubTitle} to every event of a draft. */
export function scrubDraft(draft: ParseDraft): ParseDraft {
  return {
    ...draft,
    events: draft.events.map((e) => ({ ...e, title: scrubTitle(e.title, e.category) })),
  };
}
