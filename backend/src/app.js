import express from 'express';
import { adminRouter } from './admin.js';
import { authRouter, requireSession } from './auth.js';
import { counterRouter } from './counters.js';
import { HttpError } from './http.js';
import { servicesRouter } from './services.js';
import { tokenRouter } from './tokens.js';

export function createApp({ pool, secureCookies = false, log = console, frontendDir }) {
    const app = express();
    app.disable('x-powered-by');
    app.use('/api', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    app.use('/api', express.json({ limit: '16kb' }));

    app.get('/api/health', async (req, res) => {
        try {
            await pool.query('SELECT 1 FROM auth_sessions LIMIT 0');
        } catch (error) {
            log.error('Database readiness check failed', { code: error.code });
            throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database is unavailable.');
        }
        res.json({ data: { status: 'ok' } });
    });

    const authenticate = requireSession(pool);
    app.use('/api/auth', authRouter(pool, authenticate, secureCookies));
    app.use('/api', adminRouter(pool, authenticate));
    app.use('/api/services', authenticate, servicesRouter(pool));
    app.use('/api/tokens', authenticate, tokenRouter(pool));
    app.use(['/api/staff', '/api/counters'], authenticate);
    app.use('/api', counterRouter(pool));

    if (frontendDir) {
        app.use(express.static(frontendDir, { index: false }));
        app.get(['/', '/student', '/student/history', '/staff', '/admin'], (req, res) => {
            res.sendFile('index.html', { root: frontendDir });
        });
    }

    app.use((req, res, next) => {
        next(new HttpError(404, 'NOT_FOUND', 'Endpoint was not found.'));
    });

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }
        if (error.type === 'entity.parse.failed') {
            error = new HttpError(400, 'INVALID_JSON', 'Request body contains invalid JSON.');
        } else if (error.type === 'entity.too.large') {
            error = new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 16 KB.');
        } else if (error.status === 415 && !(error instanceof HttpError)) {
            error = new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported request encoding.');
        } else if (error.status === 400 && !(error instanceof HttpError)) {
            error = new HttpError(400, 'INVALID_INPUT', 'Request could not be read.');
        }

        if (!(error instanceof HttpError)) {
            log.error('Unhandled API error', { name: error.name, code: error.code });
            error = new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
        }
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
    });

    return app;
}
