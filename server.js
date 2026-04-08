const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Database('taskflow.db');

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
`);

// Auto-migrate existing DBs
try { db.exec("ALTER TABLE tasks ADD COLUMN transferredAt INTEGER"); } catch(e) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN groupId TEXT"); } catch(e) {}
try { db.exec("ALTER TABLE tasks ADD COLUMN dependsOn TEXT"); } catch(e) {}

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

app.listen(3000, '0.0.0.0', () => console.log('Taskflow server running on port 3000'));
