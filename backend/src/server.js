import { createApp } from './app.js';
import { readConfig } from './config.js';
import { createPool } from './db.js';

async function start() {
    const config = readConfig();
    const pool = createPool(config.database);
    const app = createApp({
        pool,
        secureCookies: config.secureCookies,
        frontendDir: process.env.FRONTEND_DIR,
    });
    const server = app.listen(config.port, config.host, (error) => {
        if (error) {
            console.error('QueueWise could not start', { code: error.code });
            process.exitCode = 1;
            void pool.end();
            return;
        }
        console.log(`QueueWise API listening on ${config.host}:${config.port}`);
    });

    function shutdown() {
        process.removeListener('SIGINT', shutdown);
        process.removeListener('SIGTERM', shutdown);
        server.close(async () => {
            await pool.end();
        });
    }

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
