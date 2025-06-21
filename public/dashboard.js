let userData = null
let maxFileSize = 50 * 1024 * 1024 // 50MB default

// Initialize dashboard
document.addEventListener("DOMContentLoaded", () => {
  initializeSidebar()
  loadUserData()
  setupFileUpload()
})

// Sidebar functionality
function initializeSidebar() {
  const sidebarToggle = document.getElementById("sidebarToggle")
  const sidebar = document.getElementById("sidebar")
  const navItems = document.querySelectorAll(".nav-item")

  // Toggle sidebar on mobile
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      sidebar.classList.toggle("active")
    })
  }

  // Handle navigation
  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault()
      const section = item.dataset.section
      switchSection(section)

      // Update active nav item
      navItems.forEach((nav) => nav.classList.remove("active"))
      item.classList.add("active")

      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove("active")
      }
    })
  })
}

// Switch content sections
function switchSection(section) {
  const sections = document.querySelectorAll(".content-section")
  const sectionTitle = document.getElementById("sectionTitle")

  sections.forEach((s) => s.classList.remove("active"))
  document.getElementById(`${section}-section`).classList.add("active")

  const titles = {
    domains: "Domain Management",
    files: "File Management",
    nginx: "Nginx Configuration",
    settings: "Account Settings",
  }

  sectionTitle.textContent = titles[section] || "Dashboard"
}

// Show processing indicator
function showProcessing(show = true) {
  const indicator = document.getElementById("processingIndicator")
  if (show) {
    indicator.classList.add("active")
  } else {
    indicator.classList.remove("active")
  }
}

// Load user data
async function loadUserData() {
  try {
    showProcessing(true)
    const response = await fetch("/api/user")

    if (!response.ok) {
      throw new Error("Failed to load user data")
    }

    userData = await response.json()

    document.getElementById("welcomeUser").textContent = `Welcome, ${userData.username}!`
    document.getElementById("settingsUsername").textContent = userData.username
    document.getElementById("settingsEmail").textContent = userData.email
    document.getElementById("domainsCount").textContent = userData.domains.length

    // Update file limit
    if (userData.fileLimit) {
      maxFileSize = userData.fileLimit * 1024 * 1024
      document.getElementById("maxFileSize").textContent = `${userData.fileLimit}MB`
      document.getElementById("userFileLimit").textContent = `${userData.fileLimit}MB`
    }

    renderDomains()
    loadFiles()
  } catch (error) {
    console.error("Error loading user data:", error)
    showMessage("Failed to load user data", "error")
  } finally {
    showProcessing(false)
  }
}

// Render domains
function renderDomains() {
  const domainsList = document.getElementById("domainsList")

  if (userData.domains.length === 0) {
    domainsList.innerHTML = '<p class="no-data">No domains added yet</p>'
    return
  }

  domainsList.innerHTML = userData.domains
    .map(
      (domain) => `
        <div class="domain-item">
            <div class="domain-info">
                <h3>${domain.domain}</h3>
                <span class="ssl-status ${domain.sslEnabled ? "ssl-enabled" : "ssl-disabled"}">
                    ${domain.sslEnabled ? "SSL Enabled" : "SSL Disabled"}
                </span>
            </div>
            <div class="domain-actions">
                ${!domain.sslEnabled ? `<button onclick="enableSSL('${domain.domain}')" class="btn btn-small btn-primary">Enable SSL</button>` : ""}
                <button onclick="deleteDomain('${domain.domain}')" class="btn btn-danger btn-small">Delete</button>
            </div>
        </div>
    `,
    )
    .join("")
}

// Add domain
document.getElementById("addDomainBtn").addEventListener("click", async () => {
  const domain = document.getElementById("domainInput").value.trim()

  if (!domain) {
    showMessage("Please enter a domain name", "error")
    return
  }

  if (userData.domains.length >= 2) {
    showMessage("Maximum 2 domains allowed", "error")
    return
  }

  try {
    showProcessing(true)
    const response = await fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Domain added successfully", "success")
      document.getElementById("domainInput").value = ""
      await loadUserData()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error adding domain:", error)
    showMessage("Failed to add domain", "error")
  } finally {
    showProcessing(false)
  }
})

