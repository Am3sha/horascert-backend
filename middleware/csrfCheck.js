const { ApiError } = require('./errorHandler');

const allowedOrigins = [
    'https://horascert.com',
    'https://www.horascert.com',
    'https://horsecert.vercel.app',
    'http://localhost:3000'
];

module.exports = function csrfCheck(req, res, next) {
    // Bypass CSRF entirely in development
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }

    // Safe methods should never be blocked by CSRF
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return next();
    }

    // Only apply CSRF checks to unsafe methods (POST, PUT, DELETE, PATCH)
    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // 1️⃣ Check Origin first
    if (origin && allowedOrigins.includes(origin)) {
        return next();
    }

    // 2️⃣ Fallback to Referer
    if (referer && allowedOrigins.some((allowed) => referer.startsWith(allowed))) {
        return next();
    }

    // Log the failure for debugging (remove in production if needed)
    console.error('CSRF Check Failed:', {
        method,
        origin,
        referer,
        allowedOrigins,
        ip: req.ip
    });

    return res.status(403).json({
        success: false,
        error: 'CSRFBlocked',
        message: 'Blocked by CSRF protection'
    });
};
