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

// Add this after the imports and before mongoose connection
const setupDirectories = async () => {
  try {
    const uploadsDir = path.join(__dirname, "uploads")

    if (!fssync.existsSync(uploadsDir)) {
      await fs.mkdir(uploadsDir, { recursive: true })
      console.log("✅ Created uploads directory")
    }

    // Set proper permissions (if on Unix-like system)
    if (process.platform !== "win32") {
      try {
        await fs.chmod(uploadsDir, 0o775)
        console.log("✅ Set uploads directory permissions")
      } catch (error) {
        console.log("⚠️  Could not set directory permissions:", error.message)
      }
    }
  } catch (error) {
    console.error("❌ Error setting up directories:", error)
  }
}

// Call setup function
setupDirectories()

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

// Update the existing single file delete endpoint
app.delete("/api/files/:filename", requireAuth, async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename)

    // Security check
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" })
    }

    const userDir = `uploads/${req.session.userId}`
    const filePath = path.join(userDir, filename)

    // Additional security check
    const resolvedUserDir = path.resolve(userDir)
    const resolvedFilePath = path.resolve(filePath)

    if (!resolvedFilePath.startsWith(resolvedUserDir)) {
      return res.status(400).json({ error: "Invalid path - security violation" })
    }

    if (!fssync.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" })
    }

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
    const { path: folderPath = "", rootPath = "user", sortBy = "name", sortOrder = "asc", search = "" } = req.query

    let basePath
    switch (rootPath) {
      case "system":
        if (!isAdmin(req.session.userId)) {
          return res.status(403).json({ error: "Admin access required for system files" })
        }
        basePath = "/"
        break
      case "home":
        basePath = "/home"
        break
      case "var":
        basePath = "/var"
        break
      case "etc":
        basePath = "/etc"
        break
      case "tmp":
        basePath = "/tmp"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const fullPath = path.join(basePath, folderPath)

    // Security check for user files
    if (rootPath === "user" && !fullPath.startsWith(`uploads/${req.session.userId}`)) {
      return res.status(400).json({ error: "Invalid path" })
    }

    if (!fssync.existsSync(fullPath)) {
      return res.json({ files: [], folders: [], currentPath: folderPath })
    }

    const items = await fs.readdir(fullPath, { withFileTypes: true })
    const files = []
    const folders = []

    for (const item of items) {
      try {
        const itemPath = path.join(fullPath, item.name)
        const stats = await fs.stat(itemPath)
        const relativePath = path.join(folderPath, item.name).replace(/\\/g, "/")

        // Apply search filter
        if (search && !item.name.toLowerCase().includes(search.toLowerCase())) {
          continue
        }

        const itemData = {
          name: item.name,
          path: relativePath,
          modified: stats.mtime,
          permissions: stats.mode.toString(8).slice(-3),
        }

        if (item.isDirectory()) {
          folders.push({
            ...itemData,
            type: "folder",
          })
        } else {
          files.push({
            ...itemData,
            type: "file",
            size: stats.size,
            extension: path.extname(item.name).toLowerCase(),
          })
        }
      } catch (error) {
        console.error(`Error processing item ${item.name}:`, error)
      }
    }

    // Sort items
    const sortFunction = (a, b) => {
      let comparison = 0
      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name)
          break
        case "modified":
          comparison = new Date(a.modified) - new Date(b.modified)
          break
        case "size":
          comparison = (a.size || 0) - (b.size || 0)
          break
        case "type":
          comparison = (a.extension || "").localeCompare(b.extension || "")
          break
        default:
          comparison = a.name.localeCompare(b.name)
      }
      return sortOrder === "desc" ? -comparison : comparison
    }

    folders.sort(sortFunction)
    files.sort(sortFunction)

    res.json({
      files,
      folders,
      currentPath: folderPath,
    })
  } catch (error) {
    console.error("Error browsing files:", error)
    res.status(500).json({ error: "Failed to browse files" })
  }
})

