const router    = require('express').Router();
const Task      = require('../models/Task');
const User      = require('../models/User');
const Subtask   = require('../models/Subtask');
const Evidence  = require('../models/Evidence');
const StatusLog = require('../models/StatusLog');
const Timelog   = require('../models/TimeLog');
const auth      = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const notifSvc  = require('../services/notifikasi');
const mailer    = require('../services/mailer');
const wa        = require('../services/whatsapp');
const { simpanSnapshot } = require('../services/kpi');
const push      = require('../services/push');
const audit     = require('../services/audit');

// Auto-compute status berdasarkan subtask progress (dipanggil dari timelog & subtask routes)
async function autoUpdateStatus(taskId) {
  const task = await Task.findById(taskId);
  if (!task || task.status === 'complete') return;

  const subtasks = await Subtask.find({ taskId });
  const total    = subtasks.length;
  const done     = subtasks.filter(s => s.isDone).length;

  let newStatus = task.status;

  if (total > 0) {
    const ratio = done / total;
    if (ratio >= 1)        newStatus = 'complete';
    else if (ratio >= 0.5) newStatus = 'partially_complete';
    else if (done > 0)     newStatus = 'on_progress';
    else                   newStatus = task.status === 'on_progress' ? 'on_progress' : task.status;
  }

  if (newStatus !== task.status) {
    const statusLama = task.status;
    task.status = newStatus;
    if (newStatus === 'complete') task.doneAt = new Date();
    await task.save();
    await StatusLog.create({ taskId, userId: task.picUserId, statusLama, statusBaru: newStatus, catatan: 'Auto-update dari progress subtask' });

    if (newStatus === 'complete') {
      const pic = await User.findById(task.picUserId);
      if (pic) {
        await notifSvc.notifTaskDone(pic, task).catch(() => {});
        push.sendPush(pic._id, { title: 'Task Selesai!', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
        const now = new Date();
        await simpanSnapshot(pic._id, now.getMonth() + 1, now.getFullYear()).catch(() => {});
        if (task.dibuatOleh.toString() !== pic._id.toString()) {
          push.sendPush(task.dibuatOleh, { title: 'Task Selesai!', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
        }
      }
    }
  }
}

module.exports.autoUpdateStatus = autoUpdateStatus;

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

  const validStatus = ['to_do','on_progress','partially_complete','complete'];
  if (!validStatus.includes(statusBaru))
    return res.status(400).json({ message: 'Status tidak valid' });

  const isDireksi = ['direksi','superadmin'].includes(req.user.role);

  let updated = 0;
  for (const id of taskIds) {
    try {
      const task = await Task.findById(id).populate('picUserId');
      if (!task) continue;

      const isPIC   = task.picUserId?._id?.toString() === req.user._id.toString();
      const isCollab = (task.collaborators || []).some(c => c.toString() === req.user._id.toString());
      if (!isDireksi && !isPIC && !isCollab) continue;

      task.status = statusBaru;
      if (statusBaru === 'complete') task.doneAt = new Date();
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
  if (!judul || !deskripsi || !picUserId || !deadline)
    return res.status(400).json({ message: 'Judul, deskripsi, PIC, dan deadline wajib diisi' });
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

  const task = await Task.create({
    judul: judul.trim(),
    deskripsi,
    picUserId,
    dibuatOleh: req.user._id,
    direktoratId: pic.direktoratId?._id || pic.direktoratId,
    prioritas: prioritas || 'normal',
    status: 'to_do',
    deadline: new Date(deadline),
    tags: tags ? tags.slice(0, 5) : [],
    collaborators: collaborators || [],
  });

  await StatusLog.create({ taskId: task._id, userId: req.user._id, statusLama: null, statusBaru: 'to_do', catatan: 'Task dibuat' });

  // Notif ke PIC jika beda dengan pembuat
  if (pic._id.toString() !== req.user._id.toString()) {
    await notifSvc.notifTaskApproved(pic, task).catch(() => {});
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
    .populate('collaborators', 'namaLengkap email fotoProfil')
    .populate('milestoneId', 'judul warna');

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
  const { statusBaru } = req.body;
  const validStatuses = ['to_do', 'on_progress', 'partially_complete', 'complete'];
  if (!statusBaru || !validStatuses.includes(statusBaru))
    return res.status(400).json({ message: 'Status tidak valid' });

  const task = await Task.findById(req.params.id).populate('picUserId').populate('dibuatOleh');
  if (!task || task.isDeleted)
    return res.status(404).json({ message: 'Task tidak ditemukan' });

  const isDireksi    = ['direksi', 'superadmin'].includes(req.user.role);
  const isPIC        = task.picUserId._id.toString() === req.user._id.toString();
  const isCollab     = (task.collaborators || []).some(c => c.toString() === req.user._id.toString());
  const isPembuat    = task.dibuatOleh._id.toString() === req.user._id.toString();

  if (!isDireksi && !isPIC && !isCollab && !isPembuat)
    return res.status(403).json({ message: 'Akses ditolak' });

  const statusLama = task.status;
  task.status = statusBaru;
  if (statusBaru === 'complete') task.doneAt = new Date();

  await task.save();

  await StatusLog.create({ taskId: task._id, userId: req.user._id, statusLama, statusBaru });

  // Notifikasi jika complete
  if (statusBaru === 'complete') {
    const pic = task.picUserId;
    await notifSvc.notifTaskDone(pic, task).catch(() => {});
    if (pic.notifEmail) await mailer.mailTaskDone(pic, task).catch(() => {});
    const now = new Date();
    await simpanSnapshot(pic._id, now.getMonth() + 1, now.getFullYear()).catch(() => {});
    push.sendPush(pic._id, { title: 'Task Selesai!', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
    // Notif pembuat task jika berbeda
    if (task.dibuatOleh._id.toString() !== pic._id.toString()) {
      push.sendPush(task.dibuatOleh._id, { title: 'Task Selesai!', body: task.judul, url: `/pages/task.html?id=${task._id}` }).catch(() => {});
    }
  }

  audit.log(req, `task.status`, { target:'Task', targetId: task._id, detail: { judul: task.judul, statusLama, statusBaru } });
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
