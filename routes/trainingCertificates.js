const express = require('express');
const router = express.Router();
const { certificateLimiter } = require('../middleware/rateLimiters');
const {
    createTrainingCertificate,
    getAllTrainingCertificates,
    getTrainingCertificateById,
    updateTrainingCertificate,
    deleteTrainingCertificate,
    verifyTrainingCertificate,
    getTrainingCertificateStats
} = require('../controllers/trainingCertificateController');
const { auth, restrictTo } = require('../middleware/auth');

// Public route - verify
router.get('/verify/:qrCode', verifyTrainingCertificate);

// Protected routes - Admin only
router.use(auth);
router.use(restrictTo('admin'));

router.route('/')
    .get(getAllTrainingCertificates)
    .post(certificateLimiter, createTrainingCertificate);

router.route('/stats')
    .get(getTrainingCertificateStats);

router.route('/:id')
    .get(getTrainingCertificateById)
    .put(updateTrainingCertificate)
    .delete(deleteTrainingCertificate);

module.exports = router;
