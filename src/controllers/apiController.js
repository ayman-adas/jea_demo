exports.getApiIndex = (req, res) => {
  res.json({
    message: 'JEA API Root',
    endpoints: [
      { method: 'GET', path: '/api/status', description: 'Get API/System status' },
      { method: 'GET', path: '/api/health', description: 'Get detailed system health report' },
      { method: 'POST', path: '/api/whatsapp/send', description: 'Send a WhatsApp message' },
      { method: 'POST', path: '/api/whatsapp/webhook', description: 'Webhook handler for incoming WhatsApp messages' }
    ]
  });
};

exports.getStatus = (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString()
  });
};

exports.getHealth = (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
};
