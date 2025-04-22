const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const puppeteer = require('puppeteer-core');
const { Capacitor } = require('@capacitor/core');
const { Filesystem } = require('@capacitor/filesystem');

// 初始化Express应用
const server = express();
const port = 4000;

// 全局变量
let db;
let uploadDir;

/* ==================== 路径配置 ==================== */
async function getAppPaths() {
  // 移动端路径处理（Android/iOS）
  if (Capacitor.isNativePlatform()) {
    await Filesystem.mkdir({
      path: 'database',
      directory: 'DATA',
      recursive: true
    });
    await Filesystem.mkdir({
      path: 'uploads',
      directory: 'DATA',
      recursive: true
    });
    return {
      dbPath: `${Filesystem.dataDirectory}database/quotation.db`,
      uploadDir: `${Filesystem.dataDirectory}uploads`,
      photoBaseUrl: '/_capacitor_file_/data/user/0/com.example.quotation/files/uploads/'
    };
  }
  
  // 开发环境路径
  const devPaths = {
    dbPath: path.join(__dirname, 'database/quotation.db'),
    uploadDir: path.join(__dirname, 'uploads'),
    photoBaseUrl: '/uploads/'
  };
  
  if (!fs.existsSync(path.dirname(devPaths.dbPath))) {
    fs.mkdirSync(path.dirname(devPaths.dbPath), { recursive: true });
  }
  if (!fs.existsSync(devPaths.uploadDir)) {
    fs.mkdirSync(devPaths.uploadDir, { recursive: true });
  }
  
  return devPaths;
}

/* ==================== SQLite数据库初始化 ==================== */
async function initDatabase() {
  const { dbPath } = await getAppPaths();
  const finalPath = Capacitor.isNativePlatform() ? 
    dbPath.replace('file://', '') : dbPath;

  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(finalPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) {
        reject(err);
      } else {
        // 建表语句
        database.run(`
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
          )
        `, (err) => {
          if (err) reject(err);
          else resolve(database);
        });
      }
    });
  });
}

/* ==================== 文件上传配置 ==================== */
async function configureUpload() {
  const paths = await getAppPaths();
  uploadDir = paths.uploadDir;
  
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        cb(null, `${Date.now()}${path.extname(file.originalname)}`);
      }
    })
  });
}

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

async function getPhotoUrl(filename) {
  if (!filename) return null;
  
  if (Capacitor.isNativePlatform()) {
    try {
      const { uri } = await Filesystem.getUri({
        path: `uploads/${path.basename(filename)}`,
        directory: 'DATA'
      });
      return Capacitor.convertFileSrc(uri);
    } catch (err) {
      console.error('获取图片URI失败:', err);
      return null;
    }
  }
  
  return `/uploads/${path.basename(filename)}?t=${Date.now()}`;
}

