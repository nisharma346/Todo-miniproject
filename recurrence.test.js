const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateNextDueDate,
    ensureNextOccurrence
} = require('./recurrence');

test('daily recurrence advances one calendar day', () => {
    assert.equal(
        calculateNextDueDate('daily', '2026-03-08T00:00:00.000Z').toISOString(),
        '2026-03-09T00:00:00.000Z'
    );
});

test('weekly recurrence advances seven calendar days', () => {
    assert.equal(
        calculateNextDueDate('weekly', '2026-03-08T00:00:00.000Z').toISOString(),
        '2026-03-15T00:00:00.000Z'
    );
});

test('monthly recurrence clamps month-end dates, including leap years', () => {
    assert.equal(
        calculateNextDueDate('monthly', '2025-01-31T09:30:00.000Z').toISOString(),
        '2025-02-28T09:30:00.000Z'
    );
    assert.equal(
        calculateNextDueDate('monthly', '2024-01-31T09:30:00.000Z').toISOString(),
        '2024-02-29T09:30:00.000Z'
    );
});

test('unsupported recurrence values are rejected', () => {
    assert.throws(() => calculateNextDueDate('yearly', '2026-01-01'), /Recurrence must be/);
});

test('an undated recurring task uses its completion time as the schedule anchor', () => {
    assert.equal(
        calculateNextDueDate(
            'daily',
            undefined,
            new Date('2026-03-08T12:00:00.000Z')
        ).toISOString(),
        '2026-03-09T12:00:00.000Z'
    );
});

test('non-recurring tasks do not get a next occurrence', async () => {
    let writes = 0;
    const Todo = { updateOne: async () => { writes += 1; } };
    const result = await ensureNextOccurrence(Todo, {
        recurrence: 'none',
        nextOccurrenceId: 'unused'
    });
    assert.equal(result, null);
    assert.equal(writes, 0);
});

test('retrying next-occurrence creation uses one stable ID and owner-scoped upsert', async () => {
    const records = new Map();
    let lastFilter;
    const Todo = {
        async updateOne(filter, update) {
            lastFilter = filter;
            if (!records.has(filter._id)) {
                records.set(filter._id, update.$setOnInsert);
            }
            return { upsertedCount: records.has(filter._id) ? 1 : 0 };
        }
    };
    const source = {
        _id: 'source',
        user: 'owner',
        task: 'Pay rent',
        description: 'Monthly payment',
        category: 'Personal',
        priority: 'High',
        dueDate: new Date('2026-01-31T00:00:00.000Z'),
        recurrence: 'monthly',
        nextOccurrenceId: 'stable-next-id',
        nextOccurrenceCreatedAt: new Date('2026-01-31T12:00:00.000Z')
    };

    await ensureNextOccurrence(Todo, source);
    await ensureNextOccurrence(Todo, source);

    assert.equal(records.size, 1);
    assert.notEqual('stable-next-id', source._id);
    assert.equal(lastFilter.user, 'owner');
    assert.equal(records.get('stable-next-id').user, 'owner');
    assert.equal(records.get('stable-next-id').task, 'Pay rent');
    assert.equal(records.get('stable-next-id').description, 'Monthly payment');
    assert.equal(records.get('stable-next-id').priority, 'High');
    assert.equal(records.get('stable-next-id').status, 'todo');
    assert.equal(records.get('stable-next-id').isCompleted, false);
    assert.equal(records.get('stable-next-id').dueDate.toISOString(), '2026-02-28T00:00:00.000Z');
});

test('concurrent retries tolerate the unique-ID race without creating a duplicate', async () => {
    const records = new Map();
    let insertCount = 0;
    const Todo = {
        async updateOne(filter, update) {
            if (records.has(filter._id)) {
                const duplicateKeyError = new Error('Duplicate key');
                duplicateKeyError.code = 11000;
                throw duplicateKeyError;
            }
            insertCount += 1;
            records.set(filter._id, update.$setOnInsert);
        },
        async findOne(filter) {
            const record = records.get(filter._id);
            return record && record.user === filter.user ? record : null;
        }
    };
    const source = {
        user: 'owner',
        task: 'Weekly review',
        description: 'Review this week',
        category: 'Work',
        priority: 'High',
        dueDate: new Date('2026-03-08T00:00:00.000Z'),
        recurrence: 'weekly',
        nextOccurrenceId: 'stable-next-id',
        nextOccurrenceCreatedAt: new Date('2026-03-08T12:00:00.000Z')
    };

    await Promise.all([
        ensureNextOccurrence(Todo, source),
        ensureNextOccurrence(Todo, source)
    ]);

    assert.equal(insertCount, 1);
    assert.equal(records.size, 1);
    assert.equal(records.get('stable-next-id').user, 'owner');
    assert.equal(records.get('stable-next-id').task, 'Weekly review');
    assert.equal(records.get('stable-next-id').description, 'Review this week');
    assert.equal(records.get('stable-next-id').category, 'Work');
    assert.equal(records.get('stable-next-id').priority, 'High');
    assert.equal(records.get('stable-next-id').isCompleted, false);
    assert.equal(records.get('stable-next-id').status, 'todo');
    assert.equal(records.get('stable-next-id').recurrence, 'weekly');
    assert.equal(records.get('stable-next-id').dueDate.toISOString(), '2026-03-15T00:00:00.000Z');
});
