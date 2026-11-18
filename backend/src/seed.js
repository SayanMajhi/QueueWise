import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import bcrypt from 'bcryptjs';
import { createConnection } from 'mysql2/promise';
import { readConfig } from './config.js';

async function getDemoPassword() {
    if (process.env.DEMO_PASSWORD !== undefined) {
        return process.env.DEMO_PASSWORD;
    }
    if (!process.stdin.isTTY) {
        throw new Error('Use an interactive terminal or set DEMO_PASSWORD for a non-interactive seed.');
    }

    const hidden = new Writable({ write(chunk, encoding, done) { done(); } });
    const prompt = createInterface({ input: process.stdin, output: hidden, terminal: true });
    process.stdout.write('Choose a demo account password (input hidden): ');
    try {
        return await prompt.question('');
    } finally {
        prompt.close();
        process.stdout.write('\n');
    }
}

async function seed() {
    const { database } = readConfig();
    const script = await readFile(
        new URL('../../database/seeds/demo.sql', import.meta.url),
        'utf8',
    );
    const db = await createConnection({ ...database, connectTimeout: 5_000, multipleStatements: true });

    try {
        const password = await getDemoPassword();
        if (password.length < 8 || bcrypt.truncates(password) || password.includes('\0')) {
            throw new Error('Choose a demo password of at least 8 characters and at most 72 UTF-8 bytes.');
        }
        const hash = await bcrypt.hash(password, 12);
        await db.execute('SET @demo_password_hash = ?', [hash]);
        await db.query(script);
        console.log('Synthetic demo data is ready. A rerun preserves existing demo passwords.');
    } finally {
        await db.end();
    }
}

seed().catch((error) => {
    console.error('Demo seed failed:', error.message);
    process.exitCode = 1;
});
