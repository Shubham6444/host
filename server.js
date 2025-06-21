const express = require("express")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const session = require("express-session")
const MongoStore = require("connect-mongo")
const multer = require("multer")
const path = require("path")
const fs = require("fs").promises
const { exec } = require("child_process")
const util = require("util")
const os = require("os")
const diskusage = require("diskusage")

const app = express()
const execAsync = util.promisify(exec)

// MongoDB connection
mongoose.connect("mongodb://localhost:27017/domain-manager", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: "user", enum: ["user", "admin"] },
  domains: [
    {
      domain: String,
      sslEnabled: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
})

// Activity Log Schema
const activitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  ip: String,
  userAgent: String,
})

const User = mongoose.model("User", userSchema)
const Activity = mongoose.model("Activity", activitySchema)

// Middleware
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static("public"))
app.use("/uploads", express.static("uploads"))

// Session configuration
app.use(
  session({
    secret: "your-secret-key-here-change-in-production",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: "mongodb://localhost:27017/domain-manager",
    }),
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
  }),
)

// File upload configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userDir = `uploads/${req.session.userId}`
    try {
      await fs.mkdir(userDir, { recursive: true })
      cb(null, userDir)
    } catch (error) {
      cb(error)
    }
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname)
  },
})

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Allow all file types for admin users
    cb(null, true)
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
})

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next()
  } else {
    res.status(401).json({ error: "Authentication required" })
  }
}

// Admin middleware
const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required" })
  }

  try {
    const user = await User.findById(req.session.userId)
    if (user && user.role === "admin") {
      next()
    } else {
      res.status(403).json({ error: "Admin access required" })
    }
  } catch (error) {
    res.status(500).json({ error: "Authorization check failed" })
  }
}

// Activity logging helper
async function logActivity(userId, type, title, description, req) {
  try {
    const activity = new Activity({
      userId,
      type,
      title,
      description,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get("User-Agent"),
    })
    await activity.save()
  } catch (error) {
    console.error("Activity logging failed:", error)
  }
}

// Nginx configuration generator
async function generateNginxConfig(user) {
  let config = ""

  for (const domainObj of user.domains) {
    const domain = domainObj.domain
    const userDir = path.join(__dirname, "uploads", user._id.toString())

    config += `
server {
    listen 80;
    server_name ${domain};
    
    location / {
        root ${userDir};
        index index.html;
        try_files $uri $uri/ /index.html;
    }
    
    location ~ /\.ht {
        deny all;
    }
}

`

    if (domainObj.sslEnabled) {
      config += `
server {
    listen 443 ssl;
    server_name ${domain};
    
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    
    location / {
        root ${userDir};
        index index.html;
        try_files $uri $uri/ /index.html;
    }
    
    location ~ /\.ht {
        deny all;
    }
}

`
    }
  }

  return config
}

// SSL certificate generation
async function generateSSLCertificate(domain) {
  try {
    const command = `certbot certonly --nginx -d ${domain} --non-interactive --agree-tos --email admin@${domain}`
    await execAsync(command)
    return true
  } catch (error) {
    console.error("SSL generation failed:", error)
    return false
  }
}

// File system helpers
async function getFileStats(filePath) {
  try {
    const stats = await fs.stat(filePath)
    return {
      name: path.basename(filePath),
      path: filePath,
      type: stats.isDirectory() ? "directory" : "file",
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      permissions: stats.mode.toString(8),
      owner: stats.uid,
      group: stats.gid,
    }
  } catch (error) {
    throw error
  }
}

