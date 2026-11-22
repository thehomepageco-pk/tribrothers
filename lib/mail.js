const nodemailer = require('nodemailer');

let cachedTransporter = null;
let cachedConfigKey = '';

function buildConfig(settings) {
  const s = settings || {};
  const user = s.mailUser || process.env.MAIL_USER || '';
  const pass = s.mailPass || process.env.MAIL_PASS || '';
  const service = s.mailService || process.env.MAIL_SERVICE || 'gmail';
  const host = s.mailHost || process.env.MAIL_HOST || '';
  const port = Number(s.mailPort || process.env.MAIL_PORT || 587);
  const from = s.mailFrom || process.env.MAIL_FROM || user;
  return { user, pass, service, host, port, from };
}

/**
 * Prefer IPv4 — many networks (esp. home/ISP) advertise IPv6 but cannot route
 * to Google SMTP, which surfaces as: connect EHOSTUNREACH 2a00:…:465
 */
function buildTransportOptions(cfg) {
  const auth = { user: cfg.user, pass: cfg.pass };
  const common = {
    auth,
    family: 4,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  };

  if (cfg.host) {
    const port = cfg.port || 587;
    return {
      ...common,
      host: cfg.host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
    };
  }

  const service = String(cfg.service || 'gmail').toLowerCase();
  if (service === 'gmail') {
    const port = cfg.port === 465 ? 465 : 587;
    return {
      ...common,
      host: 'smtp.gmail.com',
      port,
      secure: port === 465,
      requireTLS: port === 587,
    };
  }

  return {
    ...common,
    service: cfg.service || 'gmail',
  };
}

function getTransporter(settings) {
  const cfg = buildConfig(settings);
  const key = JSON.stringify(cfg);
  if (cachedTransporter && cachedConfigKey === key) {
    return { transporter: cachedTransporter, from: cfg.from };
  }
  if (!cfg.user || !cfg.pass) {
    return { transporter: null, from: cfg.from };
  }
  cachedTransporter = nodemailer.createTransport(buildTransportOptions(cfg));
  cachedConfigKey = key;
  return { transporter: cachedTransporter, from: cfg.from };
}

function resetTransporterCache() {
  cachedTransporter = null;
  cachedConfigKey = '';
}

function friendlyMailError(err) {
  const msg = String(err && err.message ? err.message : err || 'Mail send failed');
  if (/EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    return (
      'Cannot reach the mail server (network unreachable). ' +
      'This often happens when IPv6 is broken — the app now forces IPv4; restart the server and try again. ' +
      'Also confirm SMTP settings in Settings (Gmail: smtp.gmail.com, port 587, App Password).'
    );
  }
  if (/ETIMEDOUT|ECONNREFUSED|ESOCKET/i.test(msg)) {
    return (
      'Could not connect to the mail server. Check SMTP host/port in Settings, ' +
      'firewall/VPN, and that you are using a Gmail App Password (not your normal password).'
    );
  }
  if (/Invalid login|Authentication|EAUTH|535/i.test(msg)) {
    return (
      'Mail login failed. For Gmail, enable 2FA and use an App Password in Settings → Mail pass.'
    );
  }
  return msg;
}

module.exports = {
  getTransporter,
  resetTransporterCache,
  buildConfig,
  buildTransportOptions,
  friendlyMailError,
};
