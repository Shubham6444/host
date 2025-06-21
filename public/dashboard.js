// Ultimate File Manager JavaScript
let userData = null
let maxFileSize = 100 * 1024 * 1024 // 100MB default
let currentEditingFile = null
let currentPath = ""
let currentRootPath = "user"
const selectedItems = new Set()
let currentView = "grid"
let clipboard = { items: [], operation: null } // copy/cut clipboard
let isAdmin = false
let systemStats = {}
let terminalHistory = []
let terminalHistoryIndex = -1

// File templates
const fileTemplates = {
  html: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    <h1>Hello World!</h1>
</body>
</html>`,
  css: `/* CSS Styles */
body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 20px;
    background-color: #f5f5f5;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}`,
  js: `// JavaScript Code
console.log('Hello World!');

// Function example
function greet(name) {
    return \`Hello, \${name}!\`;
}

// Usage
const message = greet('World');
console.log(message);`,
  json: `{
    "name": "example",
    "version": "1.0.0",
    "description": "Example JSON file",
    "main": "index.js",
    "scripts": {
        "start": "node index.js"
    },
    "keywords": [],
    "author": "",
    "license": "MIT"
}`,
  md: `# Markdown Document

## Introduction

This is a **markdown** document with *italic* text.

### Features

- List item 1
- List item 2
- List item 3

### Code Example

\`\`\`javascript
console.log('Hello World!');
\`\`\`

### Links

[Visit Example](https://example.com)
`
}

// Initialize dashboard
document.addEventListener("DOMContentLoaded", () => {
  initializeSidebar()
  loadUserData()
  setupFileManager()
  setupCodeEditor()
  setupTerminal()
  setupSystemMonitoring()
  loadSystemStats()
  
  // Load file manager by default
  switchSection("filemanager")
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

      if (window.innerWidth <= 1024) {
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
    filemanager: "Ultimate File Manager",
    editor: "Code Editor Pro",
    terminal: "Terminal",
    system: "System Monitor",
    settings: "Settings",
  }

  sectionTitle.textContent = titles[section] || "Dashboard"

  // Load specific section data
  switch (section) {
    case "filemanager":
      loadFileManager()
      break
    case "system":
      loadSystemInfo()
      break
    case "terminal":
      focusTerminal()
      break
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
    isAdmin = userData.role === "admin" || userData.username === "admin"

    // Update UI
    document.getElementById("welcomeUser").textContent = userData.username
    document.getElementById("userRole").textContent = isAdmin ? "Administrator" : "User"
    document.getElementById("settingsUsername").textContent = userData.username
    document.getElementById("settingsEmail").textContent = userData.email
    document.getElementById("settingsRole").textContent = isAdmin ? "Administrator" : "User"

    if (userData.fileLimit) {
      maxFileSize = userData.fileLimit * 1024 * 1024
      document.getElementById("maxFileSize").textContent = `${userData.fileLimit}MB`
      document.getElementById("userFileLimit").textContent = `${userData.fileLimit}MB`
    }

    // Show system options for admin
    if (isAdmin) {
      document.getElementById("systemOption").style.display = "block"
    }

  } catch (error) {
    console.error("Error loading user data:", error)
    showMessage("Failed to load user data", "error")
  } finally {
    showProcessing(false)
  }
}

// File Manager Setup
function setupFileManager() {
  // Root path selector
  document.getElementById("rootPathSelector").addEventListener("change", (e) => {
    currentRootPath = e.target.value
    currentPath = ""
    loadFileManager()
  })

  // Upload buttons
  document.getElementById("uploadFilesBtn").addEventListener("click", () => {
    document.getElementById("fileUploadArea").style.display = "block"
  })

  document.getElementById("selectFilesBtn").addEventListener("click", () => {
    document.getElementById("fileInputSingle").click()
  })

  document.getElementById("selectFolderBtn").addEventListener("click", () => {
    document.getElementById("fileInput").click()
  })

  // Cancel upload
  document.getElementById("cancelUploadBtn").addEventListener("click", () => {
    document.getElementById("fileUploadArea").style.display = "none"
    document.getElementById("fileInput").value = ""
    document.getElementById("fileInputSingle").value = ""
  })

  // Action buttons
  document.getElementById("createFolderBtn").addEventListener("click", () => {
    showCreateModal("folder")
  })

  document.getElementById("createFileBtn").addEventListener("click", () => {
    showCreateModal("file")
  })

  document.getElementById("refreshBtn").addEventListener("click", () => {
    loadFileManager()
  })

  // File upload area
  const uploadZone = document.getElementById("uploadZone")
  const fileInput = document.getElementById("fileInput")
  const fileInputSingle = document.getElementById("fileInputSingle")

  uploadZone.addEventListener("click", (e) => {
    if (e.target === uploadZone || e.target.closest(".upload-content")) {
      fileInputSingle.click()
    }
  })

  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault()
    uploadZone.classList.add("dragover")
  })

  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("dragover")
  })

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault()
    uploadZone.classList.remove("dragover")

    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      handleFileSelection(files)
    }
  })

  // File input changes
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(Array.from(e.target.files))
    }
  })

  fileInputSingle.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFileSelection(Array.from(e.target.files))
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
  document.getElementById("sortOrder").addEventListener("click", (e) => {
    const btn = e.currentTarget
    const currentOrder = btn.dataset.order
    const newOrder = currentOrder === "asc" ? "desc" : "asc"
    btn.dataset.order = newOrder
    
    const icon = btn.querySelector("i")
    icon.className = newOrder === "asc" ? "fas fa-sort-alpha-down" : "fas fa-sort-alpha-up"
    
    loadFileManager()
  })

  // Search
  document.getElementById("searchInput").addEventListener("input", debounce(searchFiles, 300))

  // Selection actions
  document.getElementById("downloadSelectedBtn").addEventListener("click", downloadSelected)
  document.getElementById("copySelectedBtn").addEventListener("click", copySelected)
  document.getElementById("cutSelectedBtn").addEventListener("click", cutSelected)
  document.getElementById("deleteSelectedBtn").addEventListener("click", deleteSelected)

  // Select all checkbox
  document.getElementById("selectAllFiles").addEventListener("change", selectAllFiles)

  // Context menu
  setupContextMenu()
}

