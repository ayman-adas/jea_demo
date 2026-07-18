'use strict';

/**
 * In-Memory Per-Phone FIFO Webhook Queue
 *
 * Architecture:
 *  - Twilio sends POST /webhook → route enqueues job → returns empty TwiML 200 immediately
 *  - Queue processes jobs one-at-a-time per phone (preserving message order)
 *  - Replies are sent as outbound Twilio messages instead of TwiML response
 *
 * This prevents:
 *  - Twilio timeouts (15s limit) on slow AI/DB operations
 *  - Race conditions when multiple messages arrive fast
 *  - Message reordering under heavy load
 */

const twilio = require('twilio');

class WebhookQueue {
  constructor() {
    /** @type {Map<string, Array<Job>>} Per-phone job queues */
    this.queues = new Map();

    /** @type {Set<string>} Phones currently being processed */
    this.processing = new Set();

    /** Aggregate stats */
    this.stats = {
      enqueued: 0,
      processed: 0,
      failed: 0,
      outboundSent: 0,
      outboundFailed: 0
    };

    /** Track start time for uptime */
    this.startedAt = new Date().toISOString();
  }

  /**
   * Enqueue a Twilio webhook body for async processing.
   * Called immediately when the POST /webhook request arrives.
   *
   * @param {string} phone  - Normalized phone (e.g. +96277...)
   * @param {object} body   - Raw req.body from Twilio (+ _host injected by route)
   * @returns {number} Current queue depth for this phone
   */
  enqueue(phone, body) {
    if (!this.queues.has(phone)) {
      this.queues.set(phone, []);
    }

    const job = {
      id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      phone,
      body,
      enqueuedAt: Date.now()
    };

    this.queues.get(phone).push(job);
    this.stats.enqueued++;

    const depth = this.queues.get(phone).length;
    console.log(`[Queue] ⬆ Enqueued ${job.id} for ${phone} (depth=${depth})`);

    // Start draining (no-op if already draining this phone)
    this._drain(phone);

    return depth;
  }

  /**
   * Begin processing the next job for a phone (if not already doing so).
   * @private
   */
  _drain(phone) {
    if (this.processing.has(phone)) return; // Already processing — will auto-continue

    const q = this.queues.get(phone);
    if (!q || q.length === 0) return;

    this.processing.add(phone);
    const job = q.shift();

    const startMs = Date.now();
    console.log(`[Queue] ▶ Processing ${job.id} for ${phone}`);

    this._processJob(job)
      .then(() => {
        const ms = Date.now() - startMs;
        this.stats.processed++;
        console.log(`[Queue] ✅ ${job.id} done in ${ms}ms (total processed: ${this.stats.processed})`);
      })
      .catch((err) => {
        this.stats.failed++;
        console.error(`[Queue] ❌ ${job.id} failed:`, err.message);
      })
      .finally(() => {
        this.processing.delete(phone);
        // Auto-drain: process next job if the queue for this phone isn't empty
        const remaining = this.queues.get(phone)?.length || 0;
        if (remaining > 0) {
          console.log(`[Queue] ↩ ${remaining} more job(s) pending for ${phone}, continuing...`);
          this._drain(phone);
        }
      });
  }

  /**
   * Core job processor:
   *  1. Runs the existing receiveWebhook handler with a mock req/res
   *  2. Captures the TwiML XML response
   *  3. Parses <Message> bodies from TwiML
   *  4. Sends each as an outbound Twilio message
   *
   * @private
   */
  async _processJob(job) {
    const { body } = job;

    // Lazy-require to avoid circular dependency on module load
    const { receiveWebhook } = require('../controllers/whatsappController');

    // ── Build mock request ──────────────────────────────────────────────────
    const mockReq = {
      body,
      headers: {
        'user-agent': 'TwilioProxy/1.1',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': body._host || 'localhost:3000'
      },
      get: (header) => {
        const h = (header || '').toLowerCase();
        if (h === 'host') return body._host || 'localhost:3000';
        if (h === 'user-agent') return 'TwilioProxy/1.1';
        return '';
      },
      protocol: 'https',
      ip: '127.0.0.1'
    };

    // ── Build mock response that captures TwiML output ─────────────────────
    let capturedTwiml = null;

    const mockRes = {
      _done: false,
      type() { return this; },
      set() { return this; },
      status(code) { return this; },
      send(data) {
        if (!this._done) { capturedTwiml = data; this._done = true; }
        return this;
      },
      sendStatus() { this._done = true; return this; },
      json() { this._done = true; return this; }
    };

    // ── Run the existing webhook handler ───────────────────────────────────
    await receiveWebhook(mockReq, mockRes, (err) => {
      if (err) throw err;
    });

    // ── Dispatch outbound replies if TwiML contained <Message> elements ─────
    if (capturedTwiml && typeof capturedTwiml === 'string') {
      await this._dispatchTwimlReplies(capturedTwiml, body);
    }
  }

  /**
   * Parse TwiML XML, extract all <Message> bodies, and send them via Twilio API.
   * @private
   */
  async _dispatchTwimlReplies(twimlXml, originalBody) {
    // Match all <Message>…</Message> elements (supports nested <Body> tag)
    const msgRegex = /<Message[^>]*>([\s\S]*?)<\/Message>/gi;
    const messages = [];
    let match;

    while ((match = msgRegex.exec(twimlXml)) !== null) {
      const inner = match[1];
      const bodyTagMatch = inner.match(/<Body>([\s\S]*?)<\/Body>/i);
      const rawText = bodyTagMatch ? bodyTagMatch[1] : inner;

      const text = rawText
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();

      if (text) messages.push(text);
    }

    if (messages.length === 0) {
      // Empty TwiML is normal for handover sessions or status callbacks
      return;
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken || accountSid.startsWith('ACXXXX')) {
      // Dev/test mode: just log what would be sent
      console.log(`[Queue] [DEV] Would send ${messages.length} message(s) to ${originalBody.From}:`);
      for (const m of messages) {
        console.log(`  → ${m.substring(0, 120)}${m.length > 120 ? '…' : ''}`);
      }
      return;
    }

    const client = twilio(accountSid, authToken);
    const from = originalBody.To || process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
    const to = originalBody.From;

    for (const msg of messages) {
      try {
        const result = await client.messages.create({ from, to, body: msg });
        this.stats.outboundSent++;
        console.log(`[Queue] 📤 Outbound sent. SID=${result.sid}`);
      } catch (err) {
        this.stats.outboundFailed++;
        console.error(`[Queue] 📤❌ Outbound send failed:`, err.message);
      }
    }
  }

  /**
   * Get a full snapshot of queue state for monitoring/admin.
   */
  getStatus() {
    const pendingByPhone = {};
    let totalPending = 0;

    for (const [phone, q] of this.queues.entries()) {
      if (q.length > 0) {
        pendingByPhone[phone] = q.length;
        totalPending += q.length;
      }
    }

    return {
      healthy: true,
      startedAt: this.startedAt,
      stats: this.stats,
      active: {
        count: this.processing.size,
        phones: [...this.processing]
      },
      pending: {
        totalJobs: totalPending,
        byPhone: pendingByPhone
      }
    };
  }

  /**
   * Drain all remaining jobs synchronously (for graceful shutdown or tests).
   */
  async drainAll() {
    const promises = [];
    for (const [phone, q] of this.queues.entries()) {
      for (const job of q) {
        promises.push(this._processJob(job).catch(() => {}));
      }
      this.queues.set(phone, []);
    }
    await Promise.all(promises);
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────
const webhookQueue = new WebhookQueue();
module.exports = webhookQueue;
