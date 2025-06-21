let userData = null
let maxFileSize = 100 * 1024 * 1024 // 100MB default
let currentEditingFile = null
let currentPath = ""
const selectedItems = new Set()
let currentView = "grid"

// Initialize dashboard
document.addEventListener("DOMContentLoaded", () => {
  initializeSidebar()
  loadUserData()
  setupFileManager()
  setupFileEditor()
})

// Sidebar functionality
function initializeSidebar() {
  const sidebarToggle = document.getElementById("sidebarToggle")
  const sidebar = document.getElementById("sidebar")
  const navItems = document.querySelectorAll(".nav-item")

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      sidebar.classList.toggle("active")
    })
  }

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault()
      const section = item.dataset.section
      switchSection(section)

      navItems.forEach((nav) => nav.classList.remove("active"))
      item.classList.add("active")

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
    filemanager: "File Manager",
    editor: "File Editor",
    nginx: "Server Configuration",
    settings: "Account Settings",
  }

  sectionTitle.textContent = titles[section] || "Dashboard"

  // Load file manager when switching to it
  if (section === "filemanager") {
    loadFileManager()
  }
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
    document.getElementById("accountCreated").textContent = new Date(userData.createdAt).toLocaleDateString()

    if (userData.fileLimit) {
      maxFileSize = userData.fileLimit * 1024 * 1024
      document.getElementById("maxFileSize").textContent = `${userData.fileLimit}MB`
      document.getElementById("userFileLimit").textContent = `${userData.fileLimit}MB`
    }

    renderDomains()
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
    domainsList.innerHTML = '<p class="no-data">No domains added yet. Add your first domain above!</p>'
    return
  }

  domainsList.innerHTML = userData.domains
    .map(
      (domain) => `
        <div class="domain-item">
            <div class="domain-info">
                <h3>${domain.domain}</h3>
                <span class="ssl-status ${domain.sslEnabled ? "ssl-enabled" : "ssl-disabled"}">
                    ${domain.sslEnabled ? "🔒 SSL Enabled" : "🔓 SSL Disabled"}
                </span>
            </div>
            <div class="domain-actions">
                ${!domain.sslEnabled ? `<button onclick="enableSSL('${domain.domain}')" class="btn btn-success btn-small">🔒 Enable SSL</button>` : ""}
                <button onclick="deleteDomain('${domain.domain}')" class="btn btn-danger btn-small">🗑️ Delete</button>
            </div>
        </div>
    `,
    )
    .join("")
}

