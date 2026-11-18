import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { parseCookie } from 'cookie';
import { Router } from 'express';
import { HttpError, invalidInput } from './http.js';
import { withTransaction } from './queue.js';

const cookieName = 'queuewise_session';
const sessionSeconds = 8 * 60 * 60;
const dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);

function tokenHash(token) {
    return createHash('sha256').update(token).digest('hex');
}

function sessionHash(req) {
    const token = parseCookie(req.headers.cookie ?? '')[cookieName];
    return /^[\w-]{43}$/.test(token) ? tokenHash(token) : null;
}

export function requireSession(pool) {
    return async (req, res, next) => {
        const hash = sessionHash(req);
        if (hash !== null) {
            const [rows] = await pool.execute(
                `SELECT u.id, u.login, u.role
                 FROM auth_sessions AS s
                 JOIN users AS u ON u.id = s.user_id
                 WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(6) AND u.is_active`,
                [hash],
            );
            if (rows.length > 0) {
                req.user = rows[0];
                req.sessionHash = hash;
                return next();
            }
        }
        throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    };
}

export function authRouter(pool, authenticate, secureCookies) {
    const router = Router();
    const cookieOptions = {
        httpOnly: true,
        sameSite: 'strict',
        secure: secureCookies,
        path: '/api',
    };

    router.post('/login', async (req, res) => {
        if (!req.is('application/json')) {
            throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send a JSON request body.');
        }

        const { login, password } = req.body ?? {};
        if (typeof login !== 'string' || !login.trim() || login.length > 128
            || typeof password !== 'string' || !password || bcrypt.truncates(password)
            || login.includes('\0') || password.includes('\0')) {
            throw invalidInput('Enter a valid login and password.');
        }

        const [[account]] = await pool.execute(
            `SELECT id, login, role, password_hash
             FROM users WHERE login = ? AND is_active`,
            [login.trim()],
        );
        const matches = await bcrypt.compare(password, account?.password_hash ?? dummyHash);
        if (!account || !matches) {
            throw new HttpError(401, 'INVALID_CREDENTIALS', 'Login or password is incorrect.');
        }

        const token = randomBytes(32).toString('base64url');
        await withTransaction(pool, async (db) => {
            await db.execute('DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP(6)');
            await db.execute(
                `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
                 VALUES (?, ?, TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(6)))`,
                [tokenHash(token), account.id, sessionSeconds],
            );
        });
        const { id, role } = account;
        res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionSeconds * 1_000 });
        res.json({ data: { id, login: account.login, role } });
    });

    router.get('/me', authenticate, (req, res) => {
        res.json({ data: req.user });
    });

    router.post('/logout', authenticate, async (req, res) => {
        await pool.execute('DELETE FROM auth_sessions WHERE token_hash = ?', [req.sessionHash]);
        res.clearCookie(cookieName, cookieOptions);
        res.json({ data: null });
    });

    return router;
}
