const nodemailer = require('nodemailer');
const https = require('https');
const logger = require('../utils/logger');

// Create reusable transporter object using SMTP transport
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || process.env.MAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true' || process.env.MAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.MAIL_USER || process.env.EMAIL_USER,
      pass: process.env.MAIL_PASS || process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD,
    },
  });
};

const RESEND_API_HOST = 'api.resend.com';

const getRecipients = () => {
  const raw = String(process.env.EMAIL_TO || 'info@horascert.com');
  const recipients = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return recipients.length > 1 ? recipients : recipients[0];
};

const getFromAddress = (displayName) => {
  const fromEmail = process.env.EMAIL_FROM || process.env.MAIL_USER || process.env.EMAIL_USER;
  if (!fromEmail) return null;
  if (displayName) {
    return `"${displayName}" <${fromEmail}>`;
  }
  return String(fromEmail);
};

const sendWithResend = async ({ from, to, subject, html }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const payload = JSON.stringify({ from, to, subject, html });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        host: RESEND_API_HOST,
        path: '/emails',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30_000
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : null;
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
              return;
            }

            const message =
              (parsed && parsed.message) ||
              (parsed && parsed.error && parsed.error.message) ||
              `Resend API error (${res.statusCode || 'unknown'})`;
            reject(new Error(message));
          } catch (e) {
            reject(new Error(`Resend API invalid response (${res.statusCode || 'unknown'})`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Resend request timeout'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
};

const sendEmail = async ({ from, to, subject, html }) => {
  if (process.env.RESEND_API_KEY) {
    const result = await sendWithResend({ from, to, subject, html });
    return { messageId: result && result.id };
  }

  const transporter = createTransporter();
  return transporter.sendMail({ from, to, subject, html });
};

/**
 * Helper: Format field for email display
 * Returns formatted HTML or empty string (doesn't show field if value is falsy)
 */
const formatField = (label, value) => {
  if (!value || value === 'N/A' || value === 'Not specified' || value === 'undefined') {
    return '';
  }
  return `<p><strong>${label}:</strong> ${value}</p>`;
};

/**
 * Helper: Build address from components
 * Only shows non-empty parts, properly formatted
 */
const buildAddress = (address1, address2, city, state, postal, country) => {
  const parts = [address1, address2, city, state, postal, country]
    .filter(part => part && part.trim() && part !== 'undefined')
    .join(', ');
  return parts || null;
};

/**
 * Send email notification for new application
 * @param {Object} applicationData - Complete application form data
 * @returns {Promise<Object>} - Email send result
 */
const sendApplicationEmail = async (applicationData) => {
  try {
    // Parse certifications array safely
    const certifications = applicationData.certificationsRequested
      ? (typeof applicationData.certificationsRequested === 'string'
        ? JSON.parse(applicationData.certificationsRequested)
        : applicationData.certificationsRequested)
      : [];
    const certificationsText = Array.isArray(certifications) && certifications.length > 0
      ? certifications.join(', ')
      : null;

    // Build address from components
    const formattedAddress = buildAddress(
      applicationData.addressLine1,
      applicationData.addressLine2,
      applicationData.city,
      applicationData.state,
      applicationData.postalCode,
      applicationData.country
    );

    // ========================================================================
    // Build email HTML with only non-empty fields
    // Uses helper functions to avoid N/A and undefined values
    // ========================================================================
    let emailHTML = '<h2>New Certification Application</h2>';

    const isYes = (value) => String(value || '').trim().toLowerCase() === 'yes';
    const yesNoValue = (value) => {
      const v = String(value || '').trim().toLowerCase();
      if (v === 'yes') return 'Yes';
      if (v === 'no') return 'No';
      return value;
    };

    // Contact Information Section
    emailHTML += '<h3>Contact Information:</h3>';
    emailHTML += formatField('Name', applicationData.contactPersonName || applicationData.name);
    emailHTML += formatField('Email', applicationData.contactEmail || applicationData.email);
    emailHTML += formatField('Phone', applicationData.contactPhone || applicationData.phone);

    // Company Information Section
    emailHTML += '<h3>Company Information:</h3>';
    emailHTML += formatField('Company Name', applicationData.companyName);
    emailHTML += formatField('Address', formattedAddress);
    emailHTML += formatField('Website', applicationData.website);
    emailHTML += formatField('Telephone', applicationData.telephone);
    emailHTML += formatField('Fax', applicationData.fax);
    emailHTML += formatField('Industry', applicationData.industry);
    emailHTML += formatField('Company Size', applicationData.companySize);
    emailHTML += formatField('Number of Employees', applicationData.numberOfEmployees);
    emailHTML += formatField('Number of Locations', applicationData.numberOfLocations);

    // Contact Person Details Section
    emailHTML += '<h3>Contact Person Details:</h3>';
    emailHTML += formatField('Name', applicationData.contactPersonName);
    emailHTML += formatField('Position', applicationData.contactPersonPosition);
    emailHTML += formatField('Mobile', applicationData.contactPersonMobile);
    emailHTML += formatField('Email', applicationData.contactPersonEmail);

    // Executive Manager Details Section
    if (applicationData.executiveManagerName || applicationData.executiveManagerEmail || applicationData.executiveManagerMobile) {
      emailHTML += '<h3>Executive Manager Details:</h3>';
      emailHTML += formatField('Name', applicationData.executiveManagerName);
      emailHTML += formatField('Mobile', applicationData.executiveManagerMobile);
      emailHTML += formatField('Email', applicationData.executiveManagerEmail);
    }

    // Certification Details Section
    emailHTML += '<h3>Certification Details:</h3>';
    if (certificationsText) {
      emailHTML += formatField('Certifications Requested', certificationsText);
    }
    emailHTML += formatField('Certification Programme', applicationData.certificationProgramme);
    emailHTML += formatField('Current Certifications', applicationData.currentCertifications);
    if (applicationData.transferReason) {
      emailHTML += formatField('Transfer Reason', applicationData.transferReason);
      emailHTML += formatField('Transfer Expiring Date', applicationData.transferExpiringDate);
    }
    if (applicationData.preferredAuditDate) {
      const auditDate = new Date(applicationData.preferredAuditDate);
      emailHTML += formatField('Preferred Audit Date', auditDate.toLocaleDateString());
    }

    // Workforce Details Section
    if (applicationData.workforceTotalEmployees || applicationData.workforceEmployeesPerShift ||
      applicationData.workforceNumberOfShifts || applicationData.workforceSeasonalEmployees) {
      emailHTML += '<h3>Workforce Details:</h3>';
      emailHTML += formatField('Total Employees', applicationData.workforceTotalEmployees);
      emailHTML += formatField('Employees Per Shift', applicationData.workforceEmployeesPerShift);
      emailHTML += formatField('Number of Shifts', applicationData.workforceNumberOfShifts);
      emailHTML += formatField('Seasonal Employees', applicationData.workforceSeasonalEmployees);
    }

    // ISO 9001 Details Section
    if (applicationData.iso9001DesignAndDevelopment || applicationData.iso9001OtherNonApplicableClauses) {
      emailHTML += '<h3>ISO 9001 Details:</h3>';
      emailHTML += formatField('Design and Development', yesNoValue(applicationData.iso9001DesignAndDevelopment));
      emailHTML += formatField('Other Non-Applicable Clauses', yesNoValue(applicationData.iso9001OtherNonApplicableClauses));
      if (isYes(applicationData.iso9001OtherNonApplicableClauses)) {
        emailHTML += formatField('Details', applicationData.iso9001OtherNonApplicableClausesText);
      }
    }

    // ISO 14001 Details Section
    if (applicationData.iso14001SitesManaged || applicationData.iso14001RegisterOfSignificantAspects ||
      applicationData.iso14001EnvironmentalManagementManual || applicationData.iso14001InternalAuditProgramme) {
      emailHTML += '<h3>ISO 14001 Details:</h3>';
      emailHTML += formatField('Sites Managed', applicationData.iso14001SitesManaged);
      emailHTML += formatField('Register of Significant Aspects', yesNoValue(applicationData.iso14001RegisterOfSignificantAspects));
      emailHTML += formatField('Environmental Management Manual', yesNoValue(applicationData.iso14001EnvironmentalManagementManual));
      emailHTML += formatField('Internal Audit Programme', yesNoValue(applicationData.iso14001InternalAuditProgramme));
      if (isYes(applicationData.iso14001InternalAuditProgramme)) {
        emailHTML += formatField('Internal Audit Implemented', yesNoValue(applicationData.iso14001InternalAuditImplemented));
      }
    }

    // ISO 22000 Details Section
    if (applicationData.iso22000HaccpImplementation || applicationData.iso22000Sites) {
      emailHTML += '<h3>ISO 22000 Details:</h3>';
      emailHTML += formatField('HACCP Implementation', yesNoValue(applicationData.iso22000HaccpImplementation));
      if (isYes(applicationData.iso22000HaccpImplementation)) {
        emailHTML += formatField('HACCP Studies', applicationData.iso22000HaccpStudies);
        emailHTML += formatField('Sites', applicationData.iso22000Sites);
        emailHTML += formatField('Process Lines', applicationData.iso22000ProcessLines);
        emailHTML += formatField('Processing Type', applicationData.iso22000ProcessingType);
      }
    }

    // ISO 45001 Details Section
    if (applicationData.iso45001HazardsIdentified || applicationData.iso45001CriticalRisks) {
      emailHTML += '<h3>ISO 45001 Details:</h3>';
      emailHTML += formatField('Hazards Identified', yesNoValue(applicationData.iso45001HazardsIdentified));
      if (isYes(applicationData.iso45001HazardsIdentified)) {
        emailHTML += formatField('Critical Risks', applicationData.iso45001CriticalRisks);
      }
    }

    // Uploaded Files Section
    if (applicationData.uploadedFiles && Array.isArray(applicationData.uploadedFiles) && applicationData.uploadedFiles.length > 0) {
      emailHTML += '<h3>Uploaded Files:</h3>';
      emailHTML += '<ul>';
      applicationData.uploadedFiles.forEach(file => {
        const fileUrl = (file && file.publicUrl)
          ? file.publicUrl
          : `${process.env.API_URL || 'http://localhost:5001'}/api/v1/applications/${applicationData.requestId}/file/${encodeURIComponent(file.storageKey)}`;
        emailHTML += `<li><a href="${fileUrl}">${file.name}</a> (${file.size ? Math.round(file.size / 1024) + ' KB' : 'unknown size'})</li>`;
      });
      emailHTML += '</ul>';
    }

    // Additional Information Section
    if (applicationData.additionalInfo) {
      emailHTML += '<h3>Additional Information:</h3>';
      emailHTML += `<p>${applicationData.additionalInfo.replace(/\n/g, '<br>')}</p>`;
    }

    // Footer
    emailHTML += '<hr>';
    emailHTML += `<p><small>Submitted on: ${new Date().toLocaleString()}</small></p>`;

    const from = getFromAddress('HORAS-Cert Website');
    if (!from) {
      throw new Error('EMAIL_FROM is not set');
    }

    const mailOptions = {
      from,
      to: getRecipients(),
      subject: 'New Certification Application',
      html: emailHTML,
    };

    const info = await sendEmail(mailOptions);
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

    const from = getFromAddress('HORA Website');
    if (!from) {
      throw new Error('EMAIL_FROM is not set');
    }

    const mailOptions = {
      from,
      to: getRecipients(),
      subject: `Contact Form: ${contactData.subject}`,
      html: emailBody,
    };

    const info = await sendEmail(mailOptions);
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

    const from = getFromAddress('Horascert.com');
    if (!from) {
      throw new Error('EMAIL_FROM is not set');
    }

    const mailOptions = {
      from,
      to: getRecipients(),
      subject: `New Certificate Created: ${certificate.certificateNumber}`,
      html: emailBody,
    };

    const info = await sendEmail(mailOptions);
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
