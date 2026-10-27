const RECURRENCE_OPTIONS = ['none', 'daily', 'weekly', 'monthly'];

function validateRecurrence(value) {
    if (!RECURRENCE_OPTIONS.includes(value)) {
        throw new TypeError('Recurrence must be none, daily, weekly, or monthly.');
    }
    return value;
}

function calculateNextDueDate(recurrence, dueDate, completedAt = new Date()) {
    validateRecurrence(recurrence);
    if (recurrence === 'none') return undefined;

    const baseDate = new Date(dueDate || completedAt);
    if (Number.isNaN(baseDate.getTime())) {
        throw new RangeError('The task due date is invalid.');
    }

    const daysToAdd = recurrence === 'daily' ? 1 : recurrence === 'weekly' ? 7 : 0;
    if (daysToAdd) {
        baseDate.setUTCDate(baseDate.getUTCDate() + daysToAdd);
        return baseDate;
    }

    const year = baseDate.getUTCFullYear();
    const month = baseDate.getUTCMonth() + 1;
    const day = baseDate.getUTCDate();
    const nextMonth = new Date(Date.UTC(year, month, 1));
    const lastDayOfNextMonth = new Date(
        Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)
    ).getUTCDate();

    return new Date(Date.UTC(
        nextMonth.getUTCFullYear(),
        nextMonth.getUTCMonth(),
        Math.min(day, lastDayOfNextMonth),
        baseDate.getUTCHours(),
        baseDate.getUTCMinutes(),
        baseDate.getUTCSeconds(),
        baseDate.getUTCMilliseconds()
    ));
}

function buildNextOccurrence(todo, occurrenceId, completedAt = new Date()) {
    const dueDate = todo.nextOccurrenceDueDate || calculateNextDueDate(
        todo.recurrence || 'none',
        todo.dueDate,
        completedAt
    );
    if (!dueDate) return null;

    return {
        _id: occurrenceId,
        user: todo.user,
        task: todo.task,
        description: todo.description || '',
        category: todo.category || 'Personal',
        priority: todo.priority || 'Medium',
        dueDate,
        isCompleted: false,
        status: 'todo',
        recurrence: todo.recurrence,
        createdAt: completedAt
    };
}

async function ensureNextOccurrence(Todo, todo) {
    if (!todo.nextOccurrenceId || !todo.recurrence || todo.recurrence === 'none') {
        return null;
    }

    const occurrence = buildNextOccurrence(
        todo,
        todo.nextOccurrenceId,
        todo.nextOccurrenceCreatedAt || new Date()
    );
    if (!occurrence) return null;

    const insertFields = { ...occurrence };
    delete insertFields._id;
    try {
        await Todo.updateOne(
            { _id: todo.nextOccurrenceId, user: todo.user },
            { $setOnInsert: insertFields },
            { upsert: true, runValidators: true }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
        const existingOccurrence = await Todo.findOne({
            _id: todo.nextOccurrenceId,
            user: todo.user
        });
        if (!existingOccurrence) throw error;
    }
    return todo.nextOccurrenceId;
}

module.exports = {
    RECURRENCE_OPTIONS,
    validateRecurrence,
    calculateNextDueDate,
    buildNextOccurrence,
    ensureNextOccurrence
};
