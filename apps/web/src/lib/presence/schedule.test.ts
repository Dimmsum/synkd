import { describe, expect, it } from 'vitest';
import type { NowConnection, NowEvent, NowOverride } from '@whosfree/backend';
import { nowRowInput } from './compute';
import { blocksOnDates } from './schedule';

const JM = 'America/Jamaica'; // UTC-5, no DST
const NY = 'America/New_York'; // UTC-4 in October
const at = (local: string) => Date.parse(`${local}-05:00`);
const WED = '2026-09-30';
const THU = '2026-10-01';

/** A COMP2140 lecture on Wednesday, 2–3 PM in Jamaica, as `now_for_viewer` sends it at `tier`. */
function lecture(tier: 1 | 2 | 3, over: Partial<NowEvent> = {}): NowEvent {
  return {
    id: 'ev-lecture',
    start: at(`${WED}T14:00:00`),
    end: at(`${WED}T15:00:00`),
    rrule: null,
    exdates: [],
    category: tier >= 2 ? 'class' : null,
    title: tier >= 3 ? 'COMP2140 Lecture' : null,
    ...over,
  };
}

function row(events: NowEvent[], over: Partial<NowConnection> = {}): NowConnection {
  return {
    user_id: '00000000-0000-4000-8000-000000000001',
    name: 'Kemar',
    handle: 'kemar',
    avatar_url: null,
    relationship: 'friend',
    tier: 1,
    paused: false,
    has_schedule: true,
    group_ids: [],
    timezone: JM,
    available_hours: null,
    overrides: [],
    sources: [{ period: null, events }],
    ...over,
  };
}

const busy = (blocks: ReturnType<typeof blocksOnDates>) => blocks.filter((b) => !b.outsideHours);

describe('blocksOnDates (FR-VIEW-4, WF-065)', () => {
  it('a day: the busy block plus away outside the default 8 AM–10 PM hours', () => {
    const blocks = blocksOnDates(nowRowInput(row([lecture(1)])), [WED], JM);
    expect(
      blocks.map(({ start, end, status, outsideHours }) => ({ start, end, status, outsideHours })),
    ).toEqual([
      { start: 0, end: 8 * 60, status: 'away', outsideHours: true },
      { start: 14 * 60, end: 15 * 60, status: 'busy', outsideHours: false },
      { start: 22 * 60, end: 24 * 60, status: 'away', outsideHours: true },
    ]);
  });

  it('only says what the tier allows (FR-VIS-5)', () => {
    const t1 = busy(blocksOnDates(nowRowInput(row([lecture(1)])), [WED], JM));
    const t2 = busy(blocksOnDates(nowRowInput(row([lecture(2)])), [WED], JM));
    const t3 = busy(blocksOnDates(nowRowInput(row([lecture(3)])), [WED], JM));
    expect(t1[0]).not.toHaveProperty('category');
    expect(t1[0]).not.toHaveProperty('title');
    expect(t2[0]).toMatchObject({ category: 'class' });
    expect(t2[0]).not.toHaveProperty('title');
    expect(t3[0]).toMatchObject({ category: 'class', title: 'COMP2140 Lecture' });
  });

  it('a week: a weekly event shows on its day each week, nowhere else', () => {
    const weekly = lecture(3, { rrule: 'FREQ=WEEKLY' });
    const dates = ['2026-09-28', '2026-09-29', WED, THU, '2026-10-02', '2026-10-03', '2026-10-04'];
    const later = ['2026-10-05', '2026-10-06', '2026-10-07'];
    const input = nowRowInput(row([weekly]));
    expect(busy(blocksOnDates(input, dates, JM)).map((b) => b.date)).toEqual([WED]);
    expect(busy(blocksOnDates(input, later, JM)).map((b) => b.date)).toEqual(['2026-10-07']);
  });

  it("shows times in the viewer's timezone", () => {
    const [b] = busy(blocksOnDates(nowRowInput(row([lecture(1)])), [WED], NY));
    expect(b).toMatchObject({ date: WED, start: 15 * 60, end: 16 * 60 });
  });

  it('splits a block that runs past midnight between the two dates', () => {
    const late = lecture(1, { start: at(`${WED}T23:00:00`), end: at(`${THU}T01:00:00`) });
    const blocks = busy(blocksOnDates(nowRowInput(row([late])), [WED, THU], JM));
    expect(blocks.map(({ date, start, end }) => ({ date, start, end }))).toEqual([
      { date: WED, start: 23 * 60, end: 24 * 60 },
      { date: THU, start: 0, end: 60 },
    ]);
  });

  it('a manual status shows as its own block, with the note the row carries', () => {
    const override: NowOverride = {
      id: 'ov-1',
      status: 'dnd',
      label: 'Exam',
      startsAt: at(`${WED}T09:00:00`),
      endsAt: at(`${WED}T11:00:00`),
    };
    const [b] = busy(blocksOnDates(nowRowInput(row([], { overrides: [override] })), [WED], JM));
    expect(b).toMatchObject({ status: 'dnd', start: 9 * 60, end: 11 * 60, title: 'Exam' });
  });

  it('nothing for no dates', () => {
    expect(blocksOnDates(nowRowInput(row([lecture(1)])), [], JM)).toEqual([]);
  });
});