// Domain management functions
document.getElementById("addDomainBtn").addEventListener("click", async () => {
  const domain = document.getElementById("domainInput").value.trim()

  if (!domain) {
    showMessage("Please enter a domain name", "error")
    return
  }

  if (userData.domains.length >= 2) {
    showMessage("Maximum 2 domains allowed per account", "error")
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
      showMessage("Domain added successfully! 🎉", "success")
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

async function deleteDomain(domain) {
  if (!confirm(`Are you sure you want to delete ${domain}? This action cannot be undone.`)) {
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

async function enableSSL(domain) {
  try {
    showProcessing(true)
    showMessage("Generating SSL certificate... This may take a few minutes ⏳", "info")

    const response = await fetch(`/api/ssl/${encodeURIComponent(domain)}`, {
      method: "POST",
    })

    const result = await response.json()

    if (result.success) {
      showMessage("SSL certificate generated successfully! 🔒", "success")
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

// File Manager Setup
function setupFileManager() {
  // Upload button
  document.getElementById("uploadFilesBtn").addEventListener("click", () => {
    document.getElementById("fileUploadArea").style.display = "block"
  })

  // Cancel upload
  document.getElementById("cancelUploadBtn").addEventListener("click", () => {
    document.getElementById("fileUploadArea").style.display = "none"
    document.getElementById("fileInput").value = ""
  })

  // Create folder button
  document.getElementById("createFolderBtn").addEventListener("click", () => {
    showCreateModal("folder")
  })

  // Create file button
  document.getElementById("createFileBtn").addEventListener("click", () => {
    showCreateModal("file")
  })

  // File upload area
  const fileUploadArea = document.getElementById("fileUploadArea")
  const fileInput = document.getElementById("fileInput")

  fileUploadArea.addEventListener("click", (e) => {
    if (e.target === fileUploadArea || e.target.closest(".upload-text")) {
      fileInput.click()
    }
  })

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

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      fileInput.files = createFileList(files)
      showMessage(`${files.length} file(s) selected for upload`, "info")
    }
  })

  // Upload button
  document.getElementById("uploadBtn").addEventListener("click", uploadFiles)

  // View toggle
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"))
      btn.classList.add("active")
      currentView = btn.dataset.view
      updateFileGridView()
    })
  })

  // Sort options
  document.getElementById("sortBy").addEventListener("change", loadFileManager)

  // Context menu
  setupContextMenu()
}

// Load file manager
async function loadFileManager(path = currentPath) {
  try {
    showProcessing(true)
    const response = await fetch(`/api/files/browse?path=${encodeURIComponent(path)}`)
    const data = await response.json()

    currentPath = data.currentPath
    renderBreadcrumb()
    renderFileGrid(data.folders, data.files)
  } catch (error) {
    console.error("Error loading file manager:", error)
    showMessage("Failed to load files", "error")
  } finally {
    showProcessing(false)
  }
}

// Render breadcrumb
function renderBreadcrumb() {
  const breadcrumb = document.getElementById("breadcrumb")
  const pathParts = currentPath ? currentPath.split("/") : []

  let html = '<span class="breadcrumb-item" data-path="">🏠 Home</span>'

  let buildPath = ""
  pathParts.forEach((part) => {
    if (part) {
      buildPath += (buildPath ? "/" : "") + part
      html += `<span class="breadcrumb-item" data-path="${buildPath}">📁 ${part}</span>`
    }
  })

  breadcrumb.innerHTML = html

  // Add click handlers
  breadcrumb.querySelectorAll(".breadcrumb-item").forEach((item) => {
    item.addEventListener("click", () => {
      const path = item.dataset.path
      loadFileManager(path)
    })
  })
}

// Render file grid
function renderFileGrid(folders, files) {
  const grid = document.getElementById("fileManagerGrid")
  const sortBy = document.getElementById("sortBy").value

  // Sort items
  const sortedFolders = [...folders].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name)
      case "modified":
        return new Date(b.modified) - new Date(a.modified)
      default:
        return a.name.localeCompare(b.name)
    }
  })

  const sortedFiles = [...files].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name)
      case "modified":
        return new Date(b.modified) - new Date(a.modified)
      case "size":
        return b.size - a.size
      case "type":
        return a.extension.localeCompare(b.extension)
      default:
        return a.name.localeCompare(b.name)
    }
  })

  const allItems = [...sortedFolders, ...sortedFiles]

  if (allItems.length === 0) {
    grid.innerHTML =
      '<div class="no-data">This folder is empty. Upload files or create new folders to get started!</div>'
    return
  }

  grid.innerHTML = allItems
    .map((item) => {
      const isFolder = item.type === "folder"
      const fileType = isFolder ? "folder" : getFileType(item.extension)
      const size = isFolder ? "" : formatFileSize(item.size)
      const date = new Date(item.modified).toLocaleDateString()

      return `
      <div class="file-item ${isFolder ? "folder-item" : ""}" 
           data-type="${fileType}" 
           data-path="${item.path}"
           data-name="${item.name}"
           data-is-folder="${isFolder}">
        <div class="file-icon"></div>
        <div class="file-info">
          <div class="file-name">${item.name}</div>
          <div class="file-meta">
            ${size ? `<span class="file-size">${size}</span>` : ""}
            <span class="file-date">${date}</span>
          </div>
        </div>
      </div>
    `
    })
    .join("")

  updateFileGridView()

  // Add click handlers
  grid.querySelectorAll(".file-item").forEach((item) => {
    item.addEventListener("click", handleFileClick)
    item.addEventListener("dblclick", handleFileDoubleClick)
    item.addEventListener("contextmenu", handleContextMenu)
  })
}

// Update file grid view
function updateFileGridView() {
  const grid = document.getElementById("fileManagerGrid")
  grid.className = `file-grid ${currentView === "list" ? "list-view" : ""}`
}

