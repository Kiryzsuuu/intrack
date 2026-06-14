const cron     = require('node-cron');
const Task     = require('../models/Task');
const User     = require('../models/User');
const notifSvc = require('../services/notifikasi');
const mailer   = require('../services/mailer');
const wa       = require('../services/whatsapp');
const { simpanSnapshot } = require('../services/kpi');

function hariKerja(tanggal) {
  const hari = tanggal.getDay();
  return hari !== 0 && hari !== 6;
}

function startCronJobs() {
  // ── Setiap jam 08:00 — reminder deadline H-3 dan H-1 ────────────────────────
  cron.schedule('0 8 * * 1-5', async () => {
    try {
      const now = new Date();

      for (const hari of [3, 1]) {
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + hari);
        targetDate.setHours(23, 59, 59, 999);
        const mulai = new Date(targetDate);
        mulai.setHours(0, 0, 0, 0);

        const tasks = await Task.find({
          isDeleted:    false,
          archivedAt:   null,
          status:       { $nin: ['perlu_review', 'done', 'ditolak'] },
          deadline:     { $gte: mulai, $lte: targetDate },
        }).populate('picUserId');

        for (const task of tasks) {
          const pic = task.picUserId;
          if (!pic) continue;
          await notifSvc.notifDeadlineReminder(pic, task, hari);
          if (pic.notifEmail) await mailer.mailDeadlineReminder(pic, task, hari).catch(() => {});
          await wa.sendWADeadlineReminder(pic, task, hari);

          // H-1: notif ke Direksi juga
          if (hari === 1) {
            const direksi = await User.find({ role: 'direksi', statusAktif: true });
            for (const d of direksi) {
              await notifSvc.buatNotifikasi({
                userId: d._id,
                jenis:  'reminder_deadline_direksi',
                judul:  `Task mendekati deadline H-1`,
                isi:    `Task "${task.judul}" (${pic.namaLengkap}) deadline besok`,
                taskId: task._id,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[Cron Reminder]', err.message);
    }
  });

  // ── Setiap jam 09:00 — task overdue (H+1) ───────────────────────────────────
  cron.schedule('0 9 * * 1-5', async () => {
    try {
      const kemarin = new Date();
      kemarin.setDate(kemarin.getDate() - 1);
      kemarin.setHours(0, 0, 0, 0);
      const kemarinAkhir = new Date(kemarin);
      kemarinAkhir.setHours(23, 59, 59, 999);

      const tasks = await Task.find({
        isDeleted:  false,
        archivedAt: null,
        status:     { $nin: ['done', 'ditolak'] },
        deadline:   { $gte: kemarin, $lte: kemarinAkhir },
      }).populate('picUserId');

      const direksi = await User.find({ role: 'direksi', statusAktif: true });

      for (const task of tasks) {
        const pic = task.picUserId;
        if (!pic) continue;
        await notifSvc.notifOverdue(pic, task);
        for (const d of direksi) {
          await notifSvc.buatNotifikasi({
            userId: d._id,
            jenis:  'task_overdue_direksi',
            judul:  'Task overdue',
            isi:    `Task "${task.judul}" (${pic.namaLengkap}) sudah melewati deadline`,
            taskId: task._id,
          });
        }
      }
    } catch (err) {
      console.error('[Cron Overdue]', err.message);
    }
  });

  // ── Setiap jam 10:00 hari kerja — revisi terbengkalai > 2 hari kerja ─────────
  cron.schedule('0 10 * * 1-5', async () => {
    try {
      const tasks = await Task.find({
        isDeleted:  false,
        archivedAt: null,
        status:     'revisi',
      }).populate('picUserId');

      for (const task of tasks) {
        const lastUpdate = task.updatedAt;
        let hariKerjaCount = 0;
        const check = new Date(lastUpdate);
        while (check <= new Date()) {
          if (hariKerja(check)) hariKerjaCount++;
          check.setDate(check.getDate() + 1);
          if (hariKerjaCount > 2) break;
        }
        if (hariKerjaCount > 2) {
          const pic = task.picUserId;
          if (pic) await notifSvc.notifRevisiTerbengkalai(pic, task);
        }
      }
    } catch (err) {
      console.error('[Cron Revisi]', err.message);
    }
  });

  // ── Setiap jam 08:00 hari Senin — auto-archive task Done > 90 hari ──────────
  cron.schedule('0 8 * * 1', async () => {
    try {
      const batas = new Date();
      batas.setDate(batas.getDate() - 90);
      await Task.updateMany(
        { status: 'done', doneAt: { $lt: batas }, archivedAt: null, isDeleted: false },
        { archivedAt: new Date() }
      );
    } catch (err) {
      console.error('[Cron Archive]', err.message);
    }
  });

  // ── Setiap hari pertama bulan jam 07:00 — simpan KPI snapshot bulanan ────────
  cron.schedule('0 7 1 * *', async () => {
    try {
      const now      = new Date();
      const bulan    = now.getMonth() === 0 ? 12 : now.getMonth();
      const tahun    = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const managers = await User.find({ role: 'manager', statusAktif: true });
      for (const m of managers) {
        await simpanSnapshot(m._id, bulan, tahun).catch(() => {});
      }
      console.log(`[Cron KPI] Snapshot ${bulan}/${tahun} disimpan untuk ${managers.length} manager`);
    } catch (err) {
      console.error('[Cron KPI]', err.message);
    }
  });

  // ── Setiap hari jam 08:05 — daily digest untuk Direksi ───────────────────────
  cron.schedule('5 8 * * 1-5', async () => {
    try {
      const direksi = await User.find({ role: 'direksi', statusAktif: true });
      const now = new Date();
      const today = new Date(now); today.setHours(23, 59, 59, 999);
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);

      const [pendingApproval, overdueTasks, dueToday] = await Promise.all([
        Task.countDocuments({ status: 'menunggu_approval', isDeleted: false }),
        Task.countDocuments({ status: { $nin: ['done', 'ditolak'] }, deadline: { $lt: now }, isDeleted: false }),
        Task.countDocuments({ deadline: { $gte: todayStart, $lte: today }, status: { $nin: ['done', 'ditolak'] }, isDeleted: false }),
      ]);

      for (const d of direksi) {
        if (d.notifEmail) {
          await mailer.mailDailyDigest(d, { pendingApproval, overdue: overdueTasks, dueToday }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[Cron Digest]', err.message);
    }
  });

  // ── Setiap jam 07:00 — spawn task recurring yang sudah due ──────────────────
  cron.schedule('0 7 * * *', async () => {
    try {
      const now = new Date();
      const tasks = await Task.find({
        'recurrence.tipe': { $ne: 'none' },
        'recurrence.nextRun': { $lte: now },
        isDeleted: false,
        status: { $nin: ['ditolak'] },
      });

      for (const parent of tasks) {
        const interval = parent.recurrence.interval || 1;
        const tipe     = parent.recurrence.tipe;

        // Hitung deadline baru
        const oldDeadline = new Date(parent.deadline);
        const newDeadline = new Date(oldDeadline);
        if (tipe === 'daily')   newDeadline.setDate(newDeadline.getDate() + interval);
        if (tipe === 'weekly')  newDeadline.setDate(newDeadline.getDate() + interval * 7);
        if (tipe === 'monthly') newDeadline.setMonth(newDeadline.getMonth() + interval);

        await Task.create({
          judul:        parent.judul,
          deskripsi:    parent.deskripsi,
          picUserId:    parent.picUserId,
          dibuatOleh:   parent.dibuatOleh,
          direktoratId: parent.direktoratId,
          prioritas:    parent.prioritas,
          deadline:     newDeadline,
          tags:         parent.tags,
          collaborators:parent.collaborators,
          templateId:   parent.templateId,
          recurrence: { tipe, interval, parentId: parent._id },
        });

        // Update nextRun di parent
        const nextRun = new Date(newDeadline);
        if (tipe === 'daily')   nextRun.setDate(nextRun.getDate() + interval);
        if (tipe === 'weekly')  nextRun.setDate(nextRun.getDate() + interval * 7);
        if (tipe === 'monthly') nextRun.setMonth(nextRun.getMonth() + interval);
        parent.recurrence.nextRun = nextRun;
        await parent.save();
      }

      if (tasks.length) console.log(`[Cron Recurring] Dibuat ${tasks.length} task baru`);
    } catch (err) {
      console.error('[Cron Recurring]', err.message);
    }
  });

  console.log('[Cron] Job terjadwal aktif');
}

module.exports = { startCronJobs };
