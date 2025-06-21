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
  .connect(process.env.MONGO_URI, {
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
      mongoUrl: process.env.MONGO_URI,
      touchAfter: 24 * 3600, // lazy session update
    }),
    cookie: {
      maxAge: 86400000, // 24 hours
      secure: false, // set to true in production with HTTPS
    },
  }),
)

// Enhanced multer configuration with dynamic file size limits
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
    // Sanitize filename
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")
    cb(null, sanitizedName)
  },
})

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/html" || path.extname(file.originalname).toLowerCase() === ".html") {
      cb(null, true)
    } else {
      cb(new Error("Only HTML files are allowed"), false)
    }
  },
  limits: {
    fileSize: async (req) => {
      try {
        const user = await User.findById(req.session.userId)
        return (user?.fileLimit || 50) * 1024 * 1024 // Convert MB to bytes
      } catch {
        return 50 * 1024 * 1024 // Default 50MB
      }
    },
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

    // HTTP redirect to HTTPS
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

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/${domain}/chain.pem;

    # Modern SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    location / {
        try_files $uri $uri/ /index.html;
        
        # Cache static assets
        location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Security: Hide sensitive files
    location ~ /\.(ht|git|env) {
        deny all;
    }
    
    # Block access to backup files
    location ~ \.(bak|backup|old|tmp)$ {
        deny all;
    }
}
`
    } else {
      // Temporary HTTP server for domain verification
      config += `
server {
    listen 80;
    server_name ${domain};
    
    root ${rootDir};
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Allow Let's Encrypt verification
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

    // First, test nginx configuration
    await execAsync("sudo nginx -t")

    // Generate certificate
    const command = `sudo certbot certonly --nginx -d ${domain} --non-interactive --agree-tos --email ${email} --no-eff-email`
    const { stdout, stderr } = await execAsync(command)

    console.log(`✅ SSL certificate generated for ${domain}`)
    console.log("Certbot output:", stdout)

    return true
  } catch (error) {
    console.error(`❌ SSL generation failed for ${domain}:`, error.stderr || error.message)
    return false
  }
}

