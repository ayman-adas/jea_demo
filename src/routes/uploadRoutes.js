const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { uploadToFTP } = require('../config/ftp');

// Ensure local temporary upload directory exists
const tempUploadDir = path.join(__dirname, '..', '..', 'tmp_uploads');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

// Config Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + crypto.randomUUID();
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * POST /api/v1/upload
 * Form field name: "file"
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      const err = new Error('No file provided under "file" field name.');
      err.statusCode = 400;
      throw err;
    }

    const localPath = req.file.path;
    const remoteName = req.file.filename;

    console.log(`Starting FTP upload for temporary file: ${localPath} -> ${remoteName}...`);
    const fileUrl = await uploadToFTP(localPath, remoteName);

    // Clean up local temp file asynchronously
    fs.unlink(localPath, (unlinkErr) => {
      if (unlinkErr) console.error('Failed to delete temporary local file:', unlinkErr.message);
    });

    res.json({
      success: true,
      message: 'File uploaded successfully to FTP storage.',
      url: fileUrl
    });
  } catch (err) {
    // Make sure to clean up file if error occurs
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, () => {});
    }
    next(err);
  }
});

module.exports = router;
