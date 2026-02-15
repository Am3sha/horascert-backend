const { ApiError } = require('./errorHandler');

const allowedOrigins = [
    'https://horascert.com',
    'https://www.horascert.com',
    'https://horascert-frontend.vercel.app',
    'http://localhost:3000'
];

module.exports = function csrfCheck(req, res, next) {
    if (process.env.NODE_ENV !== 'production') {
        return next(); // Allow everything in development
    }

    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return next();
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // 1️⃣ Check Origin first
    if (origin && allowedOrigins.includes(origin)) {
        return next();
    }

    // 2️⃣ Fallback to Referer
    if (
        referer &&
        allowedOrigins.some((allowed) => referer.startsWith(allowed))
    ) {
        return next();
    }

    return res.status(403).json({
        success: false,
        error: 'CSRFBlocked',
        message: 'Blocked by CSRF protection'
    });
};