async function deleteImageFile(imageUrl) {
  try {
    const filename = path.basename(imageUrl.split('?')[0]);
    
    if (Capacitor.isNativePlatform()) {
      await Filesystem.deleteFile({
        path: `uploads/${filename}`,
        directory: 'DATA'
      });
    } else {
      fs.unlinkSync(path.join(uploadDir, filename));
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/* ==================== 路由处理 ==================== */
async function setupRoutes(app, uploadMiddleware) {
  // 文件上传路由
  app.post('/api/upload', uploadMiddleware.single('file'), async (req, res) => {
    try {
      const photoUrl = await getPhotoUrl(req.file.filename);
      res.json({ success: true, url: photoUrl });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 报价单提交
  app.post('/submit', uploadMiddleware.single('photo'), async (req, res) => {
    try {
      const requiredFields = ['clientName', 'contact', 'description', 'unitPriceType', 'unitPrice'];
      for (const field of requiredFields) {
        if (!req.body[field]) throw new Error(`缺少必填字段: ${field}`);
      }

      const data = {
        ...req.body,
        photo: req.file ? req.file.filename : null,
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
        photoUrl: await getPhotoUrl(data.photo)
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
  app.get('/quotation', async (req, res) => {
    try {
      const row = await dbGet('SELECT * FROM quotations ORDER BY id DESC LIMIT 1');
      if (!row) return res.status(404).json({ error: '没有报价单数据' });

      res.json({
        ...row,
        photo: await getPhotoUrl(row.photo),
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

  server.get('/quotation-detail', async (req, res) => {
    try {
      const { id } = req.query;
      if (!id) throw new Error('缺少报价单ID参数');
  
      // SQLite查询（使用参数化查询防止SQL注入）
      const row = await dbGet(
        `SELECT * FROM quotations WHERE id = ?`, 
        [id]
      );
  
      if (!row) {
        return res.status(404).json({ error: '未找到指定报价单' });
      }
  
      // 处理数据
      const result = {
        ...row,
        photo: getPhotoUrl(row.photo), // 转换图片路径
        samplingCost: row.samplingCost || 0,
        mouldCost: row.mouldCost || 0,
        totalAmount: (
          (row.unitPrice || 0) * (parseInt(row.quantity) || 0) + 
          (parseFloat(row.samplingCost) || 0) + 
          (parseFloat(row.mouldCost) || 0)
        ).toFixed(2)
      };
  
      res.json(result);
    } catch (error) {
      console.error('获取详情错误:', error);
      res.status(500).json({ 
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  });

//搜索报价单
server.get('/search', async (req, res) => {
  try {
    const { materialCode, descriptionKeyword } = req.query;
    
    // 验证参数
    if (!materialCode && !descriptionKeyword) {
      throw new Error('至少需要料号或品名关键词');
    }

    let sql = `SELECT 
                id, description, materialCode, photo, 
                unitPrice, unitPriceType 
              FROM quotations WHERE `;
    const params = [];

    // 动态构建SQL查询
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

    // 执行查询
    const rows = await dbAll(sql, params);

    // 处理图片URL
    const results = rows.map(item => ({
      ...item,
      photo: item.photo ? `/uploads/${path.basename(item.photo)}` : null,
      // 添加单位说明
      unit: item.unitPriceType === 'USD_QUOTATION' ? 'USD' : 'RMB'
    }));

    res.json(results);
  } catch (error) {
    console.error('搜索错误:', error);
    res.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/* ==================== PDF生成 ==================== */
server.get('/download-pdf', async (req, res) => {
    let browser;
    try {
      const { id } = req.query;
  
      // 1. 查询数据
      const row = id 
        ? await dbGet(`SELECT * FROM quotations WHERE id = ?`, [id])
        : await dbGet(`SELECT * FROM quotations ORDER BY id DESC LIMIT 1`);
  
      if (!row) throw new Error(id ? '未找到指定报价单' : '没有可用的报价单');
  
      // 2. 渲染HTML模板
      const htmlPath = path.join(
        process.env.NODE_ENV === 'development'
          ? path.join(__dirname, '../src/quotation.html')
          : path.join(process.resourcesPath, 'app.asar.unpacked', 'src/quotation.html')
      );
  
      if (!fs.existsSync(htmlPath)) {
        throw new Error('HTML模板文件不存在');
      }
  
      let html = fs.readFileSync(htmlPath, 'utf8');
      const totalAmount = (
        (row.unitPrice || 0) * (parseInt(row.quantity) || 0) + 
        (parseFloat(row.samplingCost) || 0) + 
        (parseFloat(row.mouldCost) || 0)
      ).toFixed(2);
  
      // 替换模板变量
      html = html
        .replace(/\{\{clientName\}\}/g, row.clientName || '')
        .replace(/\{\{address\}\}/g, data.address || '')
        .replace(/\{\{contact\}\}/g, data.contact || '')
        .replace(/\{\{tel\}\}/g, data.tel || '')
        .replace(/\{\{email\}\}/g, data.email || '')
        .replace(/\{\{description\}\}/g, data.description || '')
        .replace(/\{\{materialCode\}\}/g, data.materialCode || '')
        .replace(/\{\{photo\}\}/g, row.photo ? `http://localhost:${port}${row.photo}` : '')
        .replace(/\{\{clientDwgMaterial\}\}/g, data.clientDwgMaterial || '')
        .replace(/\{\{afterReviewMaterial\}\}/g, data.afterReviewMaterial || '')
        .replace(/\{\{requirements\}\}/g, data.requirements || '')
        .replace(/\{\{unitPrice\}\}/g, unitPrice.toString())
        .replace(/\{\{unit\}\}/g, `(${data.unitPriceType || ''})`)
        .replace(/\{\{quantity\}\}/g, quantity.toString())
        .replace(/\{\{samplingCost\}\}/g, samplingCost.toString())
        .replace(/\{\{mouldCost\}\}/g, mouldCost.toString())
        .replace(/\{\{sampleNotes\}\}/g, data.sampleNotes || '')
        .replace(/\{\{mouldCycle\}\}/g, data.mouldCycle || '')
        .replace(/\{\{massProductionCycle\}\}/g, data.massProductionCycle || '')
        .replace(/\{\{totalAmount\}\}/g, totalAmount)
        .replace(/\{\{date\}\}/g, new Date().toISOString().split('T')[0]);

      // 3. 使用Puppeteer生成PDF
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 
                       (process.platform === 'win32'
                        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
                        : '/usr/bin/google-chrome')
      });
  
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', right: '3mm', bottom: '10mm', left: '3mm' }
      });
  
      // 4. 返回PDF文件
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="quotation_${row.id || 'latest'}.pdf"`,
        'Content-Length': pdfBuffer.length
      });
      res.send(pdfBuffer);
  
    } catch (error) {
      console.error('PDF生成错误:', error);
      res.status(500).json({ 
        error: `生成PDF失败: ${error.message}`,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    } finally {
      if (browser) await browser.close();
    }
  });

// 获取所有记录（分页）
server.get('/all-records', async (req, res) => {
  try {
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;
      
      // 获取总数
      const countResult = await dbGet('SELECT COUNT(*) as total FROM quotations');
      const total = countResult.total;
      
      // 获取分页数据
      const rows = await dbAll(
          'SELECT id, createdAt, clientName, contact, description, materialCode FROM quotations ORDER BY createdAt DESC LIMIT ? OFFSET ?',
          [limit, offset]
      );
      
      res.json({
          items: rows,
          total: total,
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
      
      // 1. 先获取记录信息（特别是图片路径）
      const record = await dbGet('SELECT photo FROM quotations WHERE id = ?', [id]);
      if (!record) throw new Error('未找到指定记录');
      
      // 2. 删除数据库记录
      const result = await dbRun('DELETE FROM quotations WHERE id = ?', [id]);
      if (result.changes === 0) {
          throw new Error('删除失败，记录可能不存在');
      }
      
      // 3. 如果有关联图片，删除图片文件
      if (record.photo) {
          await deleteImageFile(record.photo);
      }
      
      res.json({ success: true });
  } catch (error) {
      console.error('删除记录错误:', error);
      res.status(500).json({ error: error.message });
  }
});

// 删除图片文件的辅助函数
async function deleteImageFile(imageUrl) {
  return new Promise((resolve, reject) => {
      try {
          // 从URL中提取文件名
          const filename = path.basename(imageUrl.split('?')[0]);
          const filePath = path.join(uploadDir, filename);
          
          fs.unlink(filePath, (err) => {
              if (err) {
                  if (err.code === 'ENOENT') {
                      console.log('图片文件不存在，无需删除:', filePath);
                      resolve();
                  } else {
                      reject(err);
                  }
              } else {
                  console.log('成功删除图片文件:', filePath);
                  resolve();
              }
          });
      } catch (err) {
          reject(err);
      }
  });
}
}

/* ==================== 启动服务器 ==================== */
(async () => {
  try {
    // 初始化路径和数据库
    const paths = await getAppPaths();
    db = await initDatabase();
    const uploadMiddleware = await configureUpload();
    
    // 中间件
    server.use(bodyParser.json());
    server.use(bodyParser.urlencoded({ extended: true }));
    server.use(cors());
    server.use('/uploads', express.static(paths.uploadDir));
    
    // 设置路由
    await setupRoutes(server, uploadMiddleware);
    
    // 错误处理
    server.use((err, req, res, next) => {
      console.error('全局错误:', err.stack);
      res.status(500).json({ 
        error: '服务器内部错误',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });
    
    // 启动服务
    server.listen(port, () => {
      console.log(`服务器运行在 http://localhost:${port}`);
      console.log(`数据库路径: ${paths.dbPath}`);
      console.log(`上传目录: ${paths.uploadDir}`);
    });
  } catch (err) {
    console.error('服务器启动失败:', err);
    process.exit(1);
  }
})();