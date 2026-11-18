import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import bcrypt from 'bcryptjs';
import { createConnection } from 'mysql2/promise';
import { readConfig } from './config.js';

async function main() {
    const [login, ...extra] = process.argv.slice(2);
    if (!login || login.trim() !== login || login.length > 128 || login.includes('\0') || extra.length) {
        throw new Error('Usage: reset-password.js LOGIN');
    }
    if (!process.stdin.isTTY) throw new Error('Run this command from an interactive terminal.');

    const hidden = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const prompt = createInterface({ input: process.stdin, output: hidden, terminal: true });
    let password;
    try {
        process.stdout.write('New password (input hidden): ');
        password = await prompt.question('');
        process.stdout.write('\nConfirm password (input hidden): ');
        const confirmation = await prompt.question('');
        if (password !== confirmation) throw new Error('Passwords do not match.');
    } finally {
        prompt.close();
        process.stdout.write('\n');
    }
    if (password.length < 8 || bcrypt.truncates(password) || password.includes('\0')) {
        throw new Error('Use at least 8 characters and at most 72 UTF-8 bytes.');
    }

    const hash = await bcrypt.hash(password, 12);
    const db = await createConnection({ ...readConfig().database, connectTimeout: 5_000 });
    try {
        await db.beginTransaction();
        const [result] = await db.execute('UPDATE users SET password_hash = ? WHERE login = ?', [hash, login]);
        if (result.affectedRows !== 1) throw new Error('Account not found.');
        await db.execute('DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM users WHERE login = ?)', [login]);
        await db.commit();
        console.log(`Password updated for ${login}. Existing sessions have been signed out.`);
    } catch (error) {
        await db.rollback();
        throw error;
    } finally {
        await db.end();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
