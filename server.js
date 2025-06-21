require("dotenv").config()
const express = require("express")
const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const session = require("express-session")
const MongoStore = require("connect-mongo")
const multer = require("multer")
const path = require("path")
const fs = require("fs").promises
const fssync = require("fs")
const { exec } = require("child_process")
const util = require("util")

const app = express()
const execAsync = util.promisify(exec)

// MongoDB connection with better error handling
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/domain-manager", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("✅ Connected to MongoDB")
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err)
    process.exit(1)
  })

// Enhanced User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fileLimit: { type: Number, default: 50 }, // MB
  domains: [
    {
      domain: String,
      sslEnabled: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
})

const User = mongoose.model("User", userSchema)

// Global settings schema
const settingsSchema = new mongoose.Schema({
  defaultFileLimit: { type: Number, default: 50 },
  updatedAt: { type: Date, default: Date.now },
})

const Settings = mongoose.model("Settings", settingsSchema)

// Middleware
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static("public"))
app.use("/uploads", express.static("uploads"))

// Enhanced session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI || "mongodb://localhost:27017/domain-manager",
      touchAfter: 24 * 3600,
    }),
    cookie: {
      maxAge: 86400000, // 24 hours
      secure: false,
    },
  }),
)

// Update multer configuration to accept all file types and handle folders
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const userDir = `uploads/${req.session.userId}`
    const folderPath = req.body.folderPath || ""
    const fullPath = path.join(userDir, folderPath)

    try {
      await fs.mkdir(fullPath, { recursive: true })
      cb(null, fullPath)
    } catch (error) {
      cb(error)
    }
  },
  filename: (req, file, cb) => {
    // Preserve original filename with proper sanitization
    const sanitizedName = file.originalname.replace(/[<>:"/\\|?*]/g, "_")
    cb(null, sanitizedName)
  },
})

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Accept all file types
    cb(null, true)
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
})

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next()
  } else {
    res.status(401).json({ error: "Authentication required" })
  }
}

// Enhanced Nginx configuration generator
async function generateNginxConfig(user) {
  let config = ""

  for (const { domain, sslEnabled } of user.domains) {
    const rootDir = path.join(__dirname, "uploads", user._id.toString())

    config += `
server {
    listen 80;
    server_name ${domain};
    return 301 https://${domain}$request_uri;
}
`

    if (sslEnabled) {
      config += `
server {
    listen 443 ssl http2;
    server_name ${domain};

    root ${rootDir};
    index index.html;

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/${domain}/chain.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;

    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

    location / {
        try_files $uri $uri/ /index.html;
        
        location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    location ~ /\.(ht|git|env) {
        deny all;
    }
}
`
    } else {
      config += `
server {
    listen 80;
    server_name ${domain};
    
    root ${rootDir};
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
}
`
    }
  }

  return config
}

// Enhanced SSL certificate generation
async function generateSSLCertificate(domain) {
  const email = process.env.CERTBOT_EMAIL || "admin@example.com"

  try {
    console.log(`🔐 Generating SSL certificate for ${domain}...`)
    await execAsync("sudo nginx -t")

    const command = `sudo certbot certonly --nginx -d ${domain} --non-interactive --agree-tos --email ${email} --no-eff-email`
    const { stdout } = await execAsync(command)

    console.log(`✅ SSL certificate generated for ${domain}`)
    console.log("Certbot output:", stdout)
    return true
  } catch (error) {
    console.error(`❌ SSL generation failed for ${domain}:`, error.stderr || error.message)
    return false
  }
}

// Routes
app.get("/", (req, res) => {
  if (req.session.userId) {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"))
  } else {
    res.sendFile(path.join(__dirname, "public", "index.html"))
  }
})

app.get("/dashboard", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"))
})

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"))
})

app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"))
})

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"))
})

// Authentication routes
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body

    if (!username || !email || !password) {
      return res.status(400).json({ error: "All fields are required" })
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" })
    }

    const existingUser = await User.findOne({
      $or: [{ username }, { email }],
    })

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
    })

    await fs.mkdir(`uploads/${user._id}`, { recursive: true })
    req.session.userId = user._id
    console.log(`✅ New user registered: ${username}`)

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
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: "Invalid credentials" })
    }

    req.session.userId = user._id
    console.log(`✅ User logged in: ${user.username}`)

    res.json({ success: true })
  } catch (error) {
    console.error("Login error:", error)
    res.status(500).json({ error: "Login failed" })
  }
})