// Handle file click
function handleFileClick(e) {
  const item = e.currentTarget
  const isCtrlClick = e.ctrlKey || e.metaKey

  if (!isCtrlClick) {
    // Clear previous selections
    document.querySelectorAll(".file-item.selected").forEach((el) => {
      el.classList.remove("selected")
    })
    selectedItems.clear()
  }

  item.classList.toggle("selected")
  const path = item.dataset.path

  if (item.classList.contains("selected")) {
    selectedItems.add(path)
  } else {
    selectedItems.delete(path)
  }
}

// Handle file double click
function handleFileDoubleClick(e) {
  const item = e.currentTarget
  const isFolder = item.dataset.isFolder === "true"
  const path = item.dataset.path

  if (isFolder) {
    loadFileManager(path)
  } else {
    editFile(path)
  }
}

// Get file type for icon
function getFileType(extension) {
  const ext = extension.toLowerCase()

  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp"].includes(ext)) return "image"
  if ([".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm"].includes(ext)) return "video"
  if ([".mp3", ".wav", ".flac", ".aac", ".ogg"].includes(ext)) return "audio"
  if (ext === ".pdf") return "pdf"
  if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) return "zip"
  if (ext === ".html") return "html"
  if (ext === ".css") return "css"
  if (ext === ".js") return "js"
  if (ext === ".json") return "json"
  if ([".txt", ".log"].includes(ext)) return "txt"
  if ([".md", ".markdown"].includes(ext)) return "md"

  return "default"
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

