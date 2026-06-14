const router    = require('express').Router();
const Task      = require('../models/Task');
const User      = require('../models/User');
const Subtask   = require('../models/Subtask');
const Evidence  = require('../models/Evidence');
const StatusLog = require('../models/StatusLog');
const auth      = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const notifSvc  = require('../services/notifikasi');
const mailer    = require('../services/mailer');
const wa        = require('../services/whatsapp');
const { simpanSnapshot } = require('../services/kpi');
const push      = require('../services/push');
const audit     = require('../services/audit');

// ── Helper: cek apakah user bisa lihat task ───────────────────────────────────
function canView(user, task) {
  if (user.role === 'superadmin' || user.role === 'direksi' || user.role === 'komisaris') return true;
  const userDirId = user.direktoratId?._id?.toString() || user.direktoratId?.toString();
  const taskDirId = task.direktoratId?._id?.toString() || task.direktoratId?.toString();
  if (userDirId === taskDirId) return true;
  // Collaborator bisa lihat
  const isCollab = (task.collaborators || []).map(c => c._id?.toString() || c.toString()).includes(user._id.toString());
  return isCollab;
}

// ── GET /api/tasks ────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  const { status, prioritas, direktoratId, picUserId, search, page = 1, limit = 50, arsip } = req.query;

  const filter = { isDeleted: false };

  if (arsip === 'true') {
    filter.archivedAt = { $ne: null };
  } else {
    filter.archivedAt = null;
  }

  // Isolasi direktorat: superadmin & direksi & komisaris bisa lihat semua
  if (req.user.role === 'manager' || req.user.role === 'staff') {
    const userDirId = req.user.direktoratId?._id || req.user.direktoratId;
    filter.direktoratId = userDirId;
  } else if (direktoratId) {
    filter.direktoratId = direktoratId;
  }

  if (status)     filter.status    = status;
  if (prioritas)  filter.prioritas = prioritas;
  if (picUserId)  filter.picUserId = picUserId;
  if (search)     filter.judul     = { $regex: search, $options: 'i' };

  const total = await Task.countDocuments(filter);
  const tasks = await Task.find(filter)
    .populate('picUserId', 'namaLengkap email fotoProfil')
    .populate('dibuatOleh', 'namaLengkap')
    .populate('direktoratId', 'nama kode')
    .populate('collaborators', 'namaLengkap fotoProfil')
    .sort({ deadline: 1, createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  res.json({ total, page: parseInt(page), tasks });
});

// ── GET /api/tasks/deleted — Direksi lihat arsip soft-delete ─────────────────
router.get('/deleted', auth, requireRole('direksi'), async (req, res) => {
  const tasks = await Task.find({ isDeleted: true })
    .populate('picUserId', 'namaLengkap')
    .populate('direktoratId', 'nama kode')
    .sort({ deletedAt: -1 });
  res.json(tasks);
});

// ── PUT /api/tasks/bulk-status — batch status update ─────────────────────────
router.put('/bulk-status', auth, async (req, res) => {
  const { taskIds, statusBaru, catatan } = req.body;
  if (!taskIds?.length || !statusBaru)
    return res.status(400).json({ message: 'taskIds dan statusBaru wajib diisi' });

  const validStatus = ['to_do','in_progress','perlu_review','revisi','done','ditolak','menunggu_approval'];
  if (!validStatus.includes(statusBaru))
    return res.status(400).json({ message: 'Status tidak valid' });

  const isDireksi   = req.user.role === 'direksi' || req.user.role === 'superadmin';
  const isPICChange = ['in_progress','perlu_review'].includes(statusBaru);

  let updated = 0;
  for (const id of taskIds) {
    try {
      const task = await Task.findById(id).populate('picUserId');
      if (!task) continue;

      // Permission check: direksi bisa approve/reject, PIC bisa ubah progress
      const isPIC = task.picUserId?._id?.toString() === req.user._id.toString();
      if (!isDireksi && !isPIC) continue;
      if (['to_do','ditolak'].includes(statusBaru) && !isDireksi) continue;

      const prev = task.status;
      task.status = statusBaru;
      if (statusBaru === 'done') task.doneAt = new Date();
      if (statusBaru === 'to_do' && prev === 'menunggu_approval') task.approvedAt = new Date();
      await task.save();
      updated++;
    } catch {}
  }

  res.json({ message: `${updated} task berhasil diupdate`, updated });
});

