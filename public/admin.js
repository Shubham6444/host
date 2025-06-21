let allUsers = []
let allFiles = []
let allDomains = []

// Initialize admin panel
document.addEventListener("DOMContentLoaded", () => {
  initializeAdminPanel()
  loadAllData()
})

// Initialize admin panel
function initializeAdminPanel() {
  const navItems = document.querySelectorAll(".nav-item")

  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault()
      const section = item.dataset.section
      switchSection(section)

      navItems.forEach((nav) => nav.classList.remove("active"))
      item.classList.add("active")
    })
  })

  // User edit form
  document.getElementById("userEditForm").addEventListener("submit", saveUserChanges)
}

// Switch sections
function switchSection(section) {
  const sections = document.querySelectorAll(".content-section")
  const sectionTitle = document.getElementById("sectionTitle")

  sections.forEach((s) => s.classList.remove("active"))
  document.getElementById(`${section}-section`).classList.add("active")

  const titles = {
    users: "User Management",
    files: "File Management",
    domains: "Domain Management",
    system: "System Management",
  }

  sectionTitle.textContent = titles[section] || "Admin Panel"
}

// Load all data
async function loadAllData() {
  try {
    await Promise.all([loadAllUsers(), loadAllFiles(), loadAllDomains()])
    updateStats()
  } catch (error) {
    console.error("Error loading admin data:", error)
    showMessage("Failed to load admin data", "error")
  }
}

// Load all users
async function loadAllUsers() {
  try {
    const response = await fetch("/api/admin/users")
    allUsers = await response.json()
    renderUsersTable()
  } catch (error) {
    console.error("Error loading users:", error)
  }
}

// Load all files
async function loadAllFiles() {
  try {
    const response = await fetch("/api/admin/files")
    allFiles = await response.json()
    renderAllFiles()
  } catch (error) {
    console.error("Error loading files:", error)
  }
}

// Load all domains
async function loadAllDomains() {
  try {
    const response = await fetch("/api/admin/domains")
    allDomains = await response.json()
    renderAllDomains()
  } catch (error) {
    console.error("Error loading domains:", error)
  }
}

// Update stats
function updateStats() {
  document.getElementById("totalUsers").textContent = allUsers.length
  document.getElementById("totalDomains").textContent = allDomains.length
  document.getElementById("totalFiles").textContent = allFiles.length
}

// Render users table
function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody")

  tbody.innerHTML = allUsers
    .map(
      (user) => `
        <tr>
            <td>${user.username}</td>
            <td>${user.email}</td>
            <td>${user.domains.length}/2</td>
            <td>${user.fileCount || 0}</td>
            <td>${user.fileLimit || 50}MB</td>
            <td>
                <button onclick="editUser('${user._id}')" class="btn btn-small btn-primary">Edit</button>
                <button onclick="deleteUser('${user._id}')" class="btn btn-small btn-danger">Delete</button>
            </td>
        </tr>
    `,
    )
    .join("")
}

// Render all files
function renderAllFiles() {
  const filesList = document.getElementById("allFilesList")

  if (allFiles.length === 0) {
    filesList.innerHTML = '<p class="no-data">No files found</p>'
    return
  }

  filesList.innerHTML = allFiles
    .map(
      (file) => `
        <div class="file-item">
            <div class="file-info">
                <span class="file-name">${file.filename}</span>
                <span class="file-user">User: ${file.username}</span>
                <span class="file-size">${formatFileSize(file.size)}</span>
            </div>
            <button onclick="deleteUserFile('${file.userId}', '${file.filename}')" class="btn btn-danger btn-small">Delete</button>
        </div>
    `,
    )
    .join("")
}

// Render all domains
function renderAllDomains() {
  const domainsList = document.getElementById("allDomainsList")

  if (allDomains.length === 0) {
    domainsList.innerHTML = '<p class="no-data">No domains found</p>'
    return
  }

  domainsList.innerHTML = allDomains
    .map(
      (domain) => `
        <div class="domain-item">
            <div class="domain-info">
                <h3>${domain.domain}</h3>
                <span class="domain-user">User: ${domain.username}</span>
                <span class="ssl-status ${domain.sslEnabled ? "ssl-enabled" : "ssl-disabled"}">
                    ${domain.sslEnabled ? "SSL Enabled" : "SSL Disabled"}
                </span>
            </div>
            <div class="domain-actions">
                <button onclick="deleteUserDomain('${domain.userId}', '${domain.domain}')" class="btn btn-danger btn-small">Delete</button>
            </div>
        </div>
    `,
    )
    .join("")
}

// Edit user
function editUser(userId) {
  const user = allUsers.find((u) => u._id === userId)
  if (!user) return

  document.getElementById("editUserId").value = user._id
  document.getElementById("editUsername").value = user.username
  document.getElementById("editEmail").value = user.email
  document.getElementById("editFileLimit").value = user.fileLimit || 50

  document.getElementById("userModal").classList.add("active")
}

// Close user modal
function closeUserModal() {
  document.getElementById("userModal").classList.remove("active")
}

// Save user changes
async function saveUserChanges(e) {
  e.preventDefault()

  const userId = document.getElementById("editUserId").value
  const username = document.getElementById("editUsername").value
  const email = document.getElementById("editEmail").value
  const fileLimit = Number.parseInt(document.getElementById("editFileLimit").value)

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, fileLimit }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("User updated successfully", "success")
      closeUserModal()
      await loadAllUsers()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error updating user:", error)
    showMessage("Failed to update user", "error")
  }
}

// Delete user
async function deleteUser(userId) {
  if (!confirm("Are you sure you want to delete this user? This will also delete all their domains and files.")) {
    return
  }

  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "DELETE",
    })

    const result = await response.json()

    if (result.success) {
      showMessage("User deleted successfully", "success")
      await loadAllData()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error deleting user:", error)
    showMessage("Failed to delete user", "error")
  }
}

// Delete user file
async function deleteUserFile(userId, filename) {
  if (!confirm(`Are you sure you want to delete ${filename}?`)) {
    return
  }

  try {
    const response = await fetch(`/api/admin/files/${userId}/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    })

    const result = await response.json()

    if (result.success) {
      showMessage("File deleted successfully", "success")
      await loadAllFiles()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error deleting file:", error)
    showMessage("Failed to delete file", "error")
  }
}

// Delete user domain
async function deleteUserDomain(userId, domain) {
  if (!confirm(`Are you sure you want to delete ${domain}?`)) {
    return
  }

  try {
    const response = await fetch(`/api/admin/domains/${userId}/${encodeURIComponent(domain)}`, {
      method: "DELETE",
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Domain deleted successfully", "success")
      await loadAllData()
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error deleting domain:", error)
    showMessage("Failed to delete domain", "error")
  }
}

// Update global settings
async function updateGlobalSettings() {
  const defaultFileLimit = Number.parseInt(document.getElementById("defaultFileLimit").value)

  try {
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultFileLimit }),
    })

    const result = await response.json()

    if (result.success) {
      showMessage("Settings updated successfully", "success")
    } else {
      showMessage(result.error, "error")
    }
  } catch (error) {
    console.error("Error updating settings:", error)
    showMessage("Failed to update settings", "error")
  }
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

// Show message
function showMessage(text, type) {
  const messageDiv = document.getElementById("message")
  messageDiv.innerHTML = `<div class="${type}">${text}</div>`
  setTimeout(() => {
    messageDiv.innerHTML = ""
  }, 5000)
}

// Close modal when clicking outside
window.addEventListener("click", (e) => {
  const modal = document.getElementById("userModal")
  if (e.target === modal) {
    closeUserModal()
  }
})