// Delete domain
async function deleteDomain(domain) {
  if (!confirm(`Are you sure you want to delete ${domain}?`)) {
    return
  }

  try {
    showProcessing(true)
    const response = await fetch(`/api/domains/${encodeURIComponent(domain)}`, {
      method: "DELETE",
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Domain deleted successfully", "success")
      await loadUserData()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error deleting domain:", error)
    showMessage("Failed to delete domain", "error")
  } finally {
    showProcessing(false)
  }
}

// Enable SSL
async function enableSSL(domain) {
  try {
    showProcessing(true)
    showMessage("Generating SSL certificate... This may take a few minutes", "success")

    const response = await fetch(`/api/ssl/${encodeURIComponent(domain)}`, {
      method: "POST",
    })

    const result = await response.json()

    if (result.success) {
      showMessage("SSL certificate generated successfully", "success")
      await loadUserData()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error enabling SSL:", error)
    showMessage("Failed to enable SSL", "error")
  } finally {
    showProcessing(false)
  }
}

// File upload setup
function setupFileUpload() {
  const fileUploadArea = document.getElementById("fileUploadArea")
  const fileInput = document.getElementById("fileInput")
  const uploadBtn = document.getElementById("uploadBtn")

  // Click to upload
  fileUploadArea.addEventListener("click", () => {
    fileInput.click()
  })

  // Drag and drop
  fileUploadArea.addEventListener("dragover", (e) => {
    e.preventDefault()
    fileUploadArea.classList.add("dragover")
  })

  fileUploadArea.addEventListener("dragleave", () => {
    fileUploadArea.classList.remove("dragover")
  })

  fileUploadArea.addEventListener("drop", (e) => {
    e.preventDefault()
    fileUploadArea.classList.remove("dragover")

    const files = Array.from(e.dataTransfer.files).filter(
      (file) => file.type === "text/html" || file.name.endsWith(".html"),
    )

    if (files.length > 0) {
      fileInput.files = createFileList(files)
    }
  })

  // Upload button
  uploadBtn.addEventListener("click", uploadFiles)
}

// Create FileList from array
function createFileList(files) {
  const dt = new DataTransfer()
  files.forEach((file) => dt.items.add(file))
  return dt.files
}

// Upload files
async function uploadFiles() {
  const fileInput = document.getElementById("fileInput")
  const files = Array.from(fileInput.files)

  if (files.length === 0) {
    showMessage("Please select files to upload", "error")
    return
  }

  // Check file sizes
  for (const file of files) {
    if (file.size > maxFileSize) {
      showMessage(`File ${file.name} exceeds the ${maxFileSize / (1024 * 1024)}MB limit`, "error")
      return
    }
  }

  const formData = new FormData()
  files.forEach((file) => formData.append("htmlFiles", file))

  try {
    showProcessing(true)
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Files uploaded successfully", "success")
      fileInput.value = ""
      await loadFiles()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error uploading files:", error)
    showMessage("Failed to upload files", "error")
  } finally {
    showProcessing(false)
  }
}

// Load files
async function loadFiles() {
  try {
    const response = await fetch("/api/files")
    const files = await response.json()

    const filesList = document.getElementById("filesList")

    if (files.length === 0) {
      filesList.innerHTML = '<p class="no-data">No files uploaded yet</p>'
      return
    }

    filesList.innerHTML = files
      .map(
        (file) => `
            <div class="file-item">
                <span class="file-name">${file}</span>
                <button onclick="deleteFile('${file}')" class="btn btn-danger btn-small">Delete</button>
            </div>
        `,
      )
      .join("")
  } catch (error) {
    console.error("Error loading files:", error)
  }
}

// Delete file
async function deleteFile(filename) {
  if (!confirm(`Are you sure you want to delete ${filename}?`)) {
    return
  }

  try {
    showProcessing(true)
    const response = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    })

    const result = await response.json()

    if (result.success) {
      showMessage("File deleted successfully", "success")
      await loadFiles()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error deleting file:", error)
    showMessage("Failed to delete file", "error")
  } finally {
    showProcessing(false)
  }
}

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" })
    window.location.href = "/"
  } catch (error) {
    console.error("Error logging out:", error)
    showMessage("Failed to logout", "error")
  }
})

// Show message
function showMessage(text, type) {
  const messageDiv = document.getElementById("message")
  messageDiv.innerHTML = `<div class="${type}">${text}</div>`
  setTimeout(() => {
    messageDiv.innerHTML = ""
  }, 5000)
}

// Handle window resize
window.addEventListener("resize", () => {
  const sidebar = document.getElementById("sidebar")
  if (window.innerWidth > 768) {
    sidebar.classList.remove("active")
  }
})