// ── POST /api/tasks ───────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  const { judul, deskripsi, picUserId, prioritas, deadline, tags, collaborators } = req.body;

  // Validasi field wajib
  if (!judul || !deskripsi || !picUserId || !prioritas || !deadline)
    return res.status(400).json({ message: 'Judul, deskripsi, PIC, prioritas, dan deadline wajib diisi' });
  if (new Date(deadline) < new Date())
    return res.status(400).json({ message: 'Deadline tidak boleh di masa lalu' });
  if (judul.length > 150)
    return res.status(400).json({ message: 'Judul maksimal 150 karakter' });

  const pic = await User.findById(picUserId).populate('direktoratId');
  if (!pic) return res.status(400).json({ message: 'PIC tidak ditemukan' });

  // Isolasi direktorat untuk Manager
  if (req.user.role === 'manager') {
    const myDir  = req.user.direktoratId?._id?.toString() || req.user.direktoratId?.toString();
    const picDir = pic.direktoratId?._id?.toString() || pic.direktoratId?.toString();
    if (myDir !== picDir)
      return res.status(403).json({ message: 'Manager hanya dapat assign task ke Manager di direktorat yang sama' });
  }

  // Validasi duplikasi (warning saja)
  let warningDuplikasi = null;
  const tiga = 3 * 24 * 3600 * 1000;
  const dup = await Task.findOne({
    picUserId,
    judul: judul.trim(),
    isDeleted: false,
    deadline: {
      $gte: new Date(new Date(deadline) - tiga),
      $lte: new Date(new Date(deadline) + tiga),
    },
  });
  if (dup) warningDuplikasi = 'Terdapat task dengan judul serupa dan deadline berdekatan';

  // Status awal
  const statusAwal = req.user.role === 'direksi' ? 'to_do' : 'menunggu_approval';
  const approvedAt = req.user.role === 'direksi' ? new Date() : null;

  const task = await Task.create({
    judul: judul.trim(),
    deskripsi,
    picUserId,
    dibuatOleh: req.user._id,
    direktoratId: pic.direktoratId?._id || pic.direktoratId,
    prioritas,
    status: statusAwal,
    deadline: new Date(deadline),
    tags: tags ? tags.slice(0, 5) : [],
    collaborators: collaborators || [],
    approvedAt,
  });

  // Log status
  await StatusLog.create({
    taskId:     task._id,
    userId:     req.user._id,
    statusLama: null,
    statusBaru: statusAwal,
    catatan:    'Task dibuat',
  });

  // Notifikasi
  if (req.user.role === 'manager') {
    const direksi = await User.find({ role: 'direksi', statusAktif: true });
    await notifSvc.notifTaskMenungguApproval(direksi, task, req.user);
    if (req.user.notifEmail) await mailer.mailTaskApproved(req.user, task).catch(() => {});
  } else {
    // Direksi buat task — notif ke PIC
    if (pic._id.toString() !== req.user._id.toString()) {
      await notifSvc.notifTaskApproved(pic, task);
    }
  }

  await task.populate(['picUserId', 'dibuatOleh', 'direktoratId']);
  audit.log(req, 'task.create', { target:'Task', targetId: task._id, detail: { judul: task.judul } });
  res.status(201).json({ task, warningDuplikasi });
});

// ── GET /api/tasks/:id ────────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  const task = await Task.findById(req.params.id)
    .populate('picUserId', 'namaLengkap email fotoProfil direktoratId')
    .populate('dibuatOleh', 'namaLengkap email')
    .populate('direktoratId', 'nama kode')
    .populate('collaborators', 'namaLengkap email fotoProfil');

  if (!task || (task.isDeleted && req.user.role !== 'direksi'))
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  if (!canView(req.user, task))
    return res.status(403).json({ message: 'Akses ditolak: bukan direktorat Anda' });

  // Subtasks, Evidence, Logs
  const [subtasks, evidences, logs] = await Promise.all([
    Subtask.find({ taskId: task._id }).sort({ urutan: 1 }),
    Evidence.find({ taskId: task._id }).populate('uploaderId', 'namaLengkap'),
    StatusLog.find({ taskId: task._id })
      .populate('userId', 'namaLengkap')
      .sort({ createdAt: 1 }),
  ]);

  res.json({ task, subtasks, evidences, logs });
});

// ── PUT /api/tasks/:id ────────────────────────────────────────────────────────
router.put('/:id', auth, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task || task.isDeleted)
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  if (!canView(req.user, task))
    return res.status(403).json({ message: 'Akses ditolak' });

  const isDireksi = req.user.role === 'direksi';
  const isPembuat = task.dibuatOleh.toString() === req.user._id.toString();
  const isPIC     = task.picUserId.toString() === req.user._id.toString();

  // Rule FR-TSK-12: siapa yang boleh edit
  const editableStatuses = ['menunggu_approval', 'to_do'];
  if (!isDireksi && !isPembuat && !isPIC)
    return res.status(403).json({ message: 'Hanya pembuat atau Direksi yang dapat mengedit task' });
  if (!isDireksi && !editableStatuses.includes(task.status))
    return res.status(400).json({ message: 'Task hanya dapat diedit saat status Menunggu Approval atau To Do' });
  if (!isDireksi && task.status === 'done')
    return res.status(400).json({ message: 'Task Done tidak dapat diedit' });

  const allowed = ['judul', 'deskripsi', 'prioritas', 'deadline', 'tags', 'collaborators'];
  if (isDireksi) allowed.push('picUserId', 'catatanDireksi');

  allowed.forEach(f => {
    if (req.body[f] !== undefined) task[f] = req.body[f];
  });

  await task.save();
  res.json({ message: 'Task berhasil diupdate', task });
});