app.post("/api/logout", (req, res) => {
  const userId = req.session.userId
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err)
      return res.status(500).json({ error: "Logout failed" })
    }
    console.log(`✅ User logged out: ${userId}`)
    res.json({ success: true })
  })
})

// User data route
app.get("/api/user", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select("-password")
    res.json(user)
  } catch (error) {
    console.error("Error fetching user data:", error)
    res.status(500).json({ error: "Failed to fetch user data" })
  }
})

// Domain management routes
app.post("/api/domains", requireAuth, async (req, res) => {
  try {
    const { domain } = req.body

    if (!domain) {
      return res.status(400).json({ error: "Domain is required" })
    }

    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/
    if (!domainRegex.test(domain)) {
      return res.status(400).json({ error: "Invalid domain format" })
    }

    const user = await User.findById(req.session.userId)

    if (user.domains.length >= 2) {
      return res.status(400).json({ error: "Maximum 2 domains allowed per user" })
    }

    if (user.domains.some((d) => d.domain === domain)) {
      return res.status(400).json({ error: "Domain already exists" })
    }

    const existingDomain = await User.findOne({ "domains.domain": domain })
    if (existingDomain) {
      return res.status(400).json({ error: "Domain is already in use" })
    }

    user.domains.push({ domain })
    await user.save()

    const config = await generateNginxConfig(user)
    const configPath = `/etc/nginx/sites-available/${user._id}`
    const symlinkPath = `/etc/nginx/sites-enabled/${user._id}`

    await fs.writeFile(configPath, config)
    await execAsync(`sudo ln -sf ${configPath} ${symlinkPath}`)
    await execAsync("sudo nginx -t && sudo systemctl reload nginx")

    console.log(`✅ Domain added: ${domain} for user ${user.username}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error adding domain:", error)
    res.status(500).json({ error: "Failed to add domain" })
  }
})

app.delete("/api/domains/:domain", requireAuth, async (req, res) => {
  try {
    const domain = decodeURIComponent(req.params.domain)
    const user = await User.findById(req.session.userId)

    const domainIndex = user.domains.findIndex((d) => d.domain === domain)
    if (domainIndex === -1) {
      return res.status(404).json({ error: "Domain not found" })
    }

    user.domains.splice(domainIndex, 1)
    await user.save()

    const configPath = `/etc/nginx/sites-available/${user._id}`
    const symlinkPath = `/etc/nginx/sites-enabled/${user._id}`

    if (user.domains.length === 0) {
      await execAsync(`sudo rm -f ${configPath} ${symlinkPath}`)
    } else {
      const updatedConfig = await generateNginxConfig(user)
      await fs.writeFile(configPath, updatedConfig)
    }

    await execAsync("sudo nginx -t && sudo systemctl reload nginx")

    console.log(`✅ Domain deleted: ${domain} for user ${user.username}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting domain:", error)
    res.status(500).json({ error: "Failed to delete domain" })
  }
})

// SSL management
app.post("/api/ssl/:domain", requireAuth, async (req, res) => {
  try {
    const domain = decodeURIComponent(req.params.domain)
    const user = await User.findById(req.session.userId)

    const domainObj = user.domains.find((d) => d.domain === domain)
    if (!domainObj) {
      return res.status(404).json({ error: "Domain not found" })
    }

    if (domainObj.sslEnabled) {
      return res.status(400).json({ error: "SSL already enabled for this domain" })
    }

    console.log(`🔐 Starting SSL generation for ${domain}...`)

    if (await generateSSLCertificate(domain)) {
      domainObj.sslEnabled = true
      await user.save()

      const config = await generateNginxConfig(user)
      await fs.writeFile(`/etc/nginx/sites-available/${user._id}`, config)
      await execAsync("sudo nginx -t && sudo systemctl reload nginx")

      console.log(`✅ SSL enabled for ${domain}`)
      res.json({ success: true })
    } else {
      res.status(500).json({ error: "SSL certificate generation failed" })
    }
  } catch (error) {
    console.error("SSL error:", error)
    res.status(500).json({ error: "SSL generation failed" })
  }
})

// File management routes
app.get("/api/files", requireAuth, async (req, res) => {
  try {
    const userDir = `uploads/${req.session.userId}`

    if (!fssync.existsSync(userDir)) {
      return res.json([])
    }

    const files = await fs.readdir(userDir)
    const htmlFiles = files.filter((file) => path.extname(file).toLowerCase() === ".html")

    res.json(htmlFiles)
  } catch (error) {
    console.error("Error loading files:", error)
    res.json([])
  }
})

// Get file content for editing
app.get("/api/files/:filename/content", requireAuth, async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename)

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" })
    }

    const filePath = `uploads/${req.session.userId}/${filename}`

    if (!fssync.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" })
    }

    const content = await fs.readFile(filePath, "utf8")
    res.send(content)
  } catch (error) {
    console.error("Error reading file:", error)
    res.status(500).json({ error: "Failed to read file" })
  }
})

