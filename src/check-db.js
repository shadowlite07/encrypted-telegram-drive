const cfg = require('./src/config').loadConfig();
const db = require('./src/db');
const d = db.openDb(cfg.dbPath);
console.log('dbPath =', cfg.dbPath);
console.log('has folder_id =', d.prepare('PRAGMA table_info(files)').all().some(x => x.name === 'folder_id'));
console.log(db.listFilesInFolder(d, null).map(x => x.id));