// ── POST /api/tasks/:id/cover — Upload cover image (base64) ──────────────────
router.post('/:id/cover', auth, async (req, res) => {
  const { base64 } = req.body;
  if (!base64) return res.status(400).json({ message: 'Data foto tidak ditemukan' });
  if (!base64.startsWith('data:image/')) return res.status(400).json({ message: 'Format tidak valid' });
  if (base64.length > 2.8 * 1024 * 1024) return res.status(400).json({ message: 'Ukuran foto maksimal 2MB' });

  const task = await Task.findById(req.params.id);
  if (!task || task.isDeleted) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const canEdit = req.user.role === 'superadmin' || req.user.role === 'direksi' ||
    task.picUserId.toString() === req.user._id.toString() ||
    task.dibuatOleh.toString() === req.user._id.toString();
  if (!canEdit) return res.status(403).json({ message: 'Akses ditolak' });

  task.coverImage = base64;
  await task.save();
  res.json({ coverImage: base64 });
});

// ── PUT /api/tasks/:id/status ─────────────────────────────────────────────────
router.put('/:id/status', auth, async (req, res) => {
  const { statusBaru, catatan } = req.body;
  if (!statusBaru) return res.status(400).json({ message: 'Status baru wajib diisi' });

  const task = await Task.findById(req.params.id).populate('picUserId').populate('dibuatOleh');
  if (!task || task.isDeleted)
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  const isDireksi = req.user.role === 'direksi';
  const isPIC     = task.picUserId._id.toString() === req.user._id.toString();

  // Alur transisi yang valid
  const transitions = {
    menunggu_approval: { to_do: 'direksi', ditolak: 'direksi' },
    to_do:             { in_progress: 'pic' },
    in_progress:       { perlu_review: 'pic' },
    perlu_review:      { done: 'direksi', revisi: 'direksi' },
    revisi:            { in_progress: 'pic' },
  };

  const allowedNext = transitions[task.status];
  if (!allowedNext || !allowedNext[statusBaru])
    return res.status(400).json({ message: `Transisi status dari "${task.status}" ke "${statusBaru}" tidak diizinkan` });

  const requiredRole = allowedNext[statusBaru];
  if (requiredRole === 'direksi' && !isDireksi)
    return res.status(403).json({ message: 'Hanya Direksi yang dapat melakukan aksi ini' });
  if (requiredRole === 'pic' && !isPIC && !isDireksi)
    return res.status(403).json({ message: 'Hanya PIC yang dapat mengubah status ini' });

  // Validasi reject wajib catatan
  if ((statusBaru === 'ditolak' || statusBaru === 'revisi') && (!catatan || catatan.length < 10))
    return res.status(400).json({ message: 'Catatan alasan wajib diisi minimal 10 karakter' });

  // Validasi upload evidence sebelum submit review
  if (statusBaru === 'perlu_review') {
    const evCount = await Evidence.countDocuments({ taskId: task._id });
    if (evCount === 0)
      return res.status(400).json({ message: 'Wajib upload minimal 1 evidence sebelum mengajukan review' });
  }

  const statusLama = task.status;
  task.status = statusBaru;
  if (catatan) task.catatanDireksi = catatan;
  if (statusBaru === 'done') {
    task.doneAt = new Date();
    task.approvedAt = new Date();
  }
  if (statusBaru === 'revisi') task.revisiCount = (task.revisiCount || 0) + 1;

  await task.save();

  await StatusLog.create({
    taskId:     task._id,
    userId:     req.user._id,
    statusLama,
    statusBaru,
    catatan:    catatan || null,
  });

  // Notifikasi & email & WA
  const pic    = task.picUserId;
  const pembuat= task.dibuatOleh;
  const direksi = await User.find({ role: 'direksi', statusAktif: true });

  if (statusBaru === 'to_do' && statusLama === 'menunggu_approval') {
    await notifSvc.notifTaskApproved(pic, task);
    if (pic.notifEmail) await mailer.mailTaskApproved(pic, task).catch(() => {});
    await wa.sendWATaskApproved(pic, task);
    push.sendPush(pic._id, { title: '✅ Task Disetujui', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
  }
  if (statusBaru === 'ditolak') {
    const target = pembuat._id.toString() !== pic._id.toString() ? pembuat : pic;
    await notifSvc.notifTaskRejected(target, task, catatan);
    if (target.notifEmail) await mailer.mailTaskRejected(target, task, catatan).catch(() => {});
    await wa.sendWATaskRejected(target, task, catatan);
    push.sendPush(target._id, { title: '❌ Task Ditolak', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
  }
  if (statusBaru === 'perlu_review') {
    await notifSvc.notifSubmitReview(direksi, task, pic);
    push.sendPushMany(direksi.map(d => d._id), { title: '👀 Task Perlu Review', body: `${pic.namaLengkap}: ${task.judul}`, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
  }
  if (statusBaru === 'done') {
    await notifSvc.notifTaskDone(pic, task);
    if (pic.notifEmail) await mailer.mailTaskDone(pic, task).catch(() => {});
    const now = new Date();
    await simpanSnapshot(pic._id, now.getMonth() + 1, now.getFullYear()).catch(() => {});
    push.sendPush(pic._id, { title: '🎉 Task Selesai!', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
  }
  if (statusBaru === 'revisi') {
    await notifSvc.notifTaskRevisi(pic, task, catatan);
    if (pic.notifEmail) await mailer.mailTaskRevisi(pic, task, catatan).catch(() => {});
    await wa.sendWATaskRejected(pic, task, catatan);
    push.sendPush(pic._id, { title: '🔄 Task Perlu Revisi', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
  }

  audit.log(req, `task.${statusBaru}`, { target:'Task', targetId: task._id, detail: { judul: task.judul, statusLama, catatan } });
  res.json({ message: 'Status berhasil diubah', task });
});

// ── GET /api/tasks/:id/dependencies ──────────────────────────────────────────
router.get('/:id/dependencies', auth, async (req, res) => {
  const task = await Task.findById(req.params.id)
    .populate('dependencies', 'judul status prioritas deadline picUserId');
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });
  res.json({ dependencies: task.dependencies || [] });
});

// ── POST /api/tasks/:id/dependencies — tambah dependency ─────────────────────
router.post('/:id/dependencies', auth, async (req, res) => {
  const { dependsOnId } = req.body;
  if (!dependsOnId) return res.status(400).json({ message: 'dependsOnId wajib diisi' });
  if (dependsOnId === req.params.id) return res.status(400).json({ message: 'Task tidak bisa bergantung pada dirinya sendiri' });

  const [task, dep] = await Promise.all([
    Task.findById(req.params.id),
    Task.findById(dependsOnId),
  ]);
  if (!task || !dep) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const alreadyAdded = task.dependencies.map(d => d.toString()).includes(dependsOnId);
  if (alreadyAdded) return res.status(400).json({ message: 'Dependency sudah ada' });

  task.dependencies.push(dependsOnId);
  await task.save();
  await task.populate('dependencies', 'judul status prioritas deadline');
  res.json({ message: 'Dependency ditambahkan', dependencies: task.dependencies });
});

// ── DELETE /api/tasks/:id/dependencies/:depId ─────────────────────────────────
router.delete('/:id/dependencies/:depId', auth, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  task.dependencies = task.dependencies.filter(d => d.toString() !== req.params.depId);
  await task.save();
  res.json({ message: 'Dependency dihapus' });
});

// ── POST /api/tasks/:id/recurrence — set recurrence ──────────────────────────
router.post('/:id/recurrence', auth, async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  const { tipe, interval } = req.body;
  const validTipe = ['none','daily','weekly','monthly'];
  if (!validTipe.includes(tipe)) return res.status(400).json({ message: 'Tipe recurrence tidak valid' });

  task.recurrence.tipe     = tipe;
  task.recurrence.interval = Math.max(1, parseInt(interval) || 1);
  task.recurrence.nextRun  = tipe !== 'none' ? nextRunDate(task.deadline, tipe, task.recurrence.interval) : null;
  await task.save();
  res.json({ message: 'Recurrence diset', recurrence: task.recurrence });
});

function nextRunDate(fromDate, tipe, interval) {
  const d = new Date(fromDate);
  if (tipe === 'daily')   d.setDate(d.getDate() + interval);
  if (tipe === 'weekly')  d.setDate(d.getDate() + interval * 7);
  if (tipe === 'monthly') d.setMonth(d.getMonth() + interval);
  return d;
}

// ── DELETE /api/tasks/:id (soft delete) ── Direksi saja ──────────────────────
router.delete('/:id', auth, requireRole('direksi'), async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ message: 'Task tidak ditemukan' });

  task.isDeleted = true;
  task.deletedAt = new Date();
  await task.save();
  res.json({ message: 'Task berhasil dihapus' });
});

module.exports = router;
