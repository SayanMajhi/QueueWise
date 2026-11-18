import mysql from 'mysql2/promise';

export function createPool(config) {
    return mysql.createPool({
        ...config,
        connectTimeout: 3_000,
        timezone: 'Z',
        dateStrings: ['DATE'],
        supportBigNumbers: true,
        bigNumberStrings: true,
    });
}
