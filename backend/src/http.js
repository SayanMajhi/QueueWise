export class HttpError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function invalidInput(message) {
    return new HttpError(400, 'INVALID_INPUT', message);
}

export function requireResourceId(value, label = 'Service ID') {
    const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
        throw invalidInput(`${label} must be a positive integer.`);
    }
    return id;
}

export function requireRole(role) {
    return (req, res, next) => {
        if (req.user.role !== role) {
            throw new HttpError(403, 'FORBIDDEN', 'Your account cannot perform this action.');
        }
        next();
    };
}