async function listDirectory(dirPath) {
  try {
    const items = await fs.readdir(dirPath)
    const fileList = []

    for (const item of items) {
      try {
        const itemPath = path.join(dirPath, item)
        const stats = await getFileStats(itemPath)
        fileList.push(stats)
      } catch (error) {
        // Skip files that can't be accessed
        console.warn(`Cannot access ${item}:`, error.message)
      }
    }

    return fileList.sort((a, b) => {
      // Directories first, then files
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  } catch (error) {
    throw error
  }
}

// System monitoring helpers
async function getSystemStats() {
  try {
    const cpus = os.cpus()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem

    // Get disk usage
    const diskInfo = await diskusage.check("/")

    // Calculate CPU usage (simplified)
    let totalIdle = 0
    let totalTick = 0

    cpus.forEach((cpu) => {
      for (const cpuType in cpu.times) {
        totalTick += cpu.times[cpuType]
      }
      totalIdle += cpu.times.idle
    })

    const idle = totalIdle / cpus.length
    const total = totalTick / cpus.length
    const cpuUsage = 100 - ~~((100 * idle) / total)

    return {
      cpu: Math.min(cpuUsage, 100),
      memory: Math.round((usedMem / totalMem) * 100),
      disk: Math.round((diskInfo.used / diskInfo.total) * 100),
      network: true, // Simplified - assume network is available
      diskUsed: diskInfo.used,
      diskTotal: diskInfo.total,
    }
  } catch (error) {
    console.error("System stats error:", error)
    return { cpu: 0, memory: 0, disk: 0, network: false }
  }
}

async function getServiceStatus(serviceName) {
  try {
    const { stdout } = await execAsync(`systemctl is-active ${serviceName}`)
    return stdout.trim() === "active"
  } catch (error) {
    return false
  }
}

// Routes
app.get("/", (req, res) => {
  if (req.session.userId) {
    res.redirect("/dashboard")
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"))
  }
})

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"))
})

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"))
})

app.get("/dashboard", requireAuth, async (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"))
})

app.get("/file-manager", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "file-manager.html"))
})

// API Routes

// Authentication APIs
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body

    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" })
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    })

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const user = new User({
      username,
      email,
      password: hashedPassword,
      role: username === "admin" ? "admin" : "user", // First user named 'admin' gets admin role
    })

    await user.save()

    // Create user directory
    await fs.mkdir(`uploads/${user._id}`, { recursive: true })

    req.session.userId = user._id

    await logActivity(user._id, "system", "User Registration", `New user registered: ${username}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Registration error:", error)
    res.status(500).json({ error: "Registration failed" })
  }
})

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" })
    }

    const user = await User.findOne({ email })
    if (!user) {
      return res.status(400).json({ error: "Invalid credentials" })
    }

    const isMatch = await bcrypt.compare(password, user.password)
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" })
    }

    req.session.userId = user._id

    await logActivity(user._id, "system", "User Login", `User logged in: ${user.username}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

app.get("/api/user", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("-password")
    res.json(user)
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user data" })
  }
})

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" })
    }
    res.json({ success: true })
  })
})

