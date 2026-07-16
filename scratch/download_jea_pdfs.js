const fs = require('fs');
const path = require('path');
const https = require('https');

const targetFolder = path.join(__dirname, '..', 'jea_services_info');
if (!fs.existsSync(targetFolder)) {
  fs.mkdirSync(targetFolder, { recursive: true });
}

// Actual direct PDF links discovered on JEA website
const filesToDownload = [
  {
    url: 'https://www.jea.org.jo/EBV4.0/Root_Storage/AR/تعليمات_التأمين_الصحي_2026.pdf',
    filename: 'Health_Insurance_Instructions_2026.pdf'
  },
  {
    url: 'https://www.jea.org.jo/EBV4.0/Root_Storage/AR/برامج_المهندسين_وعائلاتهم.pdf',
    filename: 'Health_Insurance_Programs.pdf'
  },
  {
    url: 'https://www.jea.org.jo/EBV4.0/Root_Storage/AR/دليل_الخدمات.pdf',
    filename: 'JEA_Services_Guide.pdf'
  },
  {
    url: 'https://www.jea.org.jo/EBV4.0/Root_Storage/AR/إصدار_شهادة_عضوية-هوية_نقابية.pdf',
    filename: 'Membership_Syndicate_ID_Guide.pdf'
  }
];

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    // Correctly encode URLs with Arabic characters so HTTPS module doesn't crash
    const encodedUrl = encodeURI(url);
    https.get(encodedUrl, (response) => {
      // Handle HTTP redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: HTTP Status ${response.statusCode}`));
      }

      const fileStream = fs.createWriteStream(dest);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`Successfully downloaded: ${path.basename(dest)}`);
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
};

async function main() {
  console.log(`Starting downloads of actual JEA PDFs to folder: ${targetFolder}`);
  for (const item of filesToDownload) {
    const destPath = path.join(targetFolder, item.filename);
    try {
      console.log(`Downloading actual file: ${item.filename} ...`);
      await downloadFile(item.url, destPath);
    } catch (err) {
      console.error(`Failed to download ${item.filename}:`, err.message);
    }
  }
  console.log('All downloads completed!');
}

main();
