const express = require('express');
const router = express.Router();
const {
    createTrainingCertificate,
    getAllTrainingCertificates,
    getTrainingCertificateById,
    updateTrainingCertificate,
    deleteTrainingCertificate,
    verifyTrainingCertificate,
} = require('../controllers/trainingCertificateController');
const { auth, restrictTo } = require('../middleware/auth');

// Public route - verify
router.get('/verify/:qrCode', verifyTrainingCertificate);

// Protected routes - Admin only
router.use(auth);
router.use(restrictTo('admin'));

router.route('/')
    .get(getAllTrainingCertificates)
    .post(createTrainingCertificate);

router.route('/:id')
    .get(getTrainingCertificateById)
    .put(updateTrainingCertificate)
    .delete(deleteTrainingCertificate);

module.exports = router;