// Update file content
app.put("/api/files/:filename", requireAuth, async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename)
    const { content } = req.body

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" })
    }

    if (!content && content !== "") {
      return res.status(400).json({ error: "Content is required" })
    }

    const filePath = `uploads/${req.session.userId}/${filename}`

    if (!fssync.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" })
    }

    await fs.writeFile(filePath, content, "utf8")

    console.log(`✅ File updated: ${filename} for user ${req.session.userId}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error updating file:", error)
    res.status(500).json({ error: "Failed to update file" })
  }
})

app.delete("/api/files/:filename", requireAuth, async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename)

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" })
    }

    const filePath = `uploads/${req.session.userId}/${filename}`
    await fs.unlink(filePath)

    console.log(`✅ File deleted: ${filename} for user ${req.session.userId}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting file:", error)
    res.status(500).json({ error: "Failed to delete file" })
  }
})

// Add new file manager routes after the existing file routes

// Get directory contents
app.get("/api/files/browse", requireAuth, async (req, res) => {
  try {
    const folderPath = req.query.path || ""
    const userDir = `uploads/${req.session.userId}`
    const fullPath = path.join(userDir, folderPath)

    // Security check
    if (!fullPath.startsWith(userDir)) {
      return res.status(400).json({ error: "Invalid path" })
    }

    if (!fssync.existsSync(fullPath)) {
      return res.json({ files: [], folders: [], currentPath: folderPath })
    }

    const items = await fs.readdir(fullPath, { withFileTypes: true })
    const files = []
    const folders = []

    for (const item of items) {
      const itemPath = path.join(fullPath, item.name)
      const stats = await fs.stat(itemPath)

      if (item.isDirectory()) {
        folders.push({
          name: item.name,
          type: "folder",
          modified: stats.mtime,
          path: path.join(folderPath, item.name).replace(/\\/g, "/"),
        })
      } else {
        files.push({
          name: item.name,
          type: "file",
          size: stats.size,
          modified: stats.mtime,
          extension: path.extname(item.name).toLowerCase(),
          path: path.join(folderPath, item.name).replace(/\\/g, "/"),
        })
      }
    }

    res.json({
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      currentPath: folderPath,
    })
  } catch (error) {
    console.error("Error browsing files:", error)
    res.status(500).json({ error: "Failed to browse files" })
  }
})

