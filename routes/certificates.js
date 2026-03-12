const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
    createCertificate,
    getCertificates,
    getCertificate,
    getCertificateQrPng,
    updateCertificate,
    deleteCertificate,
    verifyCertificate,
    deleteCertificateByCertificateId,
    updateCertificateByCertificateId,
    getCertificateStats
} = require('../controllers/certificateController');
const { auth, restrictTo } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// Rate limiter for certificate verification endpoint
const verificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many verification requests, please try again later.'
});

// Public routes - SPECIFIC ROUTES FIRST
router.get(
    '/',
    asyncHandler(getCertificates)
);

// ✅ VERIFY ENDPOINT - MUST BE BEFORE CATCH-ALL
router.get(
    '/verify/:certificateNumber',
    verificationLimiter,
    asyncHandler(verifyCertificate)
);

router.get(
    '/id/:id',
    asyncHandler(async (req, res, next) => {
        req.params.certificateNumber = req.params.id;
        return getCertificate(req, res, next);
    })
);

router.get(
    '/certificateId/:certificateId',
    asyncHandler(async (req, res, next) => {
        req.params.certificateNumber = req.params.certificateId;
        return getCertificate(req, res, next);
    })
);

router.get(
    '/:id/qr',
    asyncHandler(getCertificateQrPng)
);

// Protected routes (Admin only)
router.post(
    '/',
    auth,
    restrictTo('admin'),
    asyncHandler(createCertificate)
);

router.put(
    '/certificateId/:certificateId',
    auth,
    restrictTo('admin'),
    asyncHandler(updateCertificateByCertificateId)
);

router.delete(
    '/certificateId/:certificateId',
    auth,
    restrictTo('admin'),
    asyncHandler(deleteCertificateByCertificateId)
);

router.put(
    '/id/:id',
    auth,
    restrictTo('admin'),
    asyncHandler(updateCertificate)
);

router.delete(
    '/id/:id',
    auth,
    restrictTo('admin'),
    asyncHandler(deleteCertificate)
);

// Stats route (protected) - MUST be before catch-all
router.get(
    '/stats',
    auth,
    restrictTo('admin'),
    asyncHandler(getCertificateStats)
);

// ✅ CATCH-ALL ROUTE - MUST BE LAST
router.get(
    '/:certificateNumber',
    asyncHandler(getCertificate)
);

module.exports = router;