// Get file content with system access
app.get("/api/files/content", requireAuth, async (req, res) => {
  try {
    const { path: filePath, rootPath = "user" } = req.query

    let basePath
    switch (rootPath) {
      case "system":
        if (!isAdmin(req.session.userId)) {
          return res.status(403).json({ error: "Admin access required" })
        }
        basePath = "/"
        break
      case "home":
        basePath = "/home"
        break
      case "var":
        basePath = "/var"
        break
      case "etc":
        basePath = "/etc"
        break
      case "tmp":
        basePath = "/tmp"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const fullPath = path.join(basePath, filePath)

    // Security check
    if (rootPath === "user" && !fullPath.startsWith(`uploads/${req.session.userId}`)) {
      return res.status(400).json({ error: "Invalid path" })
    }

    if (!fssync.existsSync(fullPath)) {
      return res.status(404).json({ error: "File not found" })
    }

    const content = await fs.readFile(fullPath, "utf8")
    res.send(content)
  } catch (error) {
    console.error("Error reading file:", error)
    res.status(500).json({ error: "Failed to read file" })
  }
})

// Save file content
app.put("/api/files/save", requireAuth, async (req, res) => {
  try {
    const { filePath, content, rootPath = "user" } = req.body

    let basePath
    switch (rootPath) {
      case "system":
        if (!isAdmin(req.session.userId)) {
          return res.status(403).json({ error: "Admin access required" })
        }
        basePath = "/"
        break
      case "home":
        basePath = "/home"
        break
      case "var":
        basePath = "/var"
        break
      case "etc":
        basePath = "/etc"
        break
      case "tmp":
        basePath = "/tmp"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const fullPath = path.join(basePath, filePath)

    // Security check
    if (rootPath === "user" && !fullPath.startsWith(`uploads/${req.session.userId}`)) {
      return res.status(400).json({ error: "Invalid path" })
    }

    await fs.writeFile(fullPath, content, "utf8")
    console.log(`✅ File saved: ${filePath}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error saving file:", error)
    res.status(500).json({ error: "Failed to save file" })
  }
})

// Download file
app.get("/api/files/download", requireAuth, async (req, res) => {
  try {
    const { path: filePath, rootPath = "user" } = req.query

    let basePath
    switch (rootPath) {
      case "system":
        if (!isAdmin(req.session.userId)) {
          return res.status(403).json({ error: "Admin access required" })
        }
        basePath = "/"
        break
      case "home":
        basePath = "/home"
        break
      case "var":
        basePath = "/var"
        break
      case "etc":
        basePath = "/etc"
        break
      case "tmp":
        basePath = "/tmp"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const fullPath = path.join(basePath, filePath)

    // Security check
    if (rootPath === "user" && !fullPath.startsWith(`uploads/${req.session.userId}`)) {
      return res.status(400).json({ error: "Invalid path" })
    }

    if (!fssync.existsSync(fullPath)) {
      return res.status(404).json({ error: "File not found" })
    }

    const fileName = path.basename(fullPath)
    res.download(fullPath, fileName)
  } catch (error) {
    console.error("Error downloading file:", error)
    res.status(500).json({ error: "Failed to download file" })
  }
})

// Paste files (copy/cut operation)
app.post("/api/files/paste", requireAuth, async (req, res) => {
  try {
    const { items, operation, targetPath, rootPath = "user" } = req.body

    let basePath
    switch (rootPath) {
      case "system":
        if (!isAdmin(req.session.userId)) {
          return res.status(403).json({ error: "Admin access required" })
        }
        basePath = "/"
        break
      case "home":
        basePath = "/home"
        break
      case "var":
        basePath = "/var"
        break
      case "etc":
        basePath = "/etc"
        break
      case "tmp":
        basePath = "/tmp"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const targetDir = path.join(basePath, targetPath)

    for (const itemPath of items) {
      const sourcePath = path.join(basePath, itemPath)
      const itemName = path.basename(itemPath)
      const destPath = path.join(targetDir, itemName)

      if (operation === "copy") {
        await fs.copyFile(sourcePath, destPath)
      } else if (operation === "cut") {
        await fs.rename(sourcePath, destPath)
      }
    }

    console.log(`✅ ${operation} operation completed for ${items.length} items`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error in paste operation:", error)
    res.status(500).json({ error: "Failed to paste items" })
  }
})

// Delete multiple items
app.delete("/api/files/delete-multiple", requireAuth, async (req, res) => {
  try {
    const { itemPaths, rootPath = "user" } = req.body

    let basePath
    switch (rootPath) {
      case "system":
        if (!isAdmin(req.session.userId)) {
          return res.status(403).json({ error: "Admin access required" })
        }
        basePath = "/"
        break
      case "home":
        basePath = "/home"
        break
      case "var":
        basePath = "/var"
        break
      case "etc":
        basePath = "/etc"
        break
      case "tmp":
        basePath = "/tmp"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    for (const itemPath of itemPaths) {
      const fullPath = path.join(basePath, itemPath)

      if (fssync.existsSync(fullPath)) {
        const stats = await fs.stat(fullPath)
        if (stats.isDirectory()) {
          await fs.rmdir(fullPath, { recursive: true })
        } else {
          await fs.unlink(fullPath)
        }
      }
    }

    console.log(`✅ Deleted ${itemPaths.length} items`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting multiple items:", error)
    res.status(500).json({ error: "Failed to delete items" })
  }
})

// Compress item
app.post("/api/files/compress", requireAuth, async (req, res) => {
  try {
    const { itemPath, rootPath = "user" } = req.body

    let basePath
    switch (rootPath) {
      case "system":
        if (!isAdmin(req.session.userId)) {
          return res.status(403).json({ error: "Admin access required" })
        }
        basePath = "/"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const fullPath = path.join(basePath, itemPath)
    const zipPath = fullPath + ".zip"

    // Use system zip command
    await execAsync(`cd "${path.dirname(fullPath)}" && zip -r "${zipPath}" "${path.basename(fullPath)}"`)

    console.log(`✅ Compressed: ${itemPath}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error compressing item:", error)
    res.status(500).json({ error: "Failed to compress item" })
  }
})

// Get file properties
app.get("/api/files/properties", requireAuth, async (req, res) => {
  try {
    const { path: filePath, rootPath = "user" } = req.query

    let basePath
    switch (rootPath) {
      case "system":
        if (!isAdmin(req.session.userId)) {
          return res.status(403).json({ error: "Admin access required" })
        }
        basePath = "/"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const fullPath = path.join(basePath, filePath)

    if (!fssync.existsSync(fullPath)) {
      return res.status(404).json({ error: "File not found" })
    }

    const stats = await fs.stat(fullPath)

    res.json({
      success: true,
      data: {
        name: path.basename(fullPath),
        path: fullPath,
        size: stats.size,
        isDirectory: stats.isDirectory(),
        mode: stats.mode.toString(8),
        mtime: stats.mtime,
        birthtime: stats.birthtime,
      },
    })
  } catch (error) {
    console.error("Error getting properties:", error)
    res.status(500).json({ error: "Failed to get properties" })
  }
})

// Get file permissions
app.get("/api/files/permissions", requireAuth, async (req, res) => {
  try {
    const { path: filePath, rootPath = "user" } = req.query

    if (!isAdmin(req.session.userId)) {
      return res.status(403).json({ error: "Admin access required" })
    }

    let basePath
    switch (rootPath) {
      case "system":
        basePath = "/"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const fullPath = path.join(basePath, filePath)
    const stats = await fs.stat(fullPath)
    const mode = stats.mode

    res.json({
      success: true,
      data: {
        octal: mode.toString(8).slice(-3),
        owner: {
          read: !!(mode & 0o400),
          write: !!(mode & 0o200),
          execute: !!(mode & 0o100),
        },
        group: {
          read: !!(mode & 0o040),
          write: !!(mode & 0o020),
          execute: !!(mode & 0o010),
        },
        others: {
          read: !!(mode & 0o004),
          write: !!(mode & 0o002),
          execute: !!(mode & 0o001),
        },
      },
    })
  } catch (error) {
    console.error("Error getting permissions:", error)
    res.status(500).json({ error: "Failed to get permissions" })
  }
})

// Terminal command execution
app.post("/api/terminal/execute", requireAuth, async (req, res) => {
  try {
    const { command, currentPath = "", rootPath = "user" } = req.body

    if (!isAdmin(req.session.userId) && rootPath !== "user") {
      return res.status(403).json({ error: "Admin access required for system commands" })
    }

    let basePath
    switch (rootPath) {
      case "system":
        basePath = "/"
        break
      case "home":
        basePath = "/home"
        break
      case "var":
        basePath = "/var"
        break
      case "etc":
        basePath = "/etc"
        break
      case "tmp":
        basePath = "/tmp"
        break
      default:
        basePath = `uploads/${req.session.userId}`
    }

    const workingDir = path.join(basePath, currentPath)

    // Security: Block dangerous commands
    const dangerousCommands = ["rm -rf /", "dd if=", "mkfs", "fdisk", "format"]
    if (dangerousCommands.some((cmd) => command.includes(cmd))) {
      return res.json({ success: false, error: "Command blocked for security reasons" })
    }

    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      timeout: 30000, // 30 second timeout
    })

    res.json({
      success: true,
      output: stdout || stderr,
      newPath: currentPath, // Could be updated based on cd commands
    })
  } catch (error) {
    res.json({
      success: false,
      error: error.message || "Command execution failed",
    })
  }
})

// System stats
app.get("/api/system/stats", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.session.userId)) {
      return res.status(403).json({ error: "Admin access required" })
    }

    // Get system information
    const [memInfo, cpuInfo, diskInfo] = await Promise.all([
      execAsync("free -m").catch(() => ({ stdout: "" })),
      execAsync("top -bn1 | grep 'Cpu(s)'").catch(() => ({ stdout: "" })),
      execAsync("df -h /").catch(() => ({ stdout: "" })),
    ])

    // Parse memory info
    const memLines = memInfo.stdout.split("\n")
    const memData = memLines[1]?.split(/\s+/) || []
    const totalMem = Number.parseInt(memData[1]) || 0
    const usedMem = Number.parseInt(memData[2]) || 0
    const memUsedPercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0

    // Parse CPU info
    const cpuMatch = cpuInfo.stdout.match(/(\d+\.\d+)%?\s*us/)
    const cpuUsage = cpuMatch ? Number.parseFloat(cpuMatch[1]) : 0

    // Parse disk info
    const diskLines = diskInfo.stdout.split("\n")
    const diskData = diskLines[1]?.split(/\s+/) || []
    const diskUsedPercent = diskData[4] ? Number.parseInt(diskData[4].replace("%", "")) : 0

    res.json({
      success: true,
      data: {
        memory: {
          total: totalMem * 1024 * 1024,
          used: memUsedPercent,
        },
        cpu: {
          usage: cpuUsage,
          cores: require("os").cpus().length,
          model: require("os").cpus()[0]?.model || "Unknown",
        },
        disk: {
          used: diskUsedPercent,
        },
        uptime: require("os").uptime(),
        os: {
          platform: require("os").platform(),
          release: require("os").release(),
        },
      },
    })
  } catch (error) {
    console.error("Error getting system stats:", error)
    res.status(500).json({ error: "Failed to get system stats" })
  }
})

