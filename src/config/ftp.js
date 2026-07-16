const ftp = require('basic-ftp');

/**
 * Uploads a local file to the configured FTP server
 * @param {string} localFilePath - Path to the temporary file on local disk
 * @param {string} remoteFileName - Target filename on the FTP server
 * @returns {Promise<string>} - Returns the URL of the uploaded file
 */
const uploadToFTP = async (localFilePath, remoteFileName) => {
  const client = new ftp.Client();
  // Set connection timeouts
  client.ftp.verbose = process.env.NODE_ENV === 'development';

  try {
    await client.access({
      host: process.env.FTP_HOST || 'localhost',
      port: Number.parseInt(process.env.FTP_PORT || '21', 10),
      user: process.env.FTP_USER || 'root',
      password: process.env.FTP_PASSWORD,
      secure: true,
      secureOptions: {
        rejectUnauthorized: false
      }
    });

    const remoteDir = process.env.FTP_ROOT || '/public_html/uploads';
    // Ensure that remote directory path exists, if not create it
    await client.ensureDir(remoteDir);
    
    // Upload the file from stream/disk path
    await client.uploadFrom(localFilePath, remoteFileName);

    // Return reference url path of the uploaded file
    const publicUrl = `ftp://${process.env.FTP_HOST}${remoteDir}/${remoteFileName}`;
    return publicUrl;
  } catch (err) {
    console.error('FTP Upload helper exception:', err);
    throw err;
  } finally {
    client.close();
  }
};

module.exports = {
  uploadToFTP
};
