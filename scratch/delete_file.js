const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '..', 'jea_services_info', 'Health_Insurance_Application_Form.pdf');

try {
  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
    console.log('Successfully deleted Health_Insurance_Application_Form.pdf');
  } else {
    console.log('File does not exist.');
  }
  process.exit(0);
} catch (err) {
  console.error('Failed to delete file:', err.message);
  process.exit(1);
}