// Create file list
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
  files.forEach((file) => formData.append("files", file))
  formData.append("folderPath", currentPath)

  try {
    showProcessing(true)
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    })

    const result = await response.json()

    if (result.success) {
      showMessage(`${files.length} file(s) uploaded successfully! 📁`, "success")
      fileInput.value = ""
      document.getElementById("fileUploadArea").style.display = "none"
      loadFileManager()
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

// Show create modal
function showCreateModal(type) {
  const modal = document.getElementById("createModal")
  const title = document.getElementById("createModalTitle")
  const label = document.getElementById("itemNameLabel")
  const input = document.getElementById("itemName")

  title.textContent = type === "folder" ? "Create New Folder" : "Create New File"
  label.textContent = type === "folder" ? "Folder Name" : "File Name"
  input.placeholder = type === "folder" ? "Enter folder name" : "Enter file name (e.g., index.html)"
  input.value = ""

  modal.classList.add("active")
  modal.dataset.type = type
  input.focus()
}

// Close create modal
function closeCreateModal() {
  document.getElementById("createModal").classList.remove("active")
}

// Handle create form
document.getElementById("createForm").addEventListener("submit", async (e) => {
  e.preventDefault()

  const modal = document.getElementById("createModal")
  const type = modal.dataset.type
  const name = document.getElementById("itemName").value.trim()

  if (!name) {
    showMessage("Please enter a name", "error")
    return
  }

  try {
    showProcessing(true)

    const endpoint = type === "folder" ? "/api/files/folder" : "/api/files/create"
    const body = type === "folder" ? { folderName: name, currentPath } : { fileName: name, currentPath, content: "" }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    const result = await response.json()

    if (result.success) {
      showMessage(`${type === "folder" ? "Folder" : "File"} created successfully! 🎉`, "success")
      closeCreateModal()
      loadFileManager()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error(`Error creating ${type}:`, error)
    showMessage(`Failed to create ${type}`, "error")
  } finally {
    showProcessing(false)
  }
})

// Context menu setup
function setupContextMenu() {
  const contextMenu = document.getElementById("contextMenu")

  document.addEventListener("click", () => {
    contextMenu.classList.remove("active")
  })

  contextMenu.addEventListener("click", (e) => {
    e.stopPropagation()
    const action = e.target.dataset.action
    if (action) {
      handleContextAction(action)
      contextMenu.classList.remove("active")
    }
  })
}

// Handle context menu
function handleContextMenu(e) {
  e.preventDefault()
  const contextMenu = document.getElementById("contextMenu")
  const item = e.currentTarget

  // Store current item for context actions
  contextMenu.dataset.currentItem = item.dataset.path
  contextMenu.dataset.currentName = item.dataset.name
  contextMenu.dataset.isFolder = item.dataset.isFolder

  // Position context menu
  contextMenu.style.left = e.pageX + "px"
  contextMenu.style.top = e.pageY + "px"
  contextMenu.classList.add("active")
}

// Handle context actions
function handleContextAction(action) {
  const contextMenu = document.getElementById("contextMenu")
  const itemPath = contextMenu.dataset.currentItem
  const itemName = contextMenu.dataset.currentName
  const isFolder = contextMenu.dataset.isFolder === "true"

  switch (action) {
    case "open":
      if (isFolder) {
        loadFileManager(itemPath)
      } else {
        editFile(itemPath)
      }
      break
    case "edit":
      if (!isFolder) {
        editFile(itemPath)
      }
      break
    case "rename":
      showRenameModal(itemPath, itemName)
      break
    case "delete":
      deleteItem(itemPath, itemName)
      break
    case "download":
      if (!isFolder) {
        downloadFile(itemPath)
      }
      break
  }
}

// Show rename modal
function showRenameModal(itemPath, currentName) {
  const modal = document.getElementById("renameModal")
  const input = document.getElementById("newItemName")

  input.value = currentName
  modal.classList.add("active")
  modal.dataset.itemPath = itemPath
  input.focus()
  input.select()
}

// Close rename modal
function closeRenameModal() {
  document.getElementById("renameModal").classList.remove("active")
}

// Handle rename form
document.getElementById("renameForm").addEventListener("submit", async (e) => {
  e.preventDefault()

  const modal = document.getElementById("renameModal")
  const itemPath = modal.dataset.itemPath
  const newName = document.getElementById("newItemName").value.trim()

  if (!newName) {
    showMessage("Please enter a new name", "error")
    return
  }

  try {
    showProcessing(true)

    const response = await fetch("/api/files/rename", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPath: itemPath, newName }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Item renamed successfully! ✏️", "success")
      closeRenameModal()
      loadFileManager()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error renaming item:", error)
    showMessage("Failed to rename item", "error")
  } finally {
    showProcessing(false)
  }
})

// Delete item
async function deleteItem(itemPath, itemName) {
  if (!confirm(`Are you sure you want to delete "${itemName}"? This action cannot be undone.`)) {
    return
  }

  try {
    showProcessing(true)

    const response = await fetch("/api/files/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemPath }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Item deleted successfully! 🗑️", "success")

      // Close editor if this file was being edited
      if (currentEditingFile === itemPath) {
        closeEditor()
      }

      loadFileManager()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error deleting item:", error)
    showMessage("Failed to delete item", "error")
  } finally {
    showProcessing(false)
  }
}

// Download file
function downloadFile(filePath) {
  const link = document.createElement("a")
  link.href = `/uploads/${userData._id}/${filePath}`
  link.download = filePath.split("/").pop()
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// File Editor Setup
function setupFileEditor() {
  document.getElementById("saveFileBtn").addEventListener("click", saveFile)
  document.getElementById("saveAsBtn").addEventListener("click", saveAsFile)
  document.getElementById("closeEditorBtn").addEventListener("click", closeEditor)
}

// Edit file
async function editFile(filePath) {
  try {
    showProcessing(true)
    const response = await fetch(`/api/files/${encodeURIComponent(filePath)}/content`)

    if (!response.ok) {
      throw new Error("Failed to load file content")
    }

    const content = await response.text()

    // Switch to editor section
    switchSection("editor")
    document.querySelector('[data-section="editor"]').classList.add("active")
    document.querySelectorAll(".nav-item").forEach((nav) => nav.classList.remove("active"))
    document.querySelector('[data-section="editor"]').classList.add("active")

    // Show editor and populate content
    document.getElementById("fileEditor").style.display = "block"
    document.getElementById("editorPlaceholder").style.display = "none"
    document.getElementById("editorTitle").textContent = filePath.split("/").pop()
    document.getElementById("codeEditor").value = content

    currentEditingFile = filePath
    showMessage(`File ${filePath.split("/").pop()} loaded for editing ✏️`, "info")
  } catch (error) {
    console.error("Error loading file for editing:", error)
    showMessage("Failed to load file for editing", "error")
  } finally {
    showProcessing(false)
  }
}

// Save file
async function saveFile() {
  if (!currentEditingFile) {
    showMessage("No file is currently being edited", "error")
    return
  }

  try {
    showProcessing(true)
    const content = document.getElementById("codeEditor").value

    const response = await fetch(`/api/files/${encodeURIComponent(currentEditingFile)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("File saved successfully! 💾", "success")
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error saving file:", error)
    showMessage("Failed to save file", "error")
  } finally {
    showProcessing(false)
  }
}

// Save as file
async function saveAsFile() {
  const newName = prompt(
    "Enter new file name:",
    currentEditingFile ? currentEditingFile.split("/").pop() : "new-file.txt",
  )

  if (!newName) return

  try {
    showProcessing(true)
    const content = document.getElementById("codeEditor").value
    const filePath = currentPath ? `${currentPath}/${newName}` : newName

    const response = await fetch("/api/files/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: newName, currentPath, content }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage(`File saved as ${newName}! 💾`, "success")
      currentEditingFile = filePath
      document.getElementById("editorTitle").textContent = newName
      loadFileManager() // Refresh file manager
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error saving file as:", error)
    showMessage("Failed to save file", "error")
  } finally {
    showProcessing(false)
  }
}

// Close editor
function closeEditor() {
  document.getElementById("fileEditor").style.display = "none"
  document.getElementById("editorPlaceholder").style.display = "block"
  document.getElementById("codeEditor").value = ""
  currentEditingFile = null
  showMessage("Editor closed", "info")
}

// Logout
document.getElementById("logoutBtn").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" })
    showMessage("Logged out successfully", "success")
    setTimeout(() => {
      window.location.href = "/"
    }, 1000)
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

// Auto-save functionality for editor
let autoSaveTimeout
document.getElementById("codeEditor").addEventListener("input", () => {
  if (currentEditingFile) {
    clearTimeout(autoSaveTimeout)
    autoSaveTimeout = setTimeout(() => {
      saveFile()
    }, 3000) // Auto-save after 3 seconds of inactivity
  }
})

// Close modals when clicking outside
window.addEventListener("click", (e) => {
  const modals = document.querySelectorAll(".modal")
  modals.forEach((modal) => {
    if (e.target === modal) {
      modal.classList.remove("active")
    }
  })
})

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  // Ctrl+S to save
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault()
    if (currentEditingFile) {
      saveFile()
    }
  }

  // Escape to close modals
  if (e.key === "Escape") {
    document.querySelectorAll(".modal.active").forEach((modal) => {
      modal.classList.remove("active")
    })
    document.getElementById("contextMenu").classList.remove("active")
  }

  // Delete key to delete selected items
  if (e.key === "Delete" && selectedItems.size > 0) {
    const itemsArray = Array.from(selectedItems)
    if (itemsArray.length === 1) {
      const itemPath = itemsArray[0]
      const itemName = itemPath.split("/").pop()
      deleteItem(itemPath, itemName)
    } else if (itemsArray.length > 1) {
      if (
        confirm(`Are you sure you want to delete ${itemsArray.length} selected items? This action cannot be undone.`)
      ) {
        deleteMultipleItems(itemsArray)
      }
    }
  }

  // F2 to rename selected item
  if (e.key === "F2" && selectedItems.size === 1) {
    const itemPath = Array.from(selectedItems)[0]
    const itemName = itemPath.split("/").pop()
    showRenameModal(itemPath, itemName)
  }
})

// Delete multiple items
async function deleteMultipleItems(itemPaths) {
  try {
    showProcessing(true)

    for (const itemPath of itemPaths) {
      const response = await fetch("/api/files/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemPath }),
      })

      if (!response.ok) {
        console.error(`Failed to delete ${itemPath}`)
      }
    }

    showMessage(`${itemPaths.length} items deleted successfully! 🗑️`, "success")
    selectedItems.clear()
    loadFileManager()
  } catch (error) {
    console.error("Error deleting multiple items:", error)
    showMessage("Failed to delete some items", "error")
  } finally {
    showProcessing(false)
  }
}
