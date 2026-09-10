// server/sqlite_engine.js
// Motor SQLite universal de alto rendimiento basado en WebAssembly (sql.js)
// Compatible 100% con Electron y Node.js, sin dependencias nativas C++ ni node:sqlite

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

function getWasmBinary() {
  const localWasm = path.join(__dirname, 'sql-wasm.wasm');
  if (fs.existsSync(localWasm)) {
    return fs.readFileSync(localWasm);
  }
  const nmWasm = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (fs.existsSync(nmWasm)) {
    return fs.readFileSync(nmWasm);
  }
  throw new Error('No se pudo encontrar el archivo sql-wasm.wasm');
}

class SqlEngine {
  constructor(dbPath, SQL) {
    this.dbPath = dbPath;
    this.SQL = SQL;
    this.dirty = false;
    this.saveTimeout = null;
    this.epoch = 0;

    if (fs.existsSync(dbPath)) {
      try {
        const buffer = fs.readFileSync(dbPath);
        this.rawDb = new SQL.Database(buffer);
      } catch (err) {
        console.error('Aviso: Error leyendo archivo SQLite existente, creando nueva base:', err.message);
        this.rawDb = new SQL.Database();
      }
    } else {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.rawDb = new SQL.Database();
    }

    process.on('exit', () => {
      if (this.dirty) this.save();
    });
  }

  exec(sql) {
    const res = this.rawDb.exec(sql);
    if (/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COMMIT)\b/i.test(sql)) {
      this.markDirty();
      if (/^\s*COMMIT\b/i.test(sql)) {
        this.save();
      }
    }
    return res;
  }

  prepare(sql) {
    const engine = this;
    let rawStmt = null;
    let stmtEpoch = -1;

    function getStmt() {
      if (!rawStmt || stmtEpoch !== engine.epoch) {
        rawStmt = engine.rawDb.prepare(sql);
        stmtEpoch = engine.epoch;
      }
      return rawStmt;
    }

    return {
      get(...args) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const stmt = getStmt();
            const params = engine._normalizeParams(args);
            stmt.bind(params);
            let result = undefined;
            if (stmt.step()) {
              result = stmt.getAsObject();
            }
            stmt.reset();
            return result;
          } catch (err) {
            const isClosed = (typeof err === 'string' && err.includes('Statement closed')) ||
                             (err && err.message && err.message.includes('Statement closed'));
            if (isClosed && attempt === 0) {
              rawStmt = null;
              stmtEpoch = -1;
              continue;
            }
            throw err;
          }
        }
      },

      all(...args) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const stmt = getStmt();
            const params = engine._normalizeParams(args);
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
            stmt.reset();
            return rows;
          } catch (err) {
            const isClosed = (typeof err === 'string' && err.includes('Statement closed')) ||
                             (err && err.message && err.message.includes('Statement closed'));
            if (isClosed && attempt === 0) {
              rawStmt = null;
              stmtEpoch = -1;
              continue;
            }
            throw err;
          }
        }
      },

      run(...args) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const stmt = getStmt();
            const params = engine._normalizeParams(args);
            stmt.bind(params);
            stmt.step();
            stmt.reset();
            break;
          } catch (err) {
            const isClosed = (typeof err === 'string' && err.includes('Statement closed')) ||
                             (err && err.message && err.message.includes('Statement closed'));
            if (isClosed && attempt === 0) {
              rawStmt = null;
              stmtEpoch = -1;
              continue;
            }
            throw err;
          }
        }

        const changes = engine.rawDb.getRowsModified();
        let lastInsertRowid = 0;
        try {
          const idRes = engine.rawDb.exec('SELECT last_insert_rowid() as id');
          if (idRes && idRes[0] && idRes[0].values && idRes[0].values[0]) {
            lastInsertRowid = Number(idRes[0].values[0][0]);
          }
        } catch (e) {}

        engine.markDirty();
        return { changes, lastInsertRowid };
      }
    };
  }

  _normalizeParams(args) {
    let flat = [];
    if (args.length === 1 && Array.isArray(args[0])) {
      flat = args[0];
    } else {
      flat = args;
    }
    return flat.map(v => (v === undefined ? null : v));
  }

  markDirty() {
    this.dirty = true;
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.save();
    }, 3000);
  }

  save() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (!this.dirty) return;
    try {
      this.epoch++;
      const data = this.rawDb.export();
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tempPath = this.dbPath + '.tmp';
      fs.writeFileSync(tempPath, Buffer.from(data));
      fs.renameSync(tempPath, this.dbPath);
      this.dirty = false;
    } catch (e) {
      console.error('Error guardando base de datos SQLite a disco:', e);
    }
  }

  close() {
    this.save();
    this.rawDb.close();
  }
}

async function createSqlEngine(dbPath) {
  const wasmBinary = getWasmBinary();
  const SQL = await initSqlJs({ wasmBinary });
  return new SqlEngine(dbPath, SQL);
}

module.exports = {
  createSqlEngine,
  SqlEngine
};
