import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import bcrypt from 'bcryptjs';
import { createConnection } from 'mysql2/promise';
import { readConfig } from './config.js';

const [role, login, option] = process.argv.slice(2);
const validRoles = new Set(['ADMIN', 'STAFF', 'STUDENT']);

async function promptPassword() {
    if (!process.stdin.isTTY) throw new Error('Run from an interactive terminal or use --generate-password.');
    const hidden = new Writable({ write(_chunk, _encoding, done) { done(); } });
    const prompt = createInterface({ input: process.stdin, output: hidden, terminal: true });
    process.stdout.write('New account password (input hidden): ');
    try {
        return await prompt.question('');
    } finally {
        prompt.close();
        process.stdout.write('\n');
    }
}

async function main() {
    if (!validRoles.has(role) || !login || login.trim() !== login || login.length > 128
        || login.includes('\0') || (option && option !== '--generate-password')) {
        throw new Error('Usage: create-user.js ADMIN|STAFF|STUDENT login [--generate-password]');
    }

    const password = option === '--generate-password'
        ? randomBytes(24).toString('base64url')
        : await promptPassword();
    if (password.length < 8 || bcrypt.truncates(password) || password.includes('\0')) {
        throw new Error('Use at least 8 characters and at most 72 UTF-8 bytes.');
    }

    const hash = await bcrypt.hash(password, 12);
    const db = await createConnection({ ...readConfig().database, connectTimeout: 5_000 });
    try {
        await db.execute('INSERT INTO users (login, password_hash, role) VALUES (?, ?, ?)', [login, hash, role]);
        console.log(`Created ${role.toLowerCase()} account: ${login}`);
        if (option === '--generate-password') console.log(`One-time password: ${password}`);
    } finally {
        await db.end();
    }
}

main().catch((error) => {
    if (error.code === 'ER_DUP_ENTRY') {
        console.error('That login already exists. Choose another login.');
    } else {
        console.error(error.message);
    }
    process.exitCode = 1;
});