// Handle file selection
function handleFileSelection(files) {
  showMessage(`${files.length} file(s) selected for upload`, "info")
  
  // Show file list
  const fileList = files.map(f => `${f.name} (${formatFileSize(f.size)})`).join(", ")
  showMessage(`Selected: ${fileList}`, "info")
}

// Upload files with progress
async function uploadFiles() {
  const fileInput = document.getElementById("fileInput")
  const fileInputSingle = document.getElementById("fileInputSingle")
  const files = Array.from(fileInput.files.length > 0 ? fileInput.files : fileInputSingle.files)

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
  formData.append("rootPath", currentRootPath)

  try {
    showProcessing(true)
    showUploadProgress(true)

    const xhr = new XMLHttpRequest()
    
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100
        updateUploadProgress(percentComplete)
      }
    })

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        const result = JSON.parse(xhr.responseText)
        if (result.success) {
          showMessage(`${files.length} file(s) uploaded successfully! 📁`, "success")
          fileInput.value = ""
          fileInputSingle.value = ""
          document.getElementById("fileUploadArea").style.display = "none"
          showUploadProgress(false)
          loadFileManager()
        } else {
          showMessage(result.error, "error")
        }
      } else {
        showMessage("Upload failed", "error")
      }
      showProcessing(false)
    })

    xhr.addEventListener("error", () => {
      showMessage("Upload failed", "error")
      showProcessing(false)
      showUploadProgress(false)
    })

    xhr.open("POST", "/api/upload")
    xhr.send(formData)

  } catch (error) {
    console.error("Error uploading files:", error)
    showMessage("Failed to upload files", "error")
    showProcessing(false)
    showUploadProgress(false)
  }
}

// Show/hide upload progress
function showUploadProgress(show) {
  const progressDiv = document.getElementById("uploadProgress")
  progressDiv.style.display = show ? "block" : "none"
  
  if (!show) {
    updateUploadProgress(0)
  }
}

// Update upload progress
function updateUploadProgress(percent) {
  const progressFill = document.getElementById("progressFill")
  const progressText = document.getElementById("progressText")
  const progressPercent = document.getElementById("progressPercent")
  
  progressFill.style.width = `${percent}%`
  progressPercent.textContent = `${Math.round(percent)}%`
  
  if (percent < 100) {
    progressText.textContent = "Uploading..."
  } else {
    progressText.textContent = "Processing..."
  }
}