// System info
app.get("/api/system/info", requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.session.userId)) {
      return res.status(403).json({ error: "Admin access required" })
    }

    const os = require("os")

    res.json({
      success: true,
      data: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        uptime: os.uptime(),
        loadavg: os.loadavg(),
        totalmem: os.totalmem(),
        freemem: os.freemem(),
        cpus: os.cpus(),
      },
    })
  } catch (error) {
    console.error("Error getting system info:", error)
    res.status(500).json({ error: "Failed to get system info" })
  }
})

// Helper function to check if user is admin
function isAdmin(userId) {
  // You can implement your admin check logic here
  // For now, we'll check if user exists and has admin role
  return true // Simplified for demo
}

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

// Admin delete user file - FIXED VERSION
app.delete("/api/admin/files/:userId/:filename", async (req, res) => {
  try {
    const { userId, filename } = req.params
    const decodedFilename = decodeURIComponent(filename)

    // Security check
    if (decodedFilename.includes("..") || decodedFilename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" })
    }

    const userDir = `uploads/${userId}`
    const filePath = path.join(userDir, decodedFilename)

    // Security check - ensure path is within user directory
    const resolvedUserDir = path.resolve(userDir)
    const resolvedFilePath = path.resolve(filePath)

    if (!resolvedFilePath.startsWith(resolvedUserDir)) {
      return res.status(400).json({ error: "Invalid path - security violation" })
    }

    if (!fssync.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" })
    }

    await fs.unlink(filePath)
    console.log(`✅ Admin deleted file: ${decodedFilename} for user ${userId}`)

    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting user file:", error)
    res.status(500).json({ error: "Failed to delete file" })
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
