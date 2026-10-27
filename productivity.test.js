const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildCompletionHistoryPipeline,
    buildCompletionTransitionFilter,
    buildProductivitySummary,
    calculateStreaks,
    getLocalDateKey,
    getWeekDateKeys,
    validateDailyGoal,
    validateTimeZone
} = require('./productivity');

test('consecutive local calendar days form a current and longest streak', () => {
    const counts = new Map([
        ['2026-10-24', 1],
        ['2026-10-25', 1],
        ['2026-10-26', 1]
    ]);
    assert.deepEqual(calculateStreaks(counts, '2026-10-26'), {
        currentStreak: 3,
        longestStreak: 3
    });
});

test('a missed day breaks the current streak while preserving the longest streak', () => {
    const counts = new Map([
        ['2026-10-20', 1],
        ['2026-10-21', 1],
        ['2026-10-23', 2],
        ['2026-10-24', 1],
        ['2026-10-26', 1]
    ]);
    assert.deepEqual(calculateStreaks(counts, '2026-10-26'), {
        currentStreak: 1,
        longestStreak: 2
    });
});

test('multiple completions on one date count as one streak day', () => {
    const counts = new Map([
        ['2026-10-25', 4],
        ['2026-10-26', 3]
    ]);
    assert.deepEqual(calculateStreaks(counts, '2026-10-26'), {
        currentStreak: 2,
        longestStreak: 2
    });
});

test('a streak from yesterday remains current today, but older activity expires', () => {
    assert.equal(
        calculateStreaks(new Map([['2026-10-25', 1]]), '2026-10-26').currentStreak,
        1
    );
    assert.equal(
        calculateStreaks(new Map([['2026-10-24', 1]]), '2026-10-26').currentStreak,
        0
    );
});

test('completion days and weekly boundaries use the authenticated user local timezone', () => {
    assert.equal(
        getLocalDateKey(new Date('2026-10-26T01:30:00.000Z'), 'America/Los_Angeles'),
        '2026-10-25'
    );
    assert.equal(
        getLocalDateKey(new Date('2026-10-26T01:30:00.000Z'), 'Asia/Kolkata'),
        '2026-10-26'
    );
    assert.equal(
        getLocalDateKey(new Date('2026-03-08T07:59:00.000Z'), 'America/Los_Angeles'),
        '2026-03-07'
    );
    assert.equal(
        getLocalDateKey(new Date('2026-03-08T08:00:00.000Z'), 'America/Los_Angeles'),
        '2026-03-08'
    );
    assert.deepEqual(getWeekDateKeys('2026-10-26'), [
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
        '2026-10-31',
        '2026-11-01'
    ]);
});

test('daily goals accept whole numbers in range only', () => {
    assert.equal(validateDailyGoal(1), 1);
    assert.equal(validateDailyGoal(100), 100);
    for (const invalid of [0, -1, 101, 1.5, '5', null]) {
        assert.throws(() => validateDailyGoal(invalid), RangeError);
    }
});

test('achievements unlock only at verified completion and streak thresholds', () => {
    const summary = buildProductivitySummary({
        dailyCounts: new Map([
            ['2026-10-20', 10],
            ['2026-10-21', 10],
            ['2026-10-22', 10],
            ['2026-10-23', 10],
            ['2026-10-24', 9],
            ['2026-10-25', 1],
            ['2026-10-26', 1]
        ]),
        today: '2026-10-26',
        dailyGoal: 5
    });
    assert.equal(summary.totalCompleted, 51);
    assert.deepEqual(summary.achievements.map(({ unlocked }) => unlocked), [
        true, true, true, true
    ]);

    const empty = buildProductivitySummary({
        dailyCounts: new Map(),
        today: '2026-10-26',
        dailyGoal: 5
    });
    assert.deepEqual(empty.achievements.map(({ unlocked }) => unlocked), [
        false, false, false, false
    ]);
});

test('task-count achievements unlock at their exact verified thresholds', () => {
    const makeSummary = (count) => buildProductivitySummary({
        dailyCounts: new Map([['2026-10-26', count]]),
        today: '2026-10-26',
        dailyGoal: 5
    }).achievements;
    assert.deepEqual(makeSummary(9).map(({ unlocked }) => unlocked), [
        true, false, false, false
    ]);
    assert.deepEqual(makeSummary(10).map(({ unlocked }) => unlocked), [
        true, true, false, false
    ]);
    assert.deepEqual(makeSummary(50).map(({ unlocked }) => unlocked), [
        true, true, true, false
    ]);
});

test('weekly summary includes zero-count days and leaves goal progress uncapped in counts', () => {
    const summary = buildProductivitySummary({
        dailyCounts: new Map([['2026-10-26', 7]]),
        today: '2026-10-26',
        dailyGoal: 5
    });
    assert.equal(summary.weekly.days.length, 7);
    assert.equal(summary.weekly.completed, 7);
    assert.equal(summary.completedToday, 7);
    assert.equal(summary.dailyGoal, 5);
});

test('completion history aggregation is scoped to the authenticated owner', () => {
    const pipeline = buildCompletionHistoryPipeline('authenticated-user', 'UTC');
    assert.deepEqual(pipeline[0], { $match: { user: 'authenticated-user' } });
    assert.deepEqual(pipeline[1], { $unwind: '$completionHistory' });
    assert.deepEqual(pipeline[2], {
        $match: { 'completionHistory.completedAt': { $type: 'date' } }
    });
    assert.equal(
        pipeline[3].$group._id.$dateToString.timezone,
        'UTC'
    );
});

test('completion transition guard only allows one atomic incomplete-to-complete update per owner', () => {
    assert.deepEqual(buildCompletionTransitionFilter('task-1', 'owner-1'), {
        _id: 'task-1',
        user: 'owner-1',
        isCompleted: { $ne: true },
        status: { $ne: 'completed' }
    });
});

test('invalid client-provided time zones are rejected', () => {
    assert.throws(() => validateTimeZone('Not/A_Timezone'), /IANA time zone/);
});
