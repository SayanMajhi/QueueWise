function nonempty(value, name) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${name} must be set`);
    }
    return value;
}

function portNumber(value, name) {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
        throw new Error(`${name} must be a port number from 1 to 65535`);
    }
    return Number(value);
}

export function readConfig(env = process.env) {
    return {
        host: nonempty(env.API_HOST ?? '127.0.0.1', 'API_HOST'),
        port: portNumber(env.API_PORT ?? '3000', 'API_PORT'),
        secureCookies: env.NODE_ENV === 'production',
        database: {
            host: nonempty(env.MYSQL_HOST ?? '127.0.0.1', 'MYSQL_HOST'),
            port: portNumber(env.MYSQL_PORT ?? '3307', 'MYSQL_PORT'),
            user: nonempty(env.MYSQL_USER ?? 'queuewise', 'MYSQL_USER'),
            database: nonempty(env.MYSQL_DATABASE ?? 'queuewise', 'MYSQL_DATABASE'),
            password: nonempty(env.MYSQL_PASSWORD, 'MYSQL_PASSWORD'),
        },
    };
}
