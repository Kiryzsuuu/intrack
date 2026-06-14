const AuditLog = require('../models/AuditLog');

/**
 * Simpan audit log (fire-and-forget, tidak pernah throw)
 * @param {Object} req  - express request (untuk userId & ip)
 * @param {string} aksi - e.g. 'task.approve', 'user.create', 'user.delete'
 * @param {Object} opts - { target, targetId, detail }
 */
async function log(req, aksi, { target = '', targetId = null, detail = {} } = {}) {
  try {
    await AuditLog.create({
      userId:   req.user._id,
      aksi,
      target,
      targetId: targetId || null,
      detail,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
    });
  } catch {}
}

module.exports = { log };
