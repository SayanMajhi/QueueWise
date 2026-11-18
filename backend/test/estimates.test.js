import assert from 'node:assert/strict';
import test from 'node:test';

import { projectWait } from '../src/estimates.js';

const idle = { status: null, elapsedSeconds: 0 };

test('an unavailable queue has no estimate, even with service history', () => {
    const estimate = projectWait({
        peopleAhead: 0,
        defaultSeconds: 180,
        sampleCount: 8,
        meanSeconds: 120,
        counters: [],
    });

    assert.deepEqual(estimate, { seconds: null, basis: 'UNAVAILABLE' });
});

test('fewer than five completions use the default, with capacity affecting wait', () => {
    const input = { peopleAhead: 4, defaultSeconds: 120, sampleCount: 4, meanSeconds: 300 };

    assert.deepEqual(
        projectWait({ ...input, counters: [idle] }),
        { seconds: 480, basis: 'DEFAULT' },
    );
    assert.deepEqual(
        projectWait({ ...input, counters: [idle, idle] }),
        { seconds: 240, basis: 'DEFAULT' },
    );
    assert.deepEqual(
        projectWait({ ...input, peopleAhead: 0, sampleCount: 0, meanSeconds: null, counters: [idle] }),
        { seconds: 0, basis: 'DEFAULT' },
    );
});

test('at five completions a called token takes a full slot and service in progress takes its residual', () => {
    const input = {
        peopleAhead: 0,
        defaultSeconds: 90,
        sampleCount: 5,
        meanSeconds: 180,
        counters: [
            { status: 'CALLED', elapsedSeconds: 100 },
            { status: 'IN_SERVICE', elapsedSeconds: 140 },
        ],
    };

    assert.deepEqual(projectWait(input), { seconds: 40, basis: 'HISTORICAL' });
    assert.deepEqual(projectWait({ ...input, peopleAhead: 1 }), { seconds: 180, basis: 'HISTORICAL' });
    assert.deepEqual(projectWait({ ...input, peopleAhead: 2 }), { seconds: 220, basis: 'HISTORICAL' });
    assert.deepEqual(projectWait({ ...input, peopleAhead: 3 }), { seconds: 360, basis: 'HISTORICAL' });
});

test('a service overrun has zero residual and the estimator rounds up only the final result', () => {
    const input = {
        peopleAhead: 0,
        defaultSeconds: 120,
        sampleCount: 6,
        meanSeconds: 40.25,
        counters: [{ status: 'IN_SERVICE', elapsedSeconds: 95 }],
    };

    assert.deepEqual(projectWait(input), { seconds: 0, basis: 'HISTORICAL' });
    assert.deepEqual(projectWait({ ...input, peopleAhead: 2 }), { seconds: 81, basis: 'HISTORICAL' });
});
