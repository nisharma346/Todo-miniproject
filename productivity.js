const MIN_DAILY_GOAL = 1;
const MAX_DAILY_GOAL = 100;

function validateTimeZone(timeZone) {
    if (typeof timeZone !== 'string' || !timeZone.trim()) {
        throw new TypeError('A valid IANA time zone is required.');
    }

    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format();
    } catch {
        throw new TypeError('A valid IANA time zone is required.');
    }

    return timeZone;
}

function getLocalDateKey(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: validateTimeZone(timeZone),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function isValidDateKey(dateKey) {
    if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return false;
    }
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateKey;
}

function shiftDateKey(dateKey, days) {
    if (!isValidDateKey(dateKey) || !Number.isInteger(days)) {
        throw new TypeError('A valid date key and whole-day offset are required.');
    }

    const date = new Date(`${dateKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function getWeekDateKeys(today) {
    if (!isValidDateKey(today)) {
        throw new TypeError('A valid date key is required.');
    }

    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    const monday = shiftDateKey(today, -daysSinceMonday);
    return Array.from({ length: 7 }, (_, index) => shiftDateKey(monday, index));
}

function calculateStreaks(dailyCounts, today) {
    if (!isValidDateKey(today)) {
        throw new TypeError('A valid date key is required.');
    }

    const activeDays = [...dailyCounts.entries()]
        .filter(([dateKey, count]) => isValidDateKey(dateKey) && Number.isFinite(count) && count > 0)
        .map(([dateKey]) => dateKey)
        .sort();
    const activeDaySet = new Set(activeDays);

    let currentStreak = 0;
    let cursor = activeDaySet.has(today)
        ? today
        : shiftDateKey(today, -1);
    while (activeDaySet.has(cursor)) {
        currentStreak += 1;
        cursor = shiftDateKey(cursor, -1);
    }

    let longestStreak = 0;
    let runLength = 0;
    let previousDay = null;
    for (const dateKey of activeDays) {
        runLength = previousDay && shiftDateKey(previousDay, 1) === dateKey
            ? runLength + 1
            : 1;
        longestStreak = Math.max(longestStreak, runLength);
        previousDay = dateKey;
    }

    return { currentStreak, longestStreak };
}

function validateDailyGoal(value) {
    if (!Number.isInteger(value) || value < MIN_DAILY_GOAL || value > MAX_DAILY_GOAL) {
        throw new RangeError(`Daily goal must be a whole number from ${MIN_DAILY_GOAL} to ${MAX_DAILY_GOAL}.`);
    }
    return value;
}

function buildCompletionHistoryPipeline(userId, timeZone) {
    return [
        { $match: { user: userId } },
        { $unwind: '$completionHistory' },
        { $match: { 'completionHistory.completedAt': { $type: 'date' } } },
        {
            $group: {
                _id: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$completionHistory.completedAt',
                        timezone: validateTimeZone(timeZone)
                    }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } }
    ];
}

function buildCompletionTransitionFilter(todoId, userId) {
    return {
        _id: todoId,
        user: userId,
        isCompleted: { $ne: true },
        status: { $ne: 'completed' }
    };
}

function buildProductivitySummary({ dailyCounts, today, dailyGoal }) {
    const goal = validateDailyGoal(dailyGoal);
    const { currentStreak, longestStreak } = calculateStreaks(dailyCounts, today);
    const week = getWeekDateKeys(today).map((date) => ({
        date,
        label: new Date(`${date}T12:00:00.000Z`).toLocaleDateString('en-US', {
            weekday: 'short',
            timeZone: 'UTC'
        }),
        count: dailyCounts.get(date) || 0
    }));
    const completedToday = dailyCounts.get(today) || 0;
    const totalCompleted = [...dailyCounts.values()].reduce(
        (total, count) => total + (Number.isFinite(count) && count > 0 ? count : 0),
        0
    );

    return {
        totalCompleted,
        completedToday,
        dailyGoal: goal,
        currentStreak,
        longestStreak,
        weekly: {
            completed: week.reduce((total, day) => total + day.count, 0),
            days: week
        },
        achievements: [
            {
                id: 'first-task',
                name: 'First Task',
                description: 'Complete your first eligible task.',
                unlocked: totalCompleted >= 1
            },
            {
                id: 'task-master',
                name: 'Task Master',
                description: 'Complete 10 eligible tasks.',
                unlocked: totalCompleted >= 10
            },
            {
                id: 'productivity-pro',
                name: 'Productivity Pro',
                description: 'Complete 50 eligible tasks.',
                unlocked: totalCompleted >= 50
            },
            {
                id: 'consistency-champion',
                name: 'Consistency Champion',
                description: 'Maintain a 7-day completion streak.',
                unlocked: longestStreak >= 7
            }
        ]
    };
}

module.exports = {
    MAX_DAILY_GOAL,
    MIN_DAILY_GOAL,
    buildCompletionHistoryPipeline,
    buildCompletionTransitionFilter,
    buildProductivitySummary,
    calculateStreaks,
    getLocalDateKey,
    getWeekDateKeys,
    shiftDateKey,
    validateDailyGoal,
    validateTimeZone
};
