const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const webpush = require('web-push');

const app = express();
const db = new Database('taskflow.db');

// VAPID keys — generate once and persist
const VAPID_FILE = path.join(__dirname, 'vapid-keys.json');
let vapidKeys;
if (fs.existsSync(VAPID_FILE)) {
  vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
  vapidKeys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys));
}
webpush.setVapidDetails('mailto:thrawaac1@gmail.com', vapidKeys.publicKey, vapidKeys.privateKey);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    priority TEXT,
    timerAt INTEGER,
    createdAt INTEGER,
    completedAt INTEGER,
    transferredAt INTEGER,
    groupId TEXT,
    dependsOn TEXT
  );
  CREATE TABLE IF NOT EXISTS task_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    subscription TEXT NOT NULL
  );
`);

// Auto-migrate existing DBs
try { db.exec("ALTER TABLE tasks ADD COLUMN transferredAt INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN groupId TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN dependsOn TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN timerNotifiedAt INTEGER"); } catch(e) {}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'taskflow.html'));
});

app.get('/api/tasks', (req, res) => {
  res.json({
    now: db.prepare("SELECT * FROM tasks WHERE type='now'").all(),
    waiting: db.prepare("SELECT * FROM tasks WHERE type='waiting'").all(),
    done: db.prepare("SELECT * FROM tasks WHERE type='done'").all(),
    deleted: db.prepare("SELECT * FROM tasks WHERE type='deleted'").all()
  });
});

app.post('/api/tasks', (req, res) => {
  const t = req.body;
  db.prepare(`
    INSERT OR REPLACE INTO tasks
    (id,type,title,notes,priority,timerAt,createdAt,completedAt,transferredAt,groupId,dependsOn)
    VALUES (@id,@type,@title,@notes,@priority,@timerAt,@createdAt,@completedAt,@transferredAt,@groupId,@dependsOn)
  `).run({
    id: t.id, type: t.type||'now', title: t.title,
    notes: t.notes||null, priority: t.priority||null,
    timerAt: t.timerAt||null, createdAt: t.createdAt||Date.now(),
    completedAt: t.completedAt||null, transferredAt: t.transferredAt||null,
    groupId: t.groupId||null, dependsOn: t.dependsOn||null
  });
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/groups', (req, res) => {
  res.json(db.prepare("SELECT * FROM task_groups").all());
});

app.post('/api/groups', (req, res) => {
  const g = req.body;
  db.prepare('INSERT OR REPLACE INTO task_groups (id, name) VALUES (@id, @name)').run(g);
  res.json({ ok: true });
});

app.delete('/api/groups/:id', (req, res) => {
  db.prepare("UPDATE tasks SET groupId = NULL WHERE groupId = ?").run(req.params.id);
  db.prepare('DELETE FROM task_groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Push notification routes
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ key: vapidKeys.publicKey });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  db.prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription) VALUES (?, ?)')
    .run(sub.endpoint, JSON.stringify(sub));
  res.json({ ok: true });
});

app.delete('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  res.json({ ok: true });
});

// Server-side timer check — fires push notifications to all subscribed devices
async function checkAndSendTimerPush() {
  const now = Date.now();
  const expired = db.prepare(
    "SELECT * FROM tasks WHERE type='waiting' AND timerAt IS NOT NULL AND timerAt <= ? AND timerNotifiedAt IS NULL"
  ).all(now);
  if (expired.length === 0) return;

  const subs = db.prepare('SELECT subscription FROM push_subscriptions').all();
  if (subs.length === 0) return;

  for (const task of expired) {
    db.prepare("UPDATE tasks SET timerNotifiedAt = ? WHERE id = ?").run(now, task.id);
    const payload = JSON.stringify({ title: 'Taskflow — Timer expired', body: task.title, icon: '/icon-192.png' });
    for (const row of subs) {
      try {
        await webpush.sendNotification(JSON.parse(row.subscription), payload);
      } catch(e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          const sub = JSON.parse(row.subscription);
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
        }
      }
    }
  }
}

setInterval(checkAndSendTimerPush, 30000);
checkAndSendTimerPush();

app.listen(3000, '0.0.0.0', () => console.log('Taskflow server running on port 3000'));