// Domain Management APIs
app.post("/api/domains", requireAuth, async (req, res) => {
  try {
    const { domain } = req.body
    const user = await User.findById(req.session.userId)

    if (!domain) {
      return res.status(400).json({ error: "Domain name is required" })
    }

    if (user.domains.length >= 2) {
      return res.status(400).json({ error: "Maximum 2 domains allowed" })
    }

    if (user.domains.some((d) => d.domain === domain)) {
      return res.status(400).json({ error: "Domain already exists" })
    }

    user.domains.push({ domain })
    await user.save()

    // Generate Nginx configuration
    const nginxConfig = await generateNginxConfig(user)
    await fs.writeFile(`/etc/nginx/sites-available/${user._id}`, nginxConfig)

    // Enable site
    try {
      await execAsync(`ln -sf /etc/nginx/sites-available/${user._id} /etc/nginx/sites-enabled/`)
      await execAsync("nginx -t && systemctl reload nginx")
    } catch (error) {
      console.error("Nginx configuration failed:", error)
    }

    await logActivity(user._id, "domain", "Domain Added", `Domain added: ${domain}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Add domain error:", error)
    res.status(500).json({ error: "Failed to add domain" })
  }
})

app.delete("/api/domains/:domain", requireAuth, async (req, res) => {
  try {
    const domain = req.params.domain
    const user = await User.findById(req.session.userId)

    user.domains = user.domains.filter((d) => d.domain !== domain)
    await user.save()

    // Regenerate Nginx configuration
    const nginxConfig = await generateNginxConfig(user)
    await fs.writeFile(`/etc/nginx/sites-available/${user._id}`, nginxConfig)
    await execAsync("nginx -t && systemctl reload nginx")

    await logActivity(user._id, "domain", "Domain Removed", `Domain removed: ${domain}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Delete domain error:", error)
    res.status(500).json({ error: "Failed to delete domain" })
  }
})

app.post("/api/ssl/:domain", requireAuth, async (req, res) => {
  try {
    const domain = req.params.domain
    const user = await User.findById(req.session.userId)

    const domainObj = user.domains.find((d) => d.domain === domain)
    if (!domainObj) {
      return res.status(404).json({ error: "Domain not found" })
    }

    const sslGenerated = await generateSSLCertificate(domain)
    if (sslGenerated) {
      domainObj.sslEnabled = true
      await user.save()

      // Regenerate Nginx configuration with SSL
      const nginxConfig = await generateNginxConfig(user)
      await fs.writeFile(`/etc/nginx/sites-available/${user._id}`, nginxConfig)
      await execAsync("nginx -t && systemctl reload nginx")

      await logActivity(user._id, "domain", "SSL Enabled", `SSL enabled for: ${domain}`, req)

      res.json({ success: true })
    } else {
      res.status(500).json({ error: "SSL certificate generation failed" })
    }
  } catch (error) {
    console.error("SSL configuration error:", error)
    res.status(500).json({ error: "SSL configuration failed" })
  }
})

// File Management APIs
app.get("/api/files/list", requireAuth, async (req, res) => {
  try {
    const { path: requestedPath } = req.query
    const user = await User.findById(req.session.userId)

    // For admin users, allow access to any path
    // For regular users, restrict to their upload directory
    let targetPath = requestedPath || "/"

    if (user.role !== "admin") {
      const userDir = path.join(__dirname, "uploads", user._id.toString())
      targetPath = path.join(userDir, requestedPath || "")

      // Ensure user can't escape their directory
      if (!targetPath.startsWith(userDir)) {
        return res.status(403).json({ error: "Access denied" })
      }
    }

    const files = await listDirectory(targetPath)
    res.json({ success: true, files })
  } catch (error) {
    console.error("List directory error:", error)
    res.status(500).json({ error: "Failed to list directory contents" })
  }
})

app.post("/api/files/create-folder", requireAuth, async (req, res) => {
  try {
    const { path: basePath, name } = req.body
    const user = await User.findById(req.session.userId)

    if (!name) {
      return res.status(400).json({ error: "Folder name is required" })
    }

    let targetPath = path.join(basePath || "/", name)

    if (user.role !== "admin") {
      const userDir = path.join(__dirname, "uploads", user._id.toString())
      targetPath = path.join(userDir, basePath || "", name)

      if (!targetPath.startsWith(userDir)) {
        return res.status(403).json({ error: "Access denied" })
      }
    }

    await fs.mkdir(targetPath, { recursive: true })

    await logActivity(user._id, "file", "Folder Created", `Folder created: ${name}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Create folder error:", error)
    res.status(500).json({ error: "Failed to create folder" })
  }
})

app.post("/api/files/create-file", requireAuth, async (req, res) => {
  try {
    const { path: basePath, name } = req.body
    const user = await User.findById(req.session.userId)

    if (!name) {
      return res.status(400).json({ error: "File name is required" })
    }

    let targetPath = path.join(basePath || "/", name)

    if (user.role !== "admin") {
      const userDir = path.join(__dirname, "uploads", user._id.toString())
      targetPath = path.join(userDir, basePath || "", name)

      if (!targetPath.startsWith(userDir)) {
        return res.status(403).json({ error: "Access denied" })
      }
    }

    await fs.writeFile(targetPath, "")

    await logActivity(user._id, "file", "File Created", `File created: ${name}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Create file error:", error)
    res.status(500).json({ error: "Failed to create file" })
  }
})

app.post("/api/files/upload", requireAuth, upload.array("files"), async (req, res) => {
  try {
    const { path: uploadPath } = req.body
    const user = await User.findById(req.session.userId)

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" })
    }

    // Move files to the correct location if needed
    for (const file of req.files) {
      let targetDir = uploadPath || "/"

      if (user.role !== "admin") {
        const userDir = path.join(__dirname, "uploads", user._id.toString())
        targetDir = path.join(userDir, uploadPath || "")

        if (!targetDir.startsWith(userDir)) {
          return res.status(403).json({ error: "Access denied" })
        }
      }

      const targetPath = path.join(targetDir, file.originalname)

      if (file.path !== targetPath) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.rename(file.path, targetPath)
      }
    }

    await logActivity(user._id, "upload", "Files Uploaded", `${req.files.length} files uploaded`, req)

    res.json({
      success: true,
      files: req.files.map((file) => ({
        filename: file.originalname,
        size: file.size,
      })),
    })
  } catch (error) {
    console.error("File upload error:", error)
    res.status(500).json({ error: "File upload failed" })
  }
})

