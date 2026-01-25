const { ApiError } = require('./errorHandler');

const normalizeOrigin = (value) => {
    try {
        if (!value) return null;
        const url = new URL(String(value));
        return url.origin;
    } catch {
        return null;
    }
};

const csrfCheck = (req, res, next) => {
    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return next();
    }

    const frontendUrl = (process.env.FRONTEND_URL || '').trim();

    if (!frontendUrl) {
        if (process.env.NODE_ENV === 'production') {
            return next(new ApiError(500, 'CSRF protection is not configured'));
        }
        return next();
    }

    const expectedOrigin = normalizeOrigin(frontendUrl);
    const requestOrigin = normalizeOrigin(req.headers.origin);

    if (expectedOrigin && requestOrigin && requestOrigin === expectedOrigin) {
        return next();
    }

    const referer = String(req.headers.referer || '').trim();
    if (referer) {
        try {
            const refererOrigin = normalizeOrigin(referer);
            if (expectedOrigin && refererOrigin === expectedOrigin) {
                return next();
            }
        } catch {
            // ignore
        }

        const normalizedFrontendUrl = frontendUrl.replace(/\/+$/, '') + '/';
        if (referer.startsWith(normalizedFrontendUrl)) {
            return next();
        }
    }

    return res.status(403).json({
        success: false,
        error: 'CSRFBlocked',
        message: 'CSRF blocked'
    });
};

module.exports = csrfCheck;
