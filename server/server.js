const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { Capacitor } = require('@capacitor/core');
const { Filesystem, Directory } = require('@capacitor/filesystem');

// 初始化Express应用
const server = express();
const port = 4000;

/* ==================== 路径配置 ==================== */
async function getAppPaths() {
  if (Capacitor.isNativePlatform()) {
    // Android/iOS路径处理
    try {
      const dbDir = await Filesystem.mkdir({
        path: 'database',
        directory: Directory.Data,
        recursive: true
      });
      
      const uploadDir = await Filesystem.mkdir({
        path: 'uploads',
        directory: Directory.Data,
        recursive: true
      });

      return {
        dbPath: path.join(dbDir.uri, 'quotation.db'),
        uploadDir: uploadDir.uri,
        isMobile: true
      };
    } catch (error) {
      console.error('移动端路径初始化失败:', error);
      throw error;
    }
  } else {
    // 桌面端路径
    const devPaths = {
      dbPath: path.join(require('os').homedir(), '.quotation-app-data', 'database', 'quotation.db'),
      uploadDir: path.join(require('os').homedir(), '.quotation-app-data', 'uploads')
    };

    const prodPaths = {
      dbPath: path.join(process.resourcesPath, 'database', 'quotation.db'),
      uploadDir: path.join(process.resourcesPath, 'uploads')
    };

    const isDev = process.env.NODE_ENV === 'development';
    const paths = isDev ? devPaths : prodPaths;

    [path.dirname(paths.dbPath), paths.uploadDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    return {
      ...paths,
      isMobile: false
    };
  }
}

/* ==================== 数据库初始化 ==================== */
let db;
let uploadDir;

(async function initialize() {
  try {
    const paths = await getAppPaths();
    uploadDir = paths.uploadDir;
    
    db = new sqlite3.Database(paths.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) {
        console.error('❌ SQLite连接失败:', err);
        process.exit(1);
      }
      console.log('✅ SQLite连接成功');
      initializeDatabase();
    });
  } catch (error) {
    console.error('初始化失败:', error);
    process.exit(1);
  }
})();

function initializeDatabase() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT DEFAULT (datetime('now', 'localtime')),
      clientName TEXT NOT NULL,
      address TEXT,
      contact TEXT NOT NULL,
      tel TEXT,
      email TEXT,
      description TEXT NOT NULL,
      materialCode TEXT,
      photo TEXT,
      clientDwgMaterial TEXT,
      afterReviewMaterial TEXT,
      requirements TEXT,
      unitPriceType TEXT NOT NULL,
      unitPrice REAL NOT NULL,
      quantity TEXT,
      samplingCost REAL,
      mouldCost REAL,
      sampleNotes TEXT,
      mouldCycle TEXT,
      massProductionCycle TEXT
    )`;
  
  db.run(createTableQuery, (err) => {
    if (err) console.error('❌ 创建表失败:', err);
    else console.log('✅ 表初始化完成');
  });
}

/* ==================== 文件上传配置 ==================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

/* ==================== 中间件配置 ==================== */
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({ extended: true }));
server.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE']
}));

// 静态文件服务（适配移动端）
server.use('/uploads', express.static(uploadDir, {
  setHeaders: (res) => {
    if (Capacitor.isNativePlatform()) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }
}));

/* ==================== 辅助函数 ==================== */
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getPhotoUrl(filename) {
  if (!filename) return null;
  
  if (Capacitor.isNativePlatform()) {
    // Android/iOS使用Capacitor文件协议
    return `capacitor://localhost/_capacitor_file_${filename}`;
  } else {
    // 桌面端使用普通URL
    return `/uploads/${path.basename(filename)}?t=${Date.now()}`;
  }
}

/* ==================== 路由处理 ==================== */
// 首页路由
server.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, '../src/index.html'));
});