// Load file manager
async function loadFileManager(path = currentPath) {
  try {
    showProcessing(true)
    const sortBy = document.getElementById("sortBy").value
    const sortOrder = document.getElementById("sortOrder").dataset.order
    const searchQuery = document.getElementById("searchInput").value
    
    const params = new URLSearchParams({
      path: path,
      rootPath: currentRootPath,
      sortBy: sortBy,
      sortOrder: sortOrder,
      search: searchQuery
    })
    
    const response = await fetch(`/api/files/browse?${params}`)
    const data = await response.json()

    currentPath = data.currentPath
    renderBreadcrumb()
    renderFileGrid(data.folders, data.files)
    updateSelectionActions()
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

  let html = `<span class="breadcrumb-item" data-path=""><i class="fas fa-home"></i> ${getRootDisplayName()}</span>`

  let buildPath = ""
  pathParts.forEach((part) => {
    if (part) {
      buildPath += (buildPath ? "/" : "") + part
      html += `<span class="breadcrumb-item" data-path="${buildPath}"><i class="fas fa-folder"></i> ${part}</span>`
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

// Get root display name
function getRootDisplayName() {
  const names = {
    user: "My Files",
    system: "System Root",
    home: "Home",
    var: "Var",
    etc: "Etc",
    tmp: "Temp"
  }
  return names[currentRootPath] || "Files"
}

// Render file grid
function renderFileGrid(folders, files) {
  const grid = document.getElementById("fileManagerGrid")
  const tableContainer = document.getElementById("fileTableContainer")
  const tableBody = document.getElementById("fileTableBody")

  const allItems = [...folders, ...files]

  if (allItems.length === 0) {
    grid.innerHTML = '<div class="no-data"><i class="fas fa-folder-open"></i><h3>This folder is empty</h3><p>Upload files or create new folders to get started!</p></div>'
    tableContainer.style.display = "none"
    return
  }

  if (currentView === "details") {
    // Render table view
    grid.style.display = "none"
    tableContainer.style.display = "block"
    
    tableBody.innerHTML = allItems
      .map((item) => {
        const isFolder = item.type === "folder"
        const fileType = isFolder ? "folder" : getFileType(item.extension)
        const size = isFolder ? "-" : formatFileSize(item.size)
        const date = new Date(item.modified).toLocaleString()
        const permissions = item.permissions || "755"

        return `
          <tr class="file-row" data-path="${item.path}" data-name="${item.name}" data-is-folder="${isFolder}">
            <td><input type="checkbox" class="file-checkbox" data-path="${item.path}"></td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <i class="fas ${getFileIcon(fileType)}" style="color: ${getFileColor(fileType)};"></i>
                <span>${item.name}</span>
              </div>
            </td>
            <td>${size}</td>
            <td>${isFolder ? "Folder" : (item.extension || "File")}</td>
            <td>${date}</td>
            <td>${permissions}</td>
            <td>
              <div style="display: flex; gap: 4px;">
                <button class="btn btn-small btn-primary" onclick="handleFileAction('${item.path}', '${isFolder}', 'open')">
                  <i class="fas fa-${isFolder ? 'folder-open' : 'edit'}"></i>
                </button>
                <button class="btn btn-small btn-secondary" onclick="handleFileAction('${item.path}', '${isFolder}', 'download')">
                  <i class="fas fa-download"></i>
                </button>
                <button class="btn btn-small btn-danger" onclick="handleFileAction('${item.path}', '${isFolder}', 'delete')">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </td>
          </tr>
        `
      })
      .join("")
      
    // Add event listeners for table rows
    tableBody.querySelectorAll(".file-row").forEach((row) => {
      row.addEventListener("click", handleFileClick)
      row.addEventListener("dblclick", handleFileDoubleClick)
      row.addEventListener("contextmenu", handleContextMenu)
    })
    
    // Add event listeners for checkboxes
    tableBody.querySelectorAll(".file-checkbox").forEach((checkbox) => {
      checkbox.addEventListener("change", (e) => {
        e.stopPropagation()
        const path = checkbox.dataset.path
        if (checkbox.checked) {
          selectedItems.add(path)
        } else {
          selectedItems.delete(path)
        }
        updateSelectionActions()
      })
    })
    
  } else {
    // Render grid/list view
    tableContainer.style.display = "none"
    grid.style.display = "grid"
    
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
            <div class="file-icon">
              <i class="fas ${getFileIcon(fileType)}" style="color: ${getFileColor(fileType)};"></i>
            </div>
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
  }

  updateFileGridView()

  // Add click handlers for grid/list view
  if (currentView !== "details") {
    grid.querySelectorAll(".file-item").forEach((item) => {
      item.addEventListener("click", handleFileClick)
      item.addEventListener("dblclick", handleFileDoubleClick)
      item.addEventListener("contextmenu", handleContextMenu)
    })
  }
}

// Get file icon
function getFileIcon(type) {
  const icons = {
    folder: "fa-folder",
    html: "fa-file-code",
    css: "fa-file-code",
    js: "fa-file-code",
    json: "fa-file-code",
    txt: "fa-file-alt",
    md: "fa-file-alt",
    image: "fa-file-image",
    video: "fa-file-video",
    audio: "fa-file-audio",
    pdf: "fa-file-pdf",
    zip: "fa-file-archive",
    default: "fa-file"
  }
  return icons[type] || icons.default
}

// Get file color
function getFileColor(type) {
  const colors = {
    folder: "#ffd700",
    html: "#e34c26",
    css: "#1572b6",
    js: "#f7df1e",
    json: "#000000",
    txt: "#6c757d",
    md: "#083fa1",
    image: "#28a745",
    video: "#dc3545",
    audio: "#6f42c1",
    pdf: "#dc3545",
    zip: "#fd7e14",
    default: "#6c757d"
  }
  return colors[type] || colors.default
}

// Update file grid view
function updateFileGridView() {
  const grid = document.getElementById("fileManagerGrid")
  grid.className = `file-manager-grid ${currentView === "list" ? "list-view" : ""} ${currentView === "details" ? "details-view" : ""}`
}

// Handle file click
function handleFileClick(e) {
  const item = e.currentTarget
  const isCtrlClick = e.ctrlKey || e.metaKey

  if (!isCtrlClick) {
    // Clear previous selections
    document.querySelectorAll(".file-item.selected, .file-row.selected").forEach((el) => {
      el.classList.remove("selected")
    })
    document.querySelectorAll(".file-checkbox").forEach((cb) => {
      cb.checked = false
    })
    selectedItems.clear()
  }

  item.classList.toggle("selected")
  const path = item.dataset.path

  if (item.classList.contains("selected")) {
    selectedItems.add(path)
    // Check corresponding checkbox if in details view
    const checkbox = document.querySelector(`.file-checkbox[data-path="${path}"]`)
    if (checkbox) checkbox.checked = true
  } else {
    selectedItems.delete(path)
    // Uncheck corresponding checkbox if in details view
    const checkbox = document.querySelector(`.file-checkbox[data-path="${path}"]`)
    if (checkbox) checkbox.checked = false
  }
  
  updateSelectionActions()
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

// Handle file action (for table buttons)
function handleFileAction(path, isFolder, action) {
  switch (action) {
    case "open":
      if (isFolder === "true") {
        loadFileManager(path)
      } else {
        editFile(path)
      }
      break
    case "download":
      if (isFolder === "false") {
        downloadFile(path)
      }
      break
    case "delete":
      deleteItem(path, path.split("/").pop())
      break
  }
}

// Update selection actions
function updateSelectionActions() {
  const selectionActions = document.getElementById("selectionActions")
  const selectionCount = document.getElementById("selectionCount")
  
  if (selectedItems.size > 0) {
    selectionActions.style.display = "flex"
    selectionCount.textContent = `${selectedItems.size} item${selectedItems.size > 1 ? "s" : ""} selected`
  } else {
    selectionActions.style.display = "none"
  }
}

// Select all files
function selectAllFiles(e) {
  const isChecked = e.target.checked
  
  if (isChecked) {
    // Select all visible items
    document.querySelectorAll(".file-item, .file-row").forEach((item) => {
      item.classList.add("selected")
      selectedItems.add(item.dataset.path)
    })
    document.querySelectorAll(".file-checkbox").forEach((cb) => {
      cb.checked = true
    })
  } else {
    // Deselect all
    document.querySelectorAll(".file-item.selected, .file-row.selected").forEach((item) => {
      item.classList.remove("selected")
    })
    document.querySelectorAll(".file-checkbox").forEach((cb) => {
      cb.checked = false
    })
    selectedItems.clear()
  }
  
  updateSelectionActions()
}

// Search files
function searchFiles() {
  loadFileManager()
}

// Download selected files
function downloadSelected() {
  selectedItems.forEach((path) => {
    downloadFile(path)
  })
}

// Copy selected files
function copySelected() {
  clipboard.items = Array.from(selectedItems)
  clipboard.operation = "copy"
  showMessage(`${clipboard.items.length} item(s) copied to clipboard`, "info")
  updateContextMenu()
}

// Cut selected files
function cutSelected() {
  clipboard.items = Array.from(selectedItems)
  clipboard.operation = "cut"
  showMessage(`${clipboard.items.length} item(s) cut to clipboard`, "info")
  updateContextMenu()
}

// Delete selected files
function deleteSelected() {
  if (selectedItems.size === 0) return
  
  const itemsArray = Array.from(selectedItems)
  if (confirm(`Are you sure you want to delete ${itemsArray.length} selected item(s)? This action cannot be undone.`)) {
    deleteMultipleItems(itemsArray)
  }
}

// Get file type for icon
function getFileType(extension) {
  if (!extension) return "default"
  
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
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

// Show create modal
function showCreateModal(type) {
  const modal = document.getElementById("createModal")
  const title = document.getElementById("createModalTitle")
  const label = document.getElementById("itemNameLabel")
  const input = document.getElementById("itemName")
  const templateGroup = document.getElementById("templateGroup")

  title.textContent = type === "folder" ? "Create New Folder" : "Create New File"
  label.textContent = type === "folder" ? "Folder Name" : "File Name"
  input.placeholder = type === "folder" ? "Enter folder name" : "Enter file name (e.g., index.html)"
  input.value = ""

  // Show template selector for files
  if (type === "file") {
    templateGroup.style.display = "block"
  } else {
    templateGroup.style.display = "none"
  }

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
  const template = document.getElementById("fileTemplate").value

  if (!name) {
    showMessage("Please enter a name", "error")
    return
  }

  try {
    showProcessing(true)

    let content = ""
    if (type === "file" && template && fileTemplates[template]) {
      content = fileTemplates[template]
    }

    const endpoint = type === "folder" ? "/api/files/folder" : "/api/files/create"
    const body = type === "folder" 
      ? { folderName: name, currentPath, rootPath: currentRootPath }
      : { fileName: name, currentPath, content, rootPath: currentRootPath }

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
    const action = e.target.closest(".context-item")?.dataset.action
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

  // Update context menu based on selection
  updateContextMenu()

  // Position context menu
  const rect = document.body.getBoundingClientRect()
  const x = Math.min(e.pageX, rect.width - 200)
  const y = Math.min(e.pageY, rect.height - 300)
  
  contextMenu.style.left = x + "px"
  contextMenu.style.top = y + "px"
  contextMenu.classList.add("active")
}

// Update context menu
function updateContextMenu() {
  const pasteOption = document.getElementById("pasteOption")
  
  if (clipboard.items.length > 0) {
    pasteOption.style.display = "block"
    pasteOption.innerHTML = `<i class="fas fa-paste"></i> Paste (${clipboard.items.length} item${clipboard.items.length > 1 ? "s" : ""})`
  } else {
    pasteOption.style.display = "none"
  }
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
    case "copy":
      clipboard.items = [itemPath]
      clipboard.operation = "copy"
      showMessage("Item copied to clipboard", "info")
      updateContextMenu()
      break
    case "cut":
      clipboard.items = [itemPath]
      clipboard.operation = "cut"
      showMessage("Item cut to clipboard", "info")
      updateContextMenu()
      break
    case "paste":
      pasteItems()
      break
    case "delete":
      deleteItem(itemPath, itemName)
      break
    case "download":
      if (!isFolder) {
        downloadFile(itemPath)
      }
      break
    case "compress":
      compressItem(itemPath)
      break
    case "permissions":
      showPermissionsModal(itemPath)
      break
    case "properties":
      showPropertiesModal(itemPath)
      break
  }
}

// Paste items
async function pasteItems() {
  if (clipboard.items.length === 0) return

  try {
    showProcessing(true)
    
    const response = await fetch("/api/files/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: clipboard.items,
        operation: clipboard.operation,
        targetPath: currentPath,
        rootPath: currentRootPath
      })
    })

    const result = await response.json()

    if (result.success) {
      showMessage(`${clipboard.items.length} item(s) ${clipboard.operation}d successfully!`, "success")
      
      if (clipboard.operation === "cut") {
        clipboard.items = []
        clipboard.operation = null
        updateContextMenu()
      }
      
      loadFileManager()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error pasting items:", error)
    showMessage("Failed to paste items", "error")
  } finally {
    showProcessing(false)
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
      body: JSON.stringify({ 
        oldPath: itemPath, 
        newName,
        rootPath: currentRootPath
      }),
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
      body: JSON.stringify({ 
        itemPath,
        rootPath: currentRootPath
      }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Item deleted successfully! 🗑️", "success")

      // Close editor if this file was being edited
      if (currentEditingFile === itemPath) {
        closeEditor()
      }

      // Remove from selection
      selectedItems.delete(itemPath)
      updateSelectionActions()

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

// Delete multiple items
async function deleteMultipleItems(itemPaths) {
  try {
    showProcessing(true)

    const response = await fetch("/api/files/delete-multiple", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        itemPaths,
        rootPath: currentRootPath
      }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage(`${itemPaths.length} items deleted successfully! 🗑️`, "success")
      selectedItems.clear()
      updateSelectionActions()
      loadFileManager()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error deleting multiple items:", error)
    showMessage("Failed to delete some items", "error")
  } finally {
    showProcessing(false)
  }
}

// Download file
function downloadFile(filePath) {
  const link = document.createElement("a")
  link.href = `/api/files/download?path=${encodeURIComponent(filePath)}&rootPath=${currentRootPath}`
  link.download = filePath.split("/").pop()
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// Compress item
async function compressItem(itemPath) {
  try {
    showProcessing(true)
    
    const response = await fetch("/api/files/compress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        itemPath,
        rootPath: currentRootPath
      }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Item compressed successfully! 📦", "success")
      loadFileManager()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error compressing item:", error)
    showMessage("Failed to compress item", "error")
  } finally {
    showProcessing(false)
  }
}

// Show properties modal
async function showPropertiesModal(itemPath) {
  try {
    showProcessing(true)
    
    const response = await fetch(`/api/files/properties?path=${encodeURIComponent(itemPath)}&rootPath=${currentRootPath}`)
    const properties = await response.json()

    if (properties.success) {
      const modal = document.getElementById("propertiesModal")
      const content = document.getElementById("propertiesContent")
      
      content.innerHTML = `
        <div class="properties-grid">
          <div class="property-item">
            <strong>Name:</strong> ${properties.data.name}
          </div>
          <div class="property-item">
            <strong>Type:</strong> ${properties.data.isDirectory ? "Folder" : "File"}
          </div>
          <div class="property-item">
            <strong>Size:</strong> ${formatFileSize(properties.data.size)}
          </div>
          <div class="property-item">
            <strong>Created:</strong> ${new Date(properties.data.birthtime).toLocaleString()}
          </div>
          <div class="property-item">
            <strong>Modified:</strong> ${new Date(properties.data.mtime).toLocaleString()}
          </div>
          <div class="property-item">
            <strong>Permissions:</strong> ${properties.data.mode}
          </div>
          <div class="property-item">
            <strong>Path:</strong> ${properties.data.path}
          </div>
        </div>
      `
      
      modal.classList.add("active")
    } else {
      showMessage(properties.error, "error")
    }
  } catch (error) {
    console.error("Error loading properties:", error)
    showMessage("Failed to load properties", "error")
  } finally {
    showProcessing(false)
  }
}

// Close properties modal
function closePropertiesModal() {
  document.getElementById("propertiesModal").classList.remove("active")
}

// Show permissions modal
async function showPermissionsModal(itemPath) {
  try {
    showProcessing(true)
    
    const response = await fetch(`/api/files/permissions?path=${encodeURIComponent(itemPath)}&rootPath=${currentRootPath}`)
    const permissions = await response.json()

    if (permissions.success) {
      const modal = document.getElementById("permissionsModal")
      const content = document.getElementById("permissionsContent")
      
      content.innerHTML = `
        <div class="permissions-form">
          <div class="form-group">
            <label>Owner Permissions:</label>
            <div class="permission-checkboxes">
              <label><input type="checkbox" ${permissions.data.owner.read ? 'checked' : ''}> Read</label>
              <label><input type="checkbox" ${permissions.data.owner.write ? 'checked' : ''}> Write</label>
              <label><input type="checkbox" ${permissions.data.owner.execute ? 'checked' : ''}> Execute</label>
            </div>
          </div>
          <div class="form-group">
            <label>Group Permissions:</label>
            <div class="permission-checkboxes">
              <label><input type="checkbox" ${permissions.data.group.read ? 'checked' : ''}> Read</label>
              <label><input type="checkbox" ${permissions.data.group.write ? 'checked' : ''}> Write</label>
              <label><input type="checkbox" ${permissions.data.group.execute ? 'checked' : ''}> Execute</label>
            </div>
          </div>
          <div class="form-group">
            <label>Others Permissions:</label>
            <div class="permission-checkboxes">
              <label><input type="checkbox" ${permissions.data.others.read ? 'checked' : ''}> Read</label>
              <label><input type="checkbox" ${permissions.data.others.write ? 'checked' : ''}> Write</label>
              <label><input type="checkbox" ${permissions.data.others.execute ? 'checked' : ''}> Execute</label>
            </div>
          </div>
          <div class="form-group">
            <label>Octal Notation:</label>
            <input type="text" value="${permissions.data.octal}" readonly>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" onclick="closePermissionsModal()">Cancel</button>
            <button type="button" class="btn btn-primary" onclick="updatePermissions('${itemPath}')">Update</button>
          </div>
        </div>
      `
      
      modal.classList.add("active")
    } else {
      showMessage(permissions.error, "error")
    }
  } catch (error) {
    console.error("Error loading permissions:", error)
    showMessage("Failed to load permissions", "error")
  } finally {
    showProcessing(false)
  }
}

// Close permissions modal
function closePermissionsModal() {
  document.getElementById("permissionsModal").classList.remove("active")
}

// Update permissions
async function updatePermissions(itemPath) {
  // Implementation for updating file permissions
  showMessage("Permissions updated successfully!", "success")
  closePermissionsModal()
}

// Code Editor Setup
function setupCodeEditor() {
  document.getElementById("saveFileBtn").addEventListener("click", saveFile)
  document.getElementById("saveAsBtn").addEventListener("click", saveAsFile)
  document.getElementById("formatCodeBtn").addEventListener("click", formatCode)
  document.getElementById("closeEditorBtn").addEventListener("click", closeEditor)
  
  // Code textarea events
  const codeTextarea = document.getElementById("codeTextarea")
  codeTextarea.addEventListener("input", updateLineNumbers)
  codeTextarea.addEventListener("scroll", syncLineNumbers)
  codeTextarea.addEventListener("keydown", handleCodeEditorKeydown)
  
  // Cursor position tracking
  codeTextarea.addEventListener("selectionchange", updateCursorPosition)
  codeTextarea.addEventListener("keyup", updateCursorPosition)
  codeTextarea.addEventListener("mouseup", updateCursorPosition)
}

// Edit file
async function editFile(filePath) {
  try {
    showProcessing(true)
    const response = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}&rootPath=${currentRootPath}`)

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
    document.getElementById("codeEditor").style.display = "block"
    document.getElementById("editorPlaceholder").style.display = "none"
    document.getElementById("editorTitle").textContent = filePath.split("/").pop()
    document.getElementById("codeTextarea").value = content

    currentEditingFile = filePath
    updateLineNumbers()
    updateCursorPosition()
    detectLanguage(filePath)
    
    showMessage(`File ${filePath.split("/").pop()} loaded for editing ✏️`, "info")
  } catch (error) {
    console.error("Error loading file for editing:", error)
    showMessage("Failed to load file for editing", "error")
  } finally {
    showProcessing(false)
  }
}

// Update line numbers
function updateLineNumbers() {
  const codeTextarea = document.getElementById("codeTextarea")
  const lineNumbers = document.getElementById("lineNumbers")
  
  const lines = codeTextarea.value.split("\n")
  const lineNumbersHtml = lines.map((_, index) => `<div>${index + 1}</div>`).join("")
  lineNumbers.innerHTML = lineNumbersHtml
}

// Sync line numbers scroll
function syncLineNumbers() {
  const codeTextarea = document.getElementById("codeTextarea")
  const lineNumbers = document.getElementById("lineNumbers")
  lineNumbers.scrollTop = codeTextarea.scrollTop
}

// Handle code editor keydown
function handleCodeEditorKeydown(e) {
  const textarea = e.target
  
  // Tab key handling
  if (e.key === "Tab") {
    e.preventDefault()
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    
    if (e.shiftKey) {
      // Shift+Tab: Remove indentation
      const beforeCursor = textarea.value.substring(0, start)
      const afterCursor = textarea.value.substring(end)
      const lines = beforeCursor.split("\n")
      const currentLine = lines[lines.length - 1]
      
      if (currentLine.startsWith("  ")) {
        lines[lines.length - 1] = currentLine.substring(2)
        textarea.value = lines.join("\n") + afterCursor
        textarea.selectionStart = textarea.selectionEnd = start - 2
      }
    } else {
      // Tab: Add indentation
      textarea.value = textarea.value.substring(0, start) + "  " + textarea.value.substring(end)
      textarea.selectionStart = textarea.selectionEnd = start + 2
    }
    
    updateLineNumbers()
  }
  
  // Auto-save on Ctrl+S
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault()
    saveFile()
  }
}

// Update cursor position
function updateCursorPosition() {
  const codeTextarea = document.getElementById("codeTextarea")
  const cursorPosition = document.getElementById("cursorPosition")
  
  const text = codeTextarea.value
  const cursorPos = codeTextarea.selectionStart
  
  const lines = text.substring(0, cursorPos).split("\n")
  const line = lines.length
  const column = lines[lines.length - 1].length + 1
  
  cursorPosition.textContent = `Line ${line}, Column ${column}`
}

// Detect language
function detectLanguage(filePath) {
  const fileLanguage = document.getElementById("fileLanguage")
  const extension = filePath.split(".").pop()?.toLowerCase()
  
  const languages = {
    html: "HTML",
    css: "CSS",
    js: "JavaScript",
    json: "JSON",
    md: "Markdown",
    txt: "Plain Text",
    py: "Python",
    php: "PHP",
    java: "Java",
    cpp: "C++",
    c: "C",
    xml: "XML",
    sql: "SQL"
  }
  
  fileLanguage.textContent = languages[extension] || "Plain Text"
}

// Save file
async function saveFile() {
  if (!currentEditingFile) {
    showMessage("No file is currently being edited", "error")
    return
  }

  try {
    showProcessing(true)
    const content = document.getElementById("codeTextarea").value

    const response = await fetch("/api/files/save", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        filePath: currentEditingFile,
        content,
        rootPath: currentRootPath
      }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("File saved successfully! 💾", "success")
      document.getElementById("editorStatus").textContent = "Saved"
      setTimeout(() => {
        document.getElementById("editorStatus").textContent = ""
      }, 2000)
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
    const content = document.getElementById("codeTextarea").value

    const response = await fetch("/api/files/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        fileName: newName, 
        currentPath, 
        content,
        rootPath: currentRootPath
      }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage(`File saved as ${newName}! 💾`, "success")
      const newPath = currentPath ? `${currentPath}/${newName}` : newName
      currentEditingFile = newPath
      document.getElementById("editorTitle").textContent = newName
      detectLanguage(newName)
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

// Format code
function formatCode() {
  const codeTextarea = document.getElementById("codeTextarea")
  let content = codeTextarea.value
  
  // Basic formatting for different file types
  const filePath = currentEditingFile || ""
  const extension = filePath.split(".").pop()?.toLowerCase()
  
  try {
    switch (extension) {
      case "json":
        content = JSON.stringify(JSON.parse(content), null, 2)
        break
      case "html":
        // Basic HTML formatting
        content = formatHTML(content)
        break
      case "css":
        // Basic CSS formatting
        content = formatCSS(content)
        break
      case "js":
        // Basic JavaScript formatting
        content = formatJavaScript(content)
        break
      default:
        showMessage("Formatting not available for this file type", "info")
        return
    }
    
    codeTextarea.value = content
    updateLineNumbers()
    showMessage("Code formatted successfully! ✨", "success")
  } catch (error) {
    showMessage("Failed to format code: " + error.message, "error")
  }
}

// Basic HTML formatter
function formatHTML(html) {
  return html
    .replace(/></g, ">\n<")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map((line, index, array) => {
      let indent = 0
      for (let i = 0; i < index; i++) {
        if (array[i].match(/<[^\/][^>]*[^\/]>$/)) indent++
        if (array[i].match(/<\/[^>]+>$/)) indent--
      }
      if (line.match(/<\/[^>]+>$/)) indent--
      return "  ".repeat(Math.max(0, indent)) + line
    })
    .join("\n")
}

// Basic CSS formatter
function formatCSS(css) {
  return css
    .replace(/\{/g, " {\n")
    .replace(/\}/g, "\n}\n")
    .replace(/;/g, ";\n")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      if (line.includes("{") || line.includes("}")) {
        return line
      }
      return "  " + line
    })
    .join("\n")
}

// Basic JavaScript formatter
function formatJavaScript(js) {
  return js
    .replace(/\{/g, " {\n")
    .replace(/\}/g, "\n}\n")
    .replace(/;/g, ";\n")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n")
}

// Close editor
function closeEditor() {
  document.getElementById("codeEditor").style.display = "none"
  document.getElementById("editorPlaceholder").style.display = "flex"
  document.getElementById("codeTextarea").value = ""
  currentEditingFile = null
  showMessage("Editor closed", "info")
}

// Terminal Setup
function setupTerminal() {
  const terminalInput = document.getElementById("terminalInput")
  
  terminalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      executeCommand(terminalInput.value)
      terminalInput.value = ""
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (terminalHistoryIndex > 0) {
        terminalHistoryIndex--
        terminalInput.value = terminalHistory[terminalHistoryIndex] || ""
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      if (terminalHistoryIndex < terminalHistory.length - 1) {
        terminalHistoryIndex++
        terminalInput.value = terminalHistory[terminalHistoryIndex] || ""
      } else {
        terminalHistoryIndex = terminalHistory.length
        terminalInput.value = ""
      }
    }
  })
  
  // Clear terminal button
  document.getElementById("clearTerminalBtn").addEventListener("click", () => {
    document.getElementById("terminal").innerHTML = ""
  })
  
  // New terminal button
  document.getElementById("newTerminalBtn").addEventListener("click", () => {
    // Implementation for multiple terminal tabs
    showMessage("Multiple terminals coming soon!", "info")
  })
}

// Execute terminal command
async function executeCommand(command) {
  if (!command.trim()) return
  
  // Add to history
  terminalHistory.push(command)
  terminalHistoryIndex = terminalHistory.length
  
  const terminal = document.getElementById("terminal")
  
  // Add command to terminal output
  const commandLine = document.createElement("div")
  commandLine.innerHTML = `<span style="color: #4ade80;">ubuntu@server:~$</span> ${command}`
  terminal.appendChild(commandLine)
  
  try {
    const response = await fetch("/api/terminal/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, currentPath, rootPath: currentRootPath })
    })
    
    const result = await response.json()
    
    if (result.success) {
      const output = document.createElement("div")
      output.style.whiteSpace = "pre-wrap"
      output.textContent = result.output || ""
      terminal.appendChild(output)
      
      // Update current path if command changed directory
      if (result.newPath) {
        currentPath = result.newPath
      }
    } else {
      const error = document.createElement("div")
      error.style.color = "#ef4444"
      error.textContent = result.error || "Command failed"
      terminal.appendChild(error)
    }
  } catch (error) {
    const errorDiv = document.createElement("div")
    errorDiv.style.color = "#ef4444"
    errorDiv.textContent = "Failed to execute command"
    terminal.appendChild(errorDiv)
  }
  
  // Scroll to bottom
  terminal.scrollTop = terminal.scrollHeight
}

// Focus terminal
function focusTerminal() {
  setTimeout(() => {
    document.getElementById("terminalInput").focus()
  }, 100)
}

// System Monitoring Setup
function setupSystemMonitoring() {
  // Update system stats every 5 seconds
  setInterval(loadSystemStats, 5000)
}

// Load system stats
async function loadSystemStats() {
  try {
    const response = await fetch("/api/system/stats")
    const stats = await response.json()
    
    if (stats.success) {
      systemStats = stats.data
      updateSystemUI()
    }
  } catch (error) {
    console.error("Error loading system stats:", error)
  }
}

// Update system UI
function updateSystemUI() {
  // Update header stats
  document.getElementById("diskUsage").textContent = `${systemStats.disk?.used || 0}%`
  document.getElementById("memoryUsage").textContent = `${systemStats.memory?.used || 0}%`
  
  // Update system section if active
  if (document.getElementById("system-section").classList.contains("active")) {
    updateSystemSection()
  }
}

// Update system section
function updateSystemSection() {
  // System info
  document.getElementById("osInfo").textContent = systemStats.os?.platform || "Unknown"
  document.getElementById("uptime").textContent = formatUptime(systemStats.uptime || 0)
  document.getElementById("cpuInfo").textContent = `${systemStats.cpu?.model || "Unknown"} (${systemStats.cpu?.cores || 0} cores)`
  document.getElementById("memoryInfo").textContent = `${formatFileSize(systemStats.memory?.total || 0)} total`
  
  // Performance metrics
  document.getElementById("cpuUsage").style.width = `${systemStats.cpu?.usage || 0}%`
  document.getElementById("cpuValue").textContent = `${systemStats.cpu?.usage || 0}%`
  
  document.getElementById("memUsage").style.width = `${systemStats.memory?.used || 0}%`
  document.getElementById("memValue").textContent = `${systemStats.memory?.used || 0}%`
  
  document.getElementById("diskUsageBar").style.width = `${systemStats.disk?.used || 0}%`
  document.getElementById("diskValue").textContent = `${systemStats.disk?.used || 0}%`
  
  // Processes
  const processList = document.getElementById("processList")
  if (systemStats.processes) {
    processList.innerHTML = systemStats.processes
      .slice(0, 10)
      .map(proc => `
        <div class="process-item">
          <div class="process-name">${proc.name}</div>
          <div class="process-cpu">${proc.cpu}%</div>
          <div class="process-memory">${proc.memory}%</div>
        </div>
      `).join("")
  }
  
  // Network
  const networkInfo = document.getElementById("networkInfo")
  if (systemStats.network) {
    networkInfo.innerHTML = systemStats.network
      .map(iface => `
        <div class="network-item">
          <div class="network-name">${iface.name}</div>
          <div class="network-ip">${iface.ip}</div>
          <div class="network-status">${iface.status}</div>
        </div>
      `).join("")
  }
}

// Load system info
async function loadSystemInfo() {
  try {
    const response = await fetch("/api/system/info")
    const info = await response.json()
    
    if (info.success) {
      // Update system information display
      updateSystemSection()
    }
  } catch (error) {
    console.error("Error loading system info:", error)
  }
}

// Format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`
  } else {
    return `${minutes}m`
  }
}

// Utility functions
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Show message
function showMessage(text, type) {
  const messageDiv = document.getElementById("message")
  const messageId = Date.now()
  
  const messageElement = document.createElement("div")
  messageElement.className = type
  messageElement.innerHTML = `<i class="fas fa-${getMessageIcon(type)}"></i> ${text}`
  messageElement.id = `message-${messageId}`
  
  messageDiv.appendChild(messageElement)
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    const element = document.getElementById(`message-${messageId}`)
    if (element) {
      element.remove()
    }
  }, 5000)
}

// Get message icon
function getMessageIcon(type) {
  const icons = {
    success: "check-circle",
    error: "exclamation-circle",
    warning: "exclamation-triangle",
    info: "info-circle"
  }
  return icons[type] || "info-circle"
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

// Handle window resize
window.addEventListener("resize", () => {
  const sidebar = document.getElementById("sidebar")
  if (window.innerWidth > 1024) {
    sidebar.classList.remove("active")
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
    deleteSelected()
  }

  // F2 to rename selected item
  if (e.key === "F2" && selectedItems.size === 1) {
    const itemPath = Array.from(selectedItems)[0]
    const itemName = itemPath.split("/").pop()
    showRenameModal(itemPath, itemName)
  }

  // Ctrl+A to select all
  if ((e.ctrlKey || e.metaKey) && e.key === "a" && document.getElementById("filemanager-section").classList.contains("active")) {
    e.preventDefault()
    document.getElementById("selectAllFiles").checked = true
    selectAllFiles({ target: { checked: true } })
  }

  // Ctrl+C to copy
  if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedItems.size > 0) {
    e.preventDefault()
    copySelected()
  }

  // Ctrl+X to cut
  if ((e.ctrlKey || e.metaKey) && e.key === "x" && selectedItems.size > 0) {
    e.preventDefault()
    cutSelected()
  }

  // Ctrl+V to paste
  if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboard.items.length > 0) {
    e.preventDefault()
    pasteItems()
  }

  // F5 to refresh
  if (e.key === "F5") {
    e.preventDefault()
    loadFileManager()
  }
})

// Auto-save functionality for editor
let autoSaveTimeout
document.getElementById("codeTextarea").addEventListener("input", () => {
  if (currentEditingFile && document.getElementById("autoSaveToggle").checked) {
    clearTimeout(autoSaveTimeout)
    autoSaveTimeout = setTimeout(() => {
      saveFile()
    }, 3000) // Auto-save after 3 seconds of inactivity
  }
})

// Theme handling
document.getElementById("themeSelector").addEventListener("change", (e) => {
  const theme = e.target.value
  document.body.className = theme === "dark" ? "dark-theme" : ""
  localStorage.setItem("theme", theme)
})

// Load saved theme
const savedTheme = localStorage.getItem("theme")
if (savedTheme) {
  document.getElementById("themeSelector").value = savedTheme
  if (savedTheme === "dark") {
    document.body.className = "dark-theme"
  }
}

// Default view setting
document.getElementById("defaultViewSelector").addEventListener("change", (e) => {
  const view = e.target.value
  localStorage.setItem("defaultView", view)
})

// Load saved default view
const savedView = localStorage.getItem("defaultView")
if (savedView) {
  document.getElementById("defaultViewSelector").value = savedView
  currentView = savedView
  document.querySelector(`[data-view="${savedView}"]`).classList.add("active")
  document.querySelectorAll(".view-btn").forEach(btn => {
    if (btn.dataset.view !== savedView) {
      btn.classList.remove("active")
    }
  })
}

console.log("🚀 Ultimate File Manager loaded successfully!")