// Create new folder
app.post("/api/files/folder", requireAuth, async (req, res) => {
  try {
    const { folderName, currentPath = "" } = req.body

    if (!folderName || folderName.includes("/") || folderName.includes("\\")) {
      return res.status(400).json({ error: "Invalid folder name" })
    }

    const userDir = `uploads/${req.session.userId}`
    const folderPath = path.join(userDir, currentPath, folderName)

    if (fssync.existsSync(folderPath)) {
      return res.status(400).json({ error: "Folder already exists" })
    }

    await fs.mkdir(folderPath, { recursive: true })

    console.log(`✅ Folder created: ${folderName} for user ${req.session.userId}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error creating folder:", error)
    res.status(500).json({ error: "Failed to create folder" })
  }
})

// Create new file
app.post("/api/files/create", requireAuth, async (req, res) => {
  try {
    const { fileName, currentPath = "", content = "" } = req.body

    if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
      return res.status(400).json({ error: "Invalid file name" })
    }

    const userDir = `uploads/${req.session.userId}`
    const filePath = path.join(userDir, currentPath, fileName)

    if (fssync.existsSync(filePath)) {
      return res.status(400).json({ error: "File already exists" })
    }

    await fs.writeFile(filePath, content, "utf8")

    console.log(`✅ File created: ${fileName} for user ${req.session.userId}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error creating file:", error)
    res.status(500).json({ error: "Failed to create file" })
  }
})

// Rename file or folder
app.put("/api/files/rename", requireAuth, async (req, res) => {
  try {
    const { oldPath, newName } = req.body

    if (!oldPath || !newName || newName.includes("/") || newName.includes("\\")) {
      return res.status(400).json({ error: "Invalid parameters" })
    }

    const userDir = `uploads/${req.session.userId}`
    const oldFullPath = path.join(userDir, oldPath)
    const newFullPath = path.join(path.dirname(oldFullPath), newName)

    if (!fssync.existsSync(oldFullPath)) {
      return res.status(404).json({ error: "File or folder not found" })
    }

    if (fssync.existsSync(newFullPath)) {
      return res.status(400).json({ error: "Name already exists" })
    }

    await fs.rename(oldFullPath, newFullPath)

    console.log(`✅ Renamed: ${oldPath} to ${newName} for user ${req.session.userId}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error renaming:", error)
    res.status(500).json({ error: "Failed to rename" })
  }
})

// Delete file or folder
app.delete("/api/files/delete", requireAuth, async (req, res) => {
  try {
    const { itemPath } = req.body

    if (!itemPath) {
      return res.status(400).json({ error: "Path is required" })
    }

    const userDir = `uploads/${req.session.userId}`
    const fullPath = path.join(userDir, itemPath)

    if (!fullPath.startsWith(userDir)) {
      return res.status(400).json({ error: "Invalid path" })
    }

    if (!fssync.existsSync(fullPath)) {
      return res.status(404).json({ error: "File or folder not found" })
    }

    const stats = await fs.stat(fullPath)

    if (stats.isDirectory()) {
      await fs.rmdir(fullPath, { recursive: true })
    } else {
      await fs.unlink(fullPath)
    }

    console.log(`✅ Deleted: ${itemPath} for user ${req.session.userId}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting:", error)
    res.status(500).json({ error: "Failed to delete" })
  }
})

// Update file upload to handle folders and all file types
app.post("/api/upload", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)
    const fileLimit = (user.fileLimit || 100) * 1024 * 1024

    const dynamicUpload = multer({
      storage,
      fileFilter: (req, file, cb) => {
        // Accept all file types
        cb(null, true)
      },
      limits: { fileSize: fileLimit },
    }).array("files")

    dynamicUpload(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            error: `File size exceeds ${user.fileLimit || 100}MB limit`,
          })
        }
        return res.status(400).json({ error: err.message })
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" })
      }

      console.log(`✅ Files uploaded for user ${user.username}: ${req.files.map((f) => f.filename).join(", ")}`)

      res.json({
        success: true,
        files: req.files.map((file) => ({
          filename: file.filename,
          size: file.size,
          path: file.path,
        })),
      })
    })
  } catch (error) {
    console.error("Upload error:", error)
    res.status(500).json({ error: "Upload failed" })
  }
})

// Admin routes (same as before but with enhanced logging)
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await User.find({}).select("-password")

    const usersWithFileCount = await Promise.all(
      users.map(async (user) => {
        try {
          const userDir = `uploads/${user._id}`
          if (fssync.existsSync(userDir)) {
            const files = await fs.readdir(userDir)
            const htmlFiles = files.filter((file) => path.extname(file).toLowerCase() === ".html")
            return { ...user.toObject(), fileCount: htmlFiles.length }
          }
          return { ...user.toObject(), fileCount: 0 }
        } catch {
          return { ...user.toObject(), fileCount: 0 }
        }
      }),
    )

    res.json(usersWithFileCount)
  } catch (error) {
    console.error("Error fetching users:", error)
    res.status(500).json({ error: "Failed to fetch users" })
  }
})

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Server Error:", error)

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File size exceeds limit" })
    }
    return res.status(400).json({ error: "File upload error" })
  }

  res.status(500).json({ error: "Internal server error" })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" })
})

// Start server
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`)
  console.log(`🌐 Dashboard: http://localhost:${PORT}/dashboard`)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully")
  mongoose.connection.close(() => {
    console.log("MongoDB connection closed")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully")
  mongoose.connection.close(() => {
    console.log("MongoDB connection closed")
    process.exit(0)
  })
})
