import { readdir, readFile } from 'node:fs/promises';
import { createConnection } from 'mysql2/promise';
import { readConfig } from './config.js';

const directory = new URL('../../database/migrations/', import.meta.url);

async function migrate() {
    const { database } = readConfig();
    const client = await createConnection({
        ...database,
        connectTimeout: 5_000,
        multipleStatements: true,
    });
    try {
        const [[{ acquired }]] = await client.execute(
            "SELECT GET_LOCK(SHA2(CONCAT('queuewise:migrations:', DATABASE()), 256), 30) AS acquired",
        );
        if (acquired !== 1) {
            throw new Error('Could not acquire the database migration lock.');
        }

        await client.query(`CREATE TABLE IF NOT EXISTS queuewise_schema_migrations (
            version INT PRIMARY KEY,
            applied_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
        ) ENGINE=InnoDB`);
        const [applied] = await client.query('SELECT version FROM queuewise_schema_migrations');
        const versions = new Set(applied.map(({ version }) => version));
        const files = (await readdir(directory)).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
        for (const file of files) {
            const version = Number.parseInt(file, 10);
            if (!versions.has(version)) {
                // MySQL commits DDL implicitly. Each migration can be reapplied after a partial failure.
                await client.query(await readFile(new URL(file, directory), 'utf8'));
                await client.execute('INSERT INTO queuewise_schema_migrations (version) VALUES (?)', [version]);
                versions.add(version);
                console.log(`Applied ${file}`);
            }
        }
        console.log('QueueWise database migrations are current.');
    } finally {
        await client.end();
    }
}

migrate().catch((error) => {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
});
