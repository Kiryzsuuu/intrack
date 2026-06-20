/**
 * Migrasi data lama → skema baru (assignees, subtask, dll).
 * Jalankan: node server/scripts/migrate-assignees.js
 *
 * Yang dilakukan:
 *  1. Task.picUserId (+ collaborators) → Task.assignees[]
 *  2. Map status lama → status baru
 *  3. Subtask.assignedTo → Subtask.assignees[]; pastikan parentId ada (null)
 *  4. Bersihkan field usang (picUserId, collaborators, tags) dari Task
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), override: true });
require('dns').setDefaultResultOrder('ipv4first');
require('dns').setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');

const STATUS_MAP = {
  menunggu_approval: 'to_do',
  to_do:             'to_do',
  in_progress:       'on_progress',
  on_progress:       'on_progress',
  perlu_review:      'partially_complete',
  partially_complete:'partially_complete',
  revisi:            'on_progress',
  ditolak:           'to_do',
  done:              'complete',
  complete:          'complete',
};

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
  if (!uri) { console.error('MONGODB_URI tidak ditemukan di .env'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Terhubung ke MongoDB');

  const db = mongoose.connection.db;
  const tasksCol    = db.collection('tasks');
  const subtasksCol = db.collection('subtasks');

  // ── 1 & 2 & 4: Task ──────────────────────────────────────────────────────────
  const tasks = await tasksCol.find({}).toArray();
  let tMigrated = 0;
  for (const t of tasks) {
    const set = {};
    const unset = {};

    // assignees dari picUserId + collaborators (jika assignees belum ada)
    if (!Array.isArray(t.assignees) || t.assignees.length === 0) {
      const a = [];
      if (t.picUserId) a.push(t.picUserId);
      if (Array.isArray(t.collaborators)) {
        for (const c of t.collaborators) {
          if (!a.find(x => x.toString() === c.toString())) a.push(c);
        }
      }
      if (a.length) set.assignees = a;
    }

    // status
    const newStatus = STATUS_MAP[t.status] || 'to_do';
    if (newStatus !== t.status) set.status = newStatus;

    // default field baru
    if (t.completedBy === undefined)     set.completedBy = [];
    if (t.pendingApproval === undefined) set.pendingApproval = false;

    // hapus field usang
    if (t.picUserId    !== undefined) unset.picUserId = '';
    if (t.collaborators!== undefined) unset.collaborators = '';
    if (t.tags         !== undefined) unset.tags = '';

    const update = {};
    if (Object.keys(set).length)   update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) {
      await tasksCol.updateOne({ _id: t._id }, update);
      tMigrated++;
    }
  }
  console.log(`Task dimigrasi: ${tMigrated}/${tasks.length}`);

  // ── 3: Subtask ───────────────────────────────────────────────────────────────
  const subs = await subtasksCol.find({}).toArray();
  let sMigrated = 0;
  for (const s of subs) {
    const set = {};
    const unset = {};
    if ((!Array.isArray(s.assignees) || s.assignees.length === 0) && s.assignedTo) {
      set.assignees = [s.assignedTo];
    }
    if (s.parentId === undefined) set.parentId = null;
    if (s.assignedTo !== undefined) unset.assignedTo = '';

    const update = {};
    if (Object.keys(set).length)   update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) {
      await subtasksCol.updateOne({ _id: s._id }, update);
      sMigrated++;
    }
  }
  console.log(`Subtask dimigrasi: ${sMigrated}/${subs.length}`);

  await mongoose.disconnect();
  console.log('Selesai.');
}

run().catch(err => { console.error(err); process.exit(1); });