app.post("/api/files/delete", requireAuth, async (req, res) => {
  try {
    const { items, path: basePath } = req.body
    const user = await User.findById(req.session.userId)

    if (!items || items.length === 0) {
      return res.status(400).json({ error: "No items specified for deletion" })
    }

    for (const item of items) {
      let targetPath = path.join(basePath || "/", item)

      if (user.role !== "admin") {
        const userDir = path.join(__dirname, "uploads", user._id.toString())
        targetPath = path.join(userDir, basePath || "", item)

        if (!targetPath.startsWith(userDir)) {
          return res.status(403).json({ error: "Access denied" })
        }
      }

      try {
        const stats = await fs.stat(targetPath)
        if (stats.isDirectory()) {
          await fs.rmdir(targetPath, { recursive: true })
        } else {
          await fs.unlink(targetPath)
        }
      } catch (error) {
        console.warn(`Failed to delete ${item}:`, error.message)
      }
    }

    await logActivity(user._id, "file", "Files Deleted", `${items.length} items deleted`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Delete files error:", error)
    res.status(500).json({ error: "Failed to delete files" })
  }
})

app.post("/api/files/rename", requireAuth, async (req, res) => {
  try {
    const { oldPath, newName } = req.body
    const user = await User.findById(req.session.userId)

    if (!oldPath || !newName) {
      return res.status(400).json({ error: "Old path and new name are required" })
    }

    const sourcePath = oldPath
    const targetPath = path.join(path.dirname(oldPath), newName)

    if (user.role !== "admin") {
      const userDir = path.join(__dirname, "uploads", user._id.toString())

      if (!sourcePath.startsWith(userDir) || !targetPath.startsWith(userDir)) {
        return res.status(403).json({ error: "Access denied" })
      }
    }

    await fs.rename(sourcePath, targetPath)

    await logActivity(user._id, "file", "File Renamed", `File renamed: ${path.basename(oldPath)} → ${newName}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Rename file error:", error)
    res.status(500).json({ error: "Failed to rename file" })
  }
})

app.get("/api/files/properties", requireAuth, async (req, res) => {
  try {
    const { path: filePath } = req.query
    const user = await User.findById(req.session.userId)

    if (!filePath) {
      return res.status(400).json({ error: "File path is required" })
    }

    const targetPath = filePath

    if (user.role !== "admin") {
      const userDir = path.join(__dirname, "uploads", user._id.toString())

      if (!targetPath.startsWith(userDir)) {
        return res.status(403).json({ error: "Access denied" })
      }
    }

    const properties = await getFileStats(targetPath)
    res.json({ success: true, properties })
  } catch (error) {
    console.error("Get file properties error:", error)
    res.status(500).json({ error: "Failed to get file properties" })
  }
})

// System Management APIs
app.get("/api/system/stats", requireAuth, async (req, res) => {
  try {
    const stats = await getSystemStats()
    res.json({ success: true, ...stats })
  } catch (error) {
    console.error("System stats error:", error)
    res.status(500).json({ error: "Failed to get system stats" })
  }
})

app.get("/api/system/disk-space", requireAuth, async (req, res) => {
  try {
    const diskInfo = await diskusage.check("/")
    res.json({
      success: true,
      used: diskInfo.used,
      total: diskInfo.total,
      free: diskInfo.free,
    })
  } catch (error) {
    console.error("Disk space error:", error)
    res.status(500).json({ error: "Failed to get disk space" })
  }
})

app.get("/api/system/services", requireAuth, async (req, res) => {
  try {
    const services = {
      nginx: await getServiceStatus("nginx"),
      mysql: (await getServiceStatus("mysql")) || (await getServiceStatus("mariadb")),
      php:
        (await getServiceStatus("php7.4-fpm")) ||
        (await getServiceStatus("php8.0-fpm")) ||
        (await getServiceStatus("php-fpm")),
      firewall: await getServiceStatus("ufw"),
    }

    res.json({ success: true, ...services })
  } catch (error) {
    console.error("Services status error:", error)
    res.status(500).json({ error: "Failed to get services status" })
  }
})

app.post("/api/system/service-control", requireAuth, async (req, res) => {
  try {
    const { service, action } = req.body
    const user = await User.findById(req.session.userId)

    // Only admin users can control services
    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" })
    }

    const allowedServices = ["nginx", "mysql", "mariadb", "php7.4-fpm", "php8.0-fpm", "php-fpm", "ufw"]
    const allowedActions = ["start", "stop", "restart", "enable", "disable"]

    if (!allowedServices.includes(service) || !allowedActions.includes(action)) {
      return res.status(400).json({ error: "Invalid service or action" })
    }

    let command
    if (service === "ufw") {
      command = `ufw --force ${action}`
    } else {
      command = `systemctl ${action} ${service}`
    }

    await execAsync(command)

    await logActivity(user._id, "service", "Service Control", `${service} ${action}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Service control error:", error)
    res.status(500).json({ error: `Failed to ${req.body.action} ${req.body.service}` })
  }
})

app.get("/api/system/activity", requireAuth, async (req, res) => {
  try {
    const activities = await Activity.find({ userId: req.session.userId }).sort({ timestamp: -1 }).limit(50).lean()

    res.json({ success: true, logs: activities })
  } catch (error) {
    console.error("Activity log error:", error)
    res.status(500).json({ error: "Failed to get activity log" })
  }
})

app.post("/api/system/backup", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)

    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" })
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupDir = `/tmp/backup-${timestamp}`

    // Create backup directory
    await fs.mkdir(backupDir, { recursive: true })

    // Backup user uploads
    await execAsync(`cp -r uploads ${backupDir}/`)

    // Backup nginx configs
    await execAsync(`cp -r /etc/nginx/sites-available ${backupDir}/nginx-configs`)

    // Create tar archive
    const archiveName = `backup-${timestamp}.tar.gz`
    await execAsync(`cd /tmp && tar -czf ${archiveName} backup-${timestamp}`)

    // Clean up temporary directory
    await execAsync(`rm -rf ${backupDir}`)

    await logActivity(user._id, "system", "Backup Created", `System backup created: ${archiveName}`, req)

    res.json({ success: true, backup: archiveName })
  } catch (error) {
    console.error("Backup error:", error)
    res.status(500).json({ error: "Failed to create backup" })
  }
})