// 提交报价单
server.post('/submit', upload.single('photo'), async (req, res) => {
  try {
    const requiredFields = ['clientName', 'contact', 'description', 'unitPriceType', 'unitPrice'];
    for (const field of requiredFields) {
      if (!req.body[field]) throw new Error(`缺少必填字段: ${field}`);
    }

    const data = {
      ...req.body,
      photo: req.file ? path.join(uploadDir, req.file.filename) : null,
      unitPrice: parseFloat(req.body.unitPrice),
      samplingCost: req.body.samplingCost ? parseFloat(req.body.samplingCost) : null,
      mouldCost: req.body.mouldCost ? parseFloat(req.body.mouldCost) : null
    };

    const keys = Object.keys(data).join(',');
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(',');

    const result = await dbRun(
      `INSERT INTO quotations (${keys}) VALUES (${placeholders})`,
      values
    );

    res.json({ 
      success: true, 
      id: result.lastID,
      photoUrl: getPhotoUrl(data.photo)
    });
  } catch (error) {
    console.error('提交错误:', error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 获取最新报价单
server.get('/quotation', async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM quotations ORDER BY id DESC LIMIT 1');
    if (!row) return res.status(404).json({ error: '没有报价单数据' });

    res.json({
      ...row,
      photo: getPhotoUrl(row.photo),
      samplingCost: row.samplingCost || 0,
      mouldCost: row.mouldCost || 0,
      totalAmount: (
        (row.unitPrice || 0) * (parseInt(row.quantity) || 0) + 
        (parseFloat(row.samplingCost) || 0) + 
        (parseFloat(row.mouldCost) || 0)
      ).toFixed(2)
    });
  } catch (error) {
    console.error('查询错误:', error);
    res.status(500).json({ error: '数据库错误' });
  }
});

// 报价单详情
server.get('/quotation-detail', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) throw new Error('缺少报价单ID参数');

    const row = await dbGet(`SELECT * FROM quotations WHERE id = ?`, [id]);
    if (!row) return res.status(404).json({ error: '未找到指定报价单' });

    res.json({
      ...row,
      photo: getPhotoUrl(row.photo),
      samplingCost: row.samplingCost || 0,
      mouldCost: row.mouldCost || 0,
      totalAmount: (
        (row.unitPrice || 0) * (parseInt(row.quantity) || 0) + 
        (parseFloat(row.samplingCost) || 0) + 
        (parseFloat(row.mouldCost) || 0)
      ).toFixed(2)
    });
  } catch (error) {
    console.error('获取详情错误:', error);
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 搜索报价单
server.get('/search', async (req, res) => {
  try {
    const { materialCode, descriptionKeyword } = req.query;
    
    if (!materialCode && !descriptionKeyword) {
      throw new Error('至少需要料号或品名关键词');
    }

    let sql = `SELECT id, description, materialCode, photo, unitPrice, unitPriceType FROM quotations WHERE `;
    const params = [];

    if (materialCode && descriptionKeyword) {
      sql += `materialCode = ? AND description LIKE ?`;
      params.push(materialCode, `%${descriptionKeyword}%`);
    } else if (materialCode) {
      sql += `materialCode = ?`;
      params.push(materialCode);
    } else {
      sql += `description LIKE ?`;
      params.push(`%${descriptionKeyword}%`);
    }

    sql += ` ORDER BY id DESC`;
    const rows = await dbAll(sql, params);

    res.json(rows.map(item => ({
      ...item,
      photo: item.photo ? getPhotoUrl(item.photo) : null,
      unit: item.unitPriceType === 'USD_QUOTATION' ? 'USD' : 'RMB'
    })));
  } catch (error) {
    console.error('搜索错误:', error);
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// 获取所有记录（分页）
server.get('/all-records', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    
    const countResult = await dbGet('SELECT COUNT(*) as total FROM quotations');
    const rows = await dbAll(
      'SELECT id, createdAt, clientName, contact, description, materialCode FROM quotations ORDER BY createdAt DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    
    res.json({
      items: rows,
      total: countResult.total,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('获取记录列表错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除记录
server.delete('/delete-record', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) throw new Error('缺少ID参数');
    
    const record = await dbGet('SELECT photo FROM quotations WHERE id = ?', [id]);
    if (!record) throw new Error('未找到指定记录');
    
    const result = await dbRun('DELETE FROM quotations WHERE id = ?', [id]);
    if (result.changes === 0) throw new Error('删除失败');
    
    if (record.photo) {
      try {
        await Filesystem.deleteFile({
          path: record.photo,
          directory: Directory.Data
        });
      } catch (fileError) {
        console.warn('删除关联文件失败:', fileError);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('删除记录错误:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ==================== 错误处理 ==================== */
server.use((err, req, res, next) => {
  console.error('全局错误:', err.stack);
  res.status(500).json({ 
    error: '服务器内部错误',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

/* ==================== 启动服务器 ==================== */
server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 服务器运行在 http://localhost:${port}`);
  console.log(`📁 上传目录: ${uploadDir}`);
});

module.exports = { server };