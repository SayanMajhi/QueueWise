const noEstimate = { seconds: null, basis: 'UNAVAILABLE' };
const maxStoredSeconds = 2_147_483_647;

export function projectWait({ peopleAhead, defaultSeconds, sampleCount, meanSeconds, counters }) {
    if (counters.length === 0) {
        return noEstimate;
    }

    const historical = sampleCount >= 5;
    const serviceSeconds = historical ? meanSeconds : defaultSeconds;
    const availableIn = counters.map(({ status, elapsedSeconds }) => {
        if (status === 'CALLED') {
            return serviceSeconds;
        }
        if (status === 'IN_SERVICE') {
            return Math.max(0, serviceSeconds - elapsedSeconds);
        }
        return 0;
    });

    // Give each earlier token to the counter that will free up first.
    for (let i = 0; i < peopleAhead; i += 1) {
        const earliest = availableIn.indexOf(Math.min(...availableIn));
        availableIn[earliest] += serviceSeconds;
    }
    const seconds = Math.ceil(Math.min(...availableIn));
    return {
        seconds: Math.min(seconds, maxStoredSeconds),
        basis: historical ? 'HISTORICAL' : 'DEFAULT',
    };
}

export async function withLiveEstimate(db, token) {
    let estimate = noEstimate;
    if (token.status === 'WAITING') {
        const [[inputs]] = await db.execute(
            `WITH recent AS (
                 SELECT started_at, completed_at
                 FROM tokens
                 WHERE service_id = ? AND status = 'COMPLETED'
                 ORDER BY completed_at DESC, id
                 LIMIT 30
             )
             SELECT s.default_service_seconds AS "defaultSeconds",
                    (SELECT CAST(count(*) AS DOUBLE) FROM recent) AS "sampleCount",
                    (SELECT CAST(avg(TIMESTAMPDIFF(MICROSECOND, started_at, completed_at)) AS DOUBLE) / 1000000
                     FROM recent) AS "meanSeconds",
                    coalesce((
                        SELECT json_arrayagg(json_object(
                            'status', active.status,
                            'elapsedSeconds', greatest(0,
                                CAST(TIMESTAMPDIFF(MICROSECOND, active.started_at, UTC_TIMESTAMP(6)) AS DOUBLE) / 1000000)
                        ))
                        FROM counters AS c
                        LEFT JOIN tokens AS active ON active.counter_id = c.id
                            AND active.status IN ('CALLED', 'IN_SERVICE')
                        WHERE c.service_id = s.id AND c.status = 'OPEN'
                    ), json_array()) AS counters
             FROM services AS s WHERE s.id = ?`,
            [token.serviceId, token.serviceId],
        );
        estimate = projectWait({ ...inputs, peopleAhead: token.position - 1 });
    }
    return {
        ...token,
        estimatedWaitSeconds: estimate.seconds,
        estimatedWaitBasis: estimate.basis,
    };
}