// Terminal API
app.post("/api/terminal/execute", requireAuth, async (req, res) => {
  try {
    const { command } = req.body
    const user = await User.findById(req.session.userId)

    if (user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required for terminal" })
    }

    if (!command) {
      return res.status(400).json({ error: "Command is required" })
    }

    // Security: Block dangerous commands
    const dangerousCommands = ["rm -rf /", "mkfs", "dd if=", "format", "fdisk"]
    const isDangerous = dangerousCommands.some((dangerous) => command.toLowerCase().includes(dangerous.toLowerCase()))

    if (isDangerous) {
      return res.status(403).json({ error: "Command blocked for security reasons" })
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024, // 1MB buffer
      })

      const output = stdout + (stderr ? "\nSTDERR:\n" + stderr : "")

      await logActivity(user._id, "system", "Terminal Command", `Executed: ${command}`, req)

      res.json({ success: true, output })
    } catch (execError) {
      res.json({
        success: true,
        output: `Command failed: ${execError.message}\n${execError.stdout || ""}\n${execError.stderr || ""}`,
      })
    }
  } catch (error) {
    console.error("Terminal execute error:", error)
    res.status(500).json({ error: "Failed to execute command" })
  }
})

// Legacy file APIs (for backward compatibility)
app.post("/api/upload", requireAuth, upload.array("htmlFiles"), async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)

    await logActivity(user._id, "upload", "Files Uploaded", `${req.files.length} HTML files uploaded`, req)

    res.json({
      success: true,
      files: req.files.map((file) => ({
        filename: file.filename,
        path: file.path,
      })),
    })
  } catch (error) {
    console.error("Legacy upload error:", error)
    res.status(500).json({ error: "File upload failed" })
  }
})

app.get("/api/files", requireAuth, async (req, res) => {
  try {
    const userDir = `uploads/${req.session.userId}`
    const files = await fs.readdir(userDir)
    const htmlFiles = files.filter((file) => path.extname(file) === ".html")
    res.json(htmlFiles)
  } catch (error) {
    res.json([])
  }
})

app.delete("/api/files/:filename", requireAuth, async (req, res) => {
  try {
    const filename = req.params.filename
    const filePath = `uploads/${req.session.userId}/${filename}`
    await fs.unlink(filePath)

    const user = await User.findById(req.session.userId)
    await logActivity(user._id, "file", "File Deleted", `File deleted: ${filename}`, req)

    res.json({ success: true })
  } catch (error) {
    console.error("Delete file error:", error)
    res.status(500).json({ error: "Failed to delete file" })
  }
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error)
  res.status(500).json({ error: "Internal server error" })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 Hosting Panel Server running on port ${PORT}`)
  console.log(`📁 File Manager: http://localhost:${PORT}/file-manager`)
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`)
})
