const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Create reusable transporter object using SMTP transport
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || process.env.MAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true' || process.env.MAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.MAIL_USER || process.env.EMAIL_USER,
      pass: process.env.MAIL_PASS || process.env.EMAIL_PASS,
    },
  });
};

/**
 * Send email notification for new application
 * @param {Object} applicationData - Application form data
 * @returns {Promise<Object>} - Email send result
 */
const sendApplicationEmail = async (applicationData) => {
  try {
    const transporter = createTransporter();

    // Format certifications array
    const certifications = applicationData.certificationsRequested
      ? JSON.parse(applicationData.certificationsRequested).join(', ')
      : 'None specified';

    // Format email body
    const emailBody = `
      <h2>New Certification Application</h2>
      
      <h3>Contact Information:</h3>
      <p><strong>Name:</strong> ${applicationData.name || applicationData.contactPersonName || 'N/A'}</p>
      <p><strong>Email:</strong> ${applicationData.email || applicationData.contactEmail || 'N/A'}</p>
      <p><strong>Phone:</strong> ${applicationData.phone || applicationData.contactPhone || 'N/A'}</p>
      
      <h3>Company Information:</h3>
      <p><strong>Company Name:</strong> ${applicationData.companyName || 'N/A'}</p>
      <p><strong>Address:</strong> ${applicationData.companyAddress || 'N/A'}</p>
      <p><strong>Industry:</strong> ${applicationData.industry || 'N/A'}</p>
      <p><strong>Company Size:</strong> ${applicationData.companySize || 'N/A'}</p>
      <p><strong>Number of Employees:</strong> ${applicationData.numberOfEmployees || 'N/A'}</p>
      <p><strong>Number of Locations:</strong> ${applicationData.numberOfLocations || 'N/A'}</p>
      
      <h3>Contact Person Details:</h3>
      <p><strong>Name:</strong> ${applicationData.contactPersonName || 'N/A'}</p>
      <p><strong>Position:</strong> ${applicationData.contactPersonPosition || 'N/A'}</p>
      <p><strong>Email:</strong> ${applicationData.contactEmail || 'N/A'}</p>
      <p><strong>Phone:</strong> ${applicationData.contactPhone || 'N/A'}</p>
      
      <h3>Certification Details:</h3>
      <p><strong>Certifications Requested:</strong> ${certifications}</p>
      <p><strong>Current Certifications:</strong> ${applicationData.currentCertifications || 'None'}</p>
      <p><strong>Preferred Audit Date:</strong> ${applicationData.preferredAuditDate
        ? new Date(applicationData.preferredAuditDate).toLocaleDateString()
        : 'Not specified'}</p>
      
      ${applicationData.subject ? `<h3>Subject:</h3><p>${applicationData.subject}</p>` : ''}
      ${applicationData.message ? `<h3>Message:</h3><p>${applicationData.message}</p>` : ''}
      ${applicationData.additionalInfo ? `<h3>Additional Information:</h3><p>${applicationData.additionalInfo}</p>` : ''}
      
      <hr>
      <p><small>Submitted on: ${new Date().toLocaleString()}</small></p>
    `;

    const mailOptions = {
      from: `"HORAS-Cert Website" <${process.env.EMAIL_FROM || process.env.MAIL_USER || process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO || 'info@horas-cert.com',
      subject: 'New Certification Application',
      html: emailBody,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Error sending application email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send contact form email
 * @param {Object} contactData - Contact form data
 * @returns {Promise<Object>} - Email send result
 */
const sendContactEmail = async (contactData) => {
  try {
    const transporter = createTransporter();

    const emailBody = `
      <h2>New Contact Form Submission</h2>
      
      <h3>Contact Information:</h3>
      <p><strong>Name:</strong> ${contactData.name}</p>
      <p><strong>Email:</strong> ${contactData.email}</p>
      <p><strong>Phone:</strong> ${contactData.phone || 'N/A'}</p>
      
      <h3>Message Details:</h3>
      <p><strong>Subject:</strong> ${contactData.subject}</p>
      <p><strong>Message:</strong></p>
      <p>${contactData.message.replace(/\n/g, '<br>')}</p>
      
      <hr>
      <p><small>Submitted on: ${new Date().toLocaleString()}</small></p>
    `;

    const mailOptions = {
      from: `"HORAS-Cert Website" <${process.env.EMAIL_FROM || process.env.MAIL_USER || process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO || 'info@horas-cert.com',
      subject: `Contact Form: ${contactData.subject}`,
      html: emailBody,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Error sending contact email:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send certificate notification email
 * @param {Object} certificate - Certificate document
 * @returns {Promise<Object>} - Email send result
 */
const sendCertificateNotification = async (certificate) => {
  try {
    const transporter = createTransporter();

    const emailBody = `
      <h2>New Certificate Created</h2>
      
      <h3>Certificate Information:</h3>
      <p><strong>Certificate Number:</strong> ${certificate.certificateNumber}</p>
      <p><strong>Company Name:</strong> ${certificate.companyName}</p>
      <p><strong>Standard:</strong> ${certificate.standard}</p>
      <p><strong>Scope:</strong> ${certificate.scope}</p>
      <p><strong>Issue Date:</strong> ${certificate.issueDate ? new Date(certificate.issueDate).toLocaleDateString() : 'N/A'}</p>
      <p><strong>Expiry Date:</strong> ${certificate.expiryDate ? new Date(certificate.expiryDate).toLocaleDateString() : 'N/A'}</p>
      <p><strong>Status:</strong> ${certificate.status || 'active'}</p>
      
      <hr>
      <p><small>Created on: ${new Date().toLocaleString()}</small></p>
    `;

    const mailOptions = {
      from: `"HORAS-Cert Website" <${process.env.EMAIL_FROM || process.env.MAIL_USER || process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_TO || 'info@horas-cert.com',
      subject: `New Certificate Created: ${certificate.certificateNumber}`,
      html: emailBody,
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Error sending certificate notification email:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendApplicationEmail,
  sendContactEmail,
  sendCertificateNotification
};