// Enhanced error handling middleware
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

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ username }, { email }],
    })

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" })
    }

    // Create user
    const hashedPassword = await bcrypt.hash(password, 12)
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
    })

    // Create user directory
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

    // Validate domain format
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

    // Check if domain is already used by another user
    const existingDomain = await User.findOne({ "domains.domain": domain })
    if (existingDomain) {
      return res.status(400).json({ error: "Domain is already in use" })
    }

    user.domains.push({ domain })
    await user.save()

    // Generate and apply Nginx configuration
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
      // Remove config files if no domains left
      await execAsync(`sudo rm -f ${configPath} ${symlinkPath}`)
    } else {
      // Update config with remaining domains
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

      // Update Nginx configuration with SSL
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
app.post("/api/upload", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId)
    const fileLimit = (user.fileLimit || 50) * 1024 * 1024 // Convert to bytes

    // Create upload middleware with dynamic file size limit
    const dynamicUpload = multer({
      storage,
      fileFilter: (req, file, cb) => {
        if (file.mimetype === "text/html" || path.extname(file.originalname).toLowerCase() === ".html") {
          cb(null, true)
        } else {
          cb(new Error("Only HTML files are allowed"), false)
        }
      },
      limits: { fileSize: fileLimit },
    }).array("htmlFiles")

    dynamicUpload(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            error: `File size exceeds ${user.fileLimit || 50}MB limit`,
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

app.delete("/api/files/:filename", requireAuth, async (req, res) => {
  try {
    const filename = decodeURIComponent(req.params.filename)
    const filePath = `uploads/${req.session.userId}/${filename}`

    // Security check: ensure filename doesn't contain path traversal
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" })
    }

    await fs.unlink(filePath)

    console.log(`✅ File deleted: ${filename} for user ${req.session.userId}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting file:", error)
    res.status(500).json({ error: "Failed to delete file" })
  }
})

// Admin routes
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await User.find({}).select("-password")

    // Add file count for each user
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

app.get("/api/admin/files", async (req, res) => {
  try {
    const users = await User.find({}).select("username")
    const allFiles = []

    for (const user of users) {
      try {
        const userDir = `uploads/${user._id}`
        if (fssync.existsSync(userDir)) {
          const files = await fs.readdir(userDir)
          const htmlFiles = files.filter((file) => path.extname(file).toLowerCase() === ".html")

          for (const file of htmlFiles) {
            const stats = await fs.stat(path.join(userDir, file))
            allFiles.push({
              filename: file,
              username: user.username,
              userId: user._id,
              size: stats.size,
              createdAt: stats.birthtime,
            })
          }
        }
      } catch (error) {
        console.error(`Error reading files for user ${user.username}:`, error)
      }
    }

    res.json(allFiles)
  } catch (error) {
    console.error("Error fetching all files:", error)
    res.status(500).json({ error: "Failed to fetch files" })
  }
})

app.get("/api/admin/domains", async (req, res) => {
  try {
    const users = await User.find({}).select("username domains")
    const allDomains = []

    users.forEach((user) => {
      user.domains.forEach((domain) => {
        allDomains.push({
          domain: domain.domain,
          username: user.username,
          userId: user._id,
          sslEnabled: domain.sslEnabled,
          createdAt: domain.createdAt,
        })
      })
    })

    res.json(allDomains)
  } catch (error) {
    console.error("Error fetching all domains:", error)
    res.status(500).json({ error: "Failed to fetch domains" })
  }
})

app.put("/api/admin/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params
    const { username, email, fileLimit } = req.body

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Check for duplicate username/email
    const existingUser = await User.findOne({
      $and: [{ _id: { $ne: userId } }, { $or: [{ username }, { email }] }],
    })

    if (existingUser) {
      return res.status(400).json({ error: "Username or email already exists" })
    }

    user.username = username
    user.email = email
    user.fileLimit = fileLimit

    await user.save()

    console.log(`✅ User updated by admin: ${username}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error updating user:", error)
    res.status(500).json({ error: "Failed to update user" })
  }
})

app.delete("/api/admin/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Remove user's nginx config
    const configPath = `/etc/nginx/sites-available/${userId}`
    const symlinkPath = `/etc/nginx/sites-enabled/${userId}`

    try {
      await execAsync(`sudo rm -f ${configPath} ${symlinkPath}`)
      await execAsync("sudo nginx -t && sudo systemctl reload nginx")
    } catch (nginxError) {
      console.error("Error removing nginx config:", nginxError)
    }

    // Remove user's files
    try {
      await fs.rmdir(`uploads/${userId}`, { recursive: true })
    } catch (fileError) {
      console.error("Error removing user files:", fileError)
    }

    // Delete user from database
    await User.findByIdAndDelete(userId)

    console.log(`✅ User deleted by admin: ${user.username}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting user:", error)
    res.status(500).json({ error: "Failed to delete user" })
  }
})

app.delete("/api/admin/files/:userId/:filename", async (req, res) => {
  try {
    const { userId, filename } = req.params
    const decodedFilename = decodeURIComponent(filename)

    // Security check
    if (decodedFilename.includes("..") || decodedFilename.includes("/") || decodedFilename.includes("\\")) {
      return res.status(400).json({ error: "Invalid filename" })
    }

    const filePath = `uploads/${userId}/${decodedFilename}`
    await fs.unlink(filePath)

    console.log(`✅ File deleted by admin: ${decodedFilename} for user ${userId}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting file:", error)
    res.status(500).json({ error: "Failed to delete file" })
  }
})

app.delete("/api/admin/domains/:userId/:domain", async (req, res) => {
  try {
    const { userId, domain } = req.params
    const decodedDomain = decodeURIComponent(domain)

    const user = await User.findById(userId)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    const domainIndex = user.domains.findIndex((d) => d.domain === decodedDomain)
    if (domainIndex === -1) {
      return res.status(404).json({ error: "Domain not found" })
    }

    user.domains.splice(domainIndex, 1)
    await user.save()

    // Update nginx configuration
    const configPath = `/etc/nginx/sites-available/${userId}`
    const symlinkPath = `/etc/nginx/sites-enabled/${userId}`

    if (user.domains.length === 0) {
      await execAsync(`sudo rm -f ${configPath} ${symlinkPath}`)
    } else {
      const updatedConfig = await generateNginxConfig(user)
      await fs.writeFile(configPath, updatedConfig)
    }

    await execAsync("sudo nginx -t && sudo systemctl reload nginx")

    console.log(`✅ Domain deleted by admin: ${decodedDomain} for user ${user.username}`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error deleting domain:", error)
    res.status(500).json({ error: "Failed to delete domain" })
  }
})

app.put("/api/admin/settings", async (req, res) => {
  try {
    const { defaultFileLimit } = req.body

    let settings = await Settings.findOne()
    if (!settings) {
      settings = new Settings({ defaultFileLimit })
    } else {
      settings.defaultFileLimit = defaultFileLimit
      settings.updatedAt = new Date()
    }

    await settings.save()

    console.log(`✅ Global settings updated: defaultFileLimit = ${defaultFileLimit}MB`)
    res.json({ success: true })
  } catch (error) {
    console.error("Error updating settings:", error)
    res.status(500).json({ error: "Failed to update settings" })
  }
})

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  })
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
