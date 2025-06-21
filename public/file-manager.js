class FileManager {
  constructor() {
    this.currentPath = "/"
    this.history = ["/"]
    this.historyIndex = 0
    this.selectedItems = new Set()
    this.clipboard = { items: [], operation: null }
    this.viewMode = "grid" // grid or list

    this.init()
  }

  init() {
    this.bindEvents()
    this.loadDirectory(this.currentPath)
    this.updateBreadcrumb()
    this.loadDiskSpace()
  }

  bindEvents() {
    // Navigation buttons
    document.getElementById("backBtn").addEventListener("click", () => this.goBack())
    document.getElementById("forwardBtn").addEventListener("click", () => this.goForward())
    document.getElementById("upBtn").addEventListener("click", () => this.goUp())
    document.getElementById("refreshBtn").addEventListener("click", () => this.refresh())

    // View toggle
    document.getElementById("viewToggle").addEventListener("click", () => this.toggleView())

    // Toolbar buttons
    document.getElementById("newFolderBtn").addEventListener("click", () => this.showNewFolderModal())
    document.getElementById("newFileBtn").addEventListener("click", () => this.showNewFileModal())
    document.getElementById("uploadBtn").addEventListener("click", () => this.showUploadDialog())
    document.getElementById("cutBtn").addEventListener("click", () => this.cutSelected())
    document.getElementById("copyBtn").addEventListener("click", () => this.copySelected())
    document.getElementById("pasteBtn").addEventListener("click", () => this.paste())
    document.getElementById("deleteBtn").addEventListener("click", () => this.deleteSelected())

    // Sidebar navigation
    document.querySelectorAll(".fm-sidebar-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        const path = e.currentTarget.dataset.path
        if (path) {
          this.navigateTo(path)
        }
      })
    })

    // Search
    document.getElementById("searchInput").addEventListener("input", (e) => {
      this.search(e.target.value)
    })

    // Context menu
    document.addEventListener("contextmenu", (e) => this.showContextMenu(e))
    document.addEventListener("click", () => this.hideContextMenu())

    // Context menu actions
    document.querySelectorAll("#contextMenu li[data-action]").forEach((item) => {
      item.addEventListener("click", (e) => {
        const action = e.currentTarget.dataset.action
        this.handleContextAction(action)
      })
    })

    // Modal events
    this.bindModalEvents()

    // File upload
    document.getElementById("fileUploadInput").addEventListener("change", (e) => {
      this.handleFileUpload(e.target.files)
    })

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => this.handleKeyboard(e))

    // Drag and drop
    this.bindDragDropEvents()
  }

  bindModalEvents() {
    // New folder modal
    document.getElementById("createFolderBtn").addEventListener("click", () => this.createFolder())
    document.getElementById("cancelFolderBtn").addEventListener("click", () => this.hideModal("newFolderModal"))

    // New file modal
    document.getElementById("createFileBtn").addEventListener("click", () => this.createFile())
    document.getElementById("cancelFileBtn").addEventListener("click", () => this.hideModal("newFileModal"))

    // Properties modal
    document.getElementById("closePropertiesBtn").addEventListener("click", () => this.hideModal("propertiesModal"))

    // Close modals on outside click
    document.querySelectorAll(".fm-modal").forEach((modal) => {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          this.hideModal(modal.id)
        }
      })
    })
  }

  bindDragDropEvents() {
    const fileArea = document.querySelector(".fm-file-area")

    fileArea.addEventListener("dragover", (e) => {
      e.preventDefault()
      fileArea.classList.add("drag-over")
    })

    fileArea.addEventListener("dragleave", (e) => {
      if (!fileArea.contains(e.relatedTarget)) {
        fileArea.classList.remove("drag-over")
      }
    })

    fileArea.addEventListener("drop", (e) => {
      e.preventDefault()
      fileArea.classList.remove("drag-over")

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        this.handleFileUpload(files)
      }
    })
  }

  async loadDirectory(path) {
    try {
      this.showLoading()

      const response = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`)
      const data = await response.json()

      if (data.success) {
        this.renderFiles(data.files)
        this.currentPath = path
        this.updateBreadcrumb()
        this.updateItemCount(data.files.length)
      } else {
        this.showError(data.error)
      }
    } catch (error) {
      this.showError("फ़ाइलें लोड करने में त्रुटि")
    } finally {
      this.hideLoading()
    }
  }

  renderFiles(files) {
    const fileList = document.getElementById("fileList")
    fileList.innerHTML = ""

    files.forEach((file) => {
      const fileItem = this.createFileItem(file)
      fileList.appendChild(fileItem)
    })

    this.selectedItems.clear()
    this.updateSelectionCount()
  }

  createFileItem(file) {
    const item = document.createElement("div")
    item.className = "fm-file-item"
    item.dataset.name = file.name
    item.dataset.type = file.type
    item.dataset.path = file.path

    const icon = this.getFileIcon(file)
    const size = file.type === "directory" ? "" : this.formatFileSize(file.size)

    item.innerHTML = `
            <div class="fm-file-icon ${this.getIconClass(file)}">${icon}</div>
            <div class="fm-file-name">${file.name}</div>
            ${size ? `<div class="fm-file-size">${size}</div>` : ""}
        `

    // Event listeners
    item.addEventListener("click", (e) => this.selectItem(e, item))
    item.addEventListener("dblclick", () => this.openItem(file))

    return item
  }

  getFileIcon(file) {
    if (file.type === "directory") {
      return '<i class="fas fa-folder"></i>'
    }

    const ext = file.name.split(".").pop().toLowerCase()
    const iconMap = {
      // Images
      jpg: '<i class="fas fa-file-image"></i>',
      jpeg: '<i class="fas fa-file-image"></i>',
      png: '<i class="fas fa-file-image"></i>',
      gif: '<i class="fas fa-file-image"></i>',
      svg: '<i class="fas fa-file-image"></i>',

      // Documents
      pdf: '<i class="fas fa-file-pdf"></i>',
      doc: '<i class="fas fa-file-word"></i>',
      docx: '<i class="fas fa-file-word"></i>',
      xls: '<i class="fas fa-file-excel"></i>',
      xlsx: '<i class="fas fa-file-excel"></i>',
      ppt: '<i class="fas fa-file-powerpoint"></i>',
      pptx: '<i class="fas fa-file-powerpoint"></i>',
      txt: '<i class="fas fa-file-alt"></i>',

      // Code
      html: '<i class="fas fa-file-code"></i>',
      css: '<i class="fas fa-file-code"></i>',
      js: '<i class="fas fa-file-code"></i>',
      php: '<i class="fas fa-file-code"></i>',
      py: '<i class="fas fa-file-code"></i>',
      json: '<i class="fas fa-file-code"></i>',

      // Archives
      zip: '<i class="fas fa-file-archive"></i>',
      rar: '<i class="fas fa-file-archive"></i>',
      tar: '<i class="fas fa-file-archive"></i>',
      gz: '<i class="fas fa-file-archive"></i>',

      // Audio/Video
      mp3: '<i class="fas fa-file-audio"></i>',
      wav: '<i class="fas fa-file-audio"></i>',
      mp4: '<i class="fas fa-file-video"></i>',
      avi: '<i class="fas fa-file-video"></i>',
    }

    return iconMap[ext] || '<i class="fas fa-file"></i>'
  }

  getIconClass(file) {
    if (file.type === "directory") return "folder"

    const ext = file.name.split(".").pop().toLowerCase()
    if (["jpg", "jpeg", "png", "gif", "svg"].includes(ext)) return "image"
    if (["pdf", "doc", "docx", "txt"].includes(ext)) return "document"
    if (["zip", "rar", "tar", "gz"].includes(ext)) return "archive"

    return ""
  }

  selectItem(e, item) {
    if (e.ctrlKey || e.metaKey) {
      // Multi-select
      if (this.selectedItems.has(item.dataset.name)) {
        this.selectedItems.delete(item.dataset.name)
        item.classList.remove("selected")
      } else {
        this.selectedItems.add(item.dataset.name)
        item.classList.add("selected")
      }
    } else if (e.shiftKey && this.selectedItems.size > 0) {
      // Range select
      this.selectRange(item)
    } else {
      // Single select
      document.querySelectorAll(".fm-file-item.selected").forEach((el) => {
        el.classList.remove("selected")
      })
      this.selectedItems.clear()
      this.selectedItems.add(item.dataset.name)
      item.classList.add("selected")
    }

    this.updateSelectionCount()
  }

  selectRange(endItem) {
    const items = Array.from(document.querySelectorAll(".fm-file-item"))
    const selectedItems = Array.from(document.querySelectorAll(".fm-file-item.selected"))

    if (selectedItems.length === 0) return

    const startIndex = items.indexOf(selectedItems[0])
    const endIndex = items.indexOf(endItem)

    const start = Math.min(startIndex, endIndex)
    const end = Math.max(startIndex, endIndex)

    for (let i = start; i <= end; i++) {
      const item = items[i]
      this.selectedItems.add(item.dataset.name)
      item.classList.add("selected")
    }
  }

  async openItem(file) {
    if (file.type === "directory") {
      this.navigateTo(file.path)
    } else {
      // Open file in appropriate application
      try {
        const response = await fetch("/api/files/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: file.path }),
        })

        const result = await response.json()
        if (!result.success) {
          this.showError(result.error)
        }
      } catch (error) {
        this.showError("फ़ाइल खोलने में त्रुटि")
      }
    }
  }

  navigateTo(path) {
    if (path !== this.currentPath) {
      this.history = this.history.slice(0, this.historyIndex + 1)
      this.history.push(path)
      this.historyIndex = this.history.length - 1
    }

    this.loadDirectory(path)
    this.updateSidebarSelection(path)
  }

  goBack() {
    if (this.historyIndex > 0) {
      this.historyIndex--
      this.loadDirectory(this.history[this.historyIndex])
    }
  }

  goForward() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++
      this.loadDirectory(this.history[this.historyIndex])
    }
  }

  goUp() {
    const parentPath = this.currentPath.split("/").slice(0, -1).join("/") || "/"
    this.navigateTo(parentPath)
  }

  refresh() {
    this.loadDirectory(this.currentPath)
  }

  toggleView() {
    const fileList = document.getElementById("fileList")
    const viewToggle = document.getElementById("viewToggle")

    if (this.viewMode === "grid") {
      this.viewMode = "list"
      fileList.classList.add("list-view")
      viewToggle.innerHTML = '<i class="fas fa-th"></i>'
    } else {
      this.viewMode = "grid"
      fileList.classList.remove("list-view")
      viewToggle.innerHTML = '<i class="fas fa-list"></i>'
    }
  }

  updateBreadcrumb() {
    const breadcrumb = document.getElementById("breadcrumbPath")
    const parts = this.currentPath.split("/").filter((part) => part)

    let html = '<span data-path="/" class="breadcrumb-item">रूट</span>'
    let currentPath = ""

    parts.forEach((part) => {
      currentPath += "/" + part
      html += ` <i class="fas fa-chevron-right"></i> <span data-path="${currentPath}" class="breadcrumb-item">${part}</span>`
    })

    breadcrumb.innerHTML = html

    // Add click events to breadcrumb items
    breadcrumb.querySelectorAll(".breadcrumb-item").forEach((item) => {
      item.style.cursor = "pointer"
      item.addEventListener("click", () => {
        this.navigateTo(item.dataset.path)
      })
    })
  }

  updateSidebarSelection(path) {
    document.querySelectorAll(".fm-sidebar-item").forEach((item) => {
      item.classList.remove("active")
      if (item.dataset.path === path) {
        item.classList.add("active")
      }
    })
  }

  updateItemCount(count) {
    document.getElementById("itemCount").textContent = `${count} आइटम`
  }

  updateSelectionCount() {
    const selectedCount = document.getElementById("selectedCount")
    if (this.selectedItems.size > 0) {
      selectedCount.textContent = `${this.selectedItems.size} चयनित`
    } else {
      selectedCount.textContent = ""
    }
  }

  async loadDiskSpace() {
    try {
      const response = await fetch("/api/system/disk-space")
      const data = await response.json()

      if (data.success) {
        const used = this.formatFileSize(data.used)
        const total = this.formatFileSize(data.total)
        const percent = ((data.used / data.total) * 100).toFixed(1)

        document.getElementById("diskSpace").textContent = `डिस्क स्थान: ${used} / ${total} (${percent}% उपयोग में)`
      }
    } catch (error) {
      console.error("Disk space load error:", error)
    }
  }

  search(query) {
    const items = document.querySelectorAll(".fm-file-item")

    items.forEach((item) => {
      const name = item.dataset.name.toLowerCase()
      if (name.includes(query.toLowerCase())) {
        item.style.display = ""
      } else {
        item.style.display = "none"
      }
    })
  }

  showContextMenu(e) {
    e.preventDefault()

    const contextMenu = document.getElementById("contextMenu")
    const target = e.target.closest(".fm-file-item")

    if (target && !target.classList.contains("selected")) {
      this.selectItem(e, target)
    }

    contextMenu.style.display = "block"
    contextMenu.style.left = e.pageX + "px"
    contextMenu.style.top = e.pageY + "px"

    // Update context menu based on selection
    this.updateContextMenu()
  }

  hideContextMenu() {
    document.getElementById("contextMenu").style.display = "none"
  }

  updateContextMenu() {
    const pasteItem = document.querySelector('[data-action="paste"]')
    pasteItem.style.display = this.clipboard.items.length > 0 ? "block" : "none"
  }

  handleContextAction(action) {
    this.hideContextMenu()

    switch (action) {
      case "open":
        this.openSelected()
        break
      case "edit":
        this.editSelected()
        break
      case "cut":
        this.cutSelected()
        break
      case "copy":
        this.copySelected()
        break
      case "paste":
        this.paste()
        break
      case "rename":
        this.renameSelected()
        break
      case "delete":
        this.deleteSelected()
        break
      case "properties":
        this.showProperties()
        break
    }
  }

  openSelected() {
    if (this.selectedItems.size === 1) {
      const item = document.querySelector(`[data-name="${Array.from(this.selectedItems)[0]}"]`)
      const file = {
        name: item.dataset.name,
        type: item.dataset.type,
        path: item.dataset.path,
      }
      this.openItem(file)
    }
  }

  async editSelected() {
    if (this.selectedItems.size === 1) {
      const item = document.querySelector(`[data-name="${Array.from(this.selectedItems)[0]}"]`)

      try {
        const response = await fetch("/api/files/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: item.dataset.path }),
        })

        const result = await response.json()
        if (!result.success) {
          this.showError(result.error)
        }
      } catch (error) {
        this.showError("फ़ाइल संपादित करने में त्रुटि")
      }
    }
  }

  cutSelected() {
    this.clipboard.items = Array.from(this.selectedItems)
    this.clipboard.operation = "cut"
    this.showMessage("फ़ाइलें काटी गईं")
  }

  copySelected() {
    this.clipboard.items = Array.from(this.selectedItems)
    this.clipboard.operation = "copy"
    this.showMessage("फ़ाइलें कॉपी की गईं")
  }

  async paste() {
    if (this.clipboard.items.length === 0) return

    try {
      const response = await fetch("/api/files/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: this.clipboard.items,
          operation: this.clipboard.operation,
          destination: this.currentPath,
        }),
      })

      const result = await response.json()

      if (result.success) {
        this.showMessage("फ़ाइलें पेस्ट की गईं")
        this.refresh()

        if (this.clipboard.operation === "cut") {
          this.clipboard.items = []
          this.clipboard.operation = null
        }
      } else {
        this.showError(result.error)
      }
    } catch (error) {
      this.showError("पेस्ट करने में त्रुटि")
    }
  }

  async renameSelected() {
    if (this.selectedItems.size === 1) {
      const oldName = Array.from(this.selectedItems)[0]
      const newName = prompt("नया नाम दर्ज करें:", oldName)

      if (newName && newName !== oldName) {
        try {
          const response = await fetch("/api/files/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oldPath: this.currentPath + "/" + oldName,
              newName: newName,
            }),
          })

          const result = await response.json()

          if (result.success) {
            this.showMessage("नाम बदला गया")
            this.refresh()
          } else {
            this.showError(result.error)
          }
        } catch (error) {
          this.showError("नाम बदलने में त्रुटि")
        }
      }
    }
  }

  async deleteSelected() {
    if (this.selectedItems.size === 0) return

    const confirmMessage =
      this.selectedItems.size === 1
        ? `क्या आप वाकई "${Array.from(this.selectedItems)[0]}" को हटाना चाहते हैं?`
        : `क्या आप वाकई ${this.selectedItems.size} आइटम हटाना चाहते हैं?`

    if (confirm(confirmMessage)) {
      try {
        const response = await fetch("/api/files/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: Array.from(this.selectedItems),
            path: this.currentPath,
          }),
        })

        const result = await response.json()

        if (result.success) {
          this.showMessage("फ़ाइलें हटाई गईं")
          this.refresh()
        } else {
          this.showError(result.error)
        }
      } catch (error) {
        this.showError("फ़ाइलें हटाने में त्रुटि")
      }
    }
  }

  async showProperties() {
    if (this.selectedItems.size === 1) {
      const itemName = Array.from(this.selectedItems)[0]

      try {
        const response = await fetch(
          `/api/files/properties?path=${encodeURIComponent(this.currentPath + "/" + itemName)}`,
        )
        const data = await response.json()

        if (data.success) {
          this.renderProperties(data.properties)
          this.showModal("propertiesModal")
        } else {
          this.showError(data.error)
        }
      } catch (error) {
        this.showError("गुण लोड करने में त्रुटि")
      }
    }
  }

  renderProperties(properties) {
    const content = document.getElementById("propertiesContent")

    const table = document.createElement("table")
    table.className = "fm-properties-table"

    Object.entries(properties).forEach(([key, value]) => {
      const row = table.insertRow()
      const keyCell = row.insertCell(0)
      const valueCell = row.insertCell(1)

      keyCell.innerHTML = `<th>${this.translatePropertyKey(key)}</th>`
      valueCell.textContent = this.formatPropertyValue(key, value)
    })

    content.innerHTML = ""
    content.appendChild(table)
  }

  translatePropertyKey(key) {
    const translations = {
      name: "नाम",
      type: "प्रकार",
      size: "आकार",
      created: "बनाया गया",
      modified: "संशोधित",
      permissions: "अनुमतियां",
      owner: "स्वामी",
      group: "समूह",
    }

    return translations[key] || key
  }

  formatPropertyValue(key, value) {
    switch (key) {
      case "size":
        return this.formatFileSize(value)
      case "created":
      case "modified":
        return new Date(value).toLocaleString("hi-IN")
      default:
        return value
    }
  }

  showNewFolderModal() {
    document.getElementById("folderNameInput").value = ""
    this.showModal("newFolderModal")
  }

  showNewFileModal() {
    document.getElementById("fileNameInput").value = ""
    this.showModal("newFileModal")
  }

  async createFolder() {
    const name = document.getElementById("folderNameInput").value.trim()

    if (!name) {
      this.showError("फ़ोल्डर का नाम दर्ज करें")
      return
    }

    try {
      const response = await fetch("/api/files/create-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: this.currentPath,
          name: name,
        }),
      })

      const result = await response.json()

      if (result.success) {
        this.showMessage("फ़ोल्डर बनाया गया")
        this.hideModal("newFolderModal")
        this.refresh()
      } else {
        this.showError(result.error)
      }
    } catch (error) {
      this.showError("फ़ोल्डर बनाने में त्रुटि")
    }
  }

  async createFile() {
    const name = document.getElementById("fileNameInput").value.trim()

    if (!name) {
      this.showError("फ़ाइल का नाम दर्ज करें")
      return
    }

    try {
      const response = await fetch("/api/files/create-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: this.currentPath,
          name: name,
        }),
      })

      const result = await response.json()

      if (result.success) {
        this.showMessage("फ़ाइल बनाई गई")
        this.hideModal("newFileModal")
        this.refresh()
      } else {
        this.showError(result.error)
      }
    } catch (error) {
      this.showError("फ़ाइल बनाने में त्रुटि")
    }
  }

  showUploadDialog() {
    document.getElementById("fileUploadInput").click()
  }

  async handleFileUpload(files) {
    const formData = new FormData()

    Array.from(files).forEach((file) => {
      formData.append("files", file)
    })

    formData.append("path", this.currentPath)

    try {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      })

      const result = await response.json()

      if (result.success) {
        this.showMessage(`${files.length} फ़ाइलें अपलोड की गईं`)
        this.refresh()
      } else {
        this.showError(result.error)
      }
    } catch (error) {
      this.showError("फ़ाइल अपलोड में त्रुटि")
    }
  }

  handleKeyboard(e) {
    // Ctrl+A - Select all
    if (e.ctrlKey && e.key === "a") {
      e.preventDefault()
      this.selectAll()
    }

    // Delete - Delete selected
    if (e.key === "Delete") {
      this.deleteSelected()
    }

    // Ctrl+C - Copy
    if (e.ctrlKey && e.key === "c") {
      this.copySelected()
    }

    // Ctrl+X - Cut
    if (e.ctrlKey && e.key === "x") {
      this.cutSelected()
    }

    // Ctrl+V - Paste
    if (e.ctrlKey && e.key === "v") {
      this.paste()
    }

    // F5 - Refresh
    if (e.key === "F5") {
      e.preventDefault()
      this.refresh()
    }

    // Escape - Clear selection
    if (e.key === "Escape") {
      this.clearSelection()
    }
  }

  selectAll() {
    document.querySelectorAll(".fm-file-item").forEach((item) => {
      this.selectedItems.add(item.dataset.name)
      item.classList.add("selected")
    })

    this.updateSelectionCount()
  }

  clearSelection() {
    document.querySelectorAll(".fm-file-item.selected").forEach((item) => {
      item.classList.remove("selected")
    })

    this.selectedItems.clear()
    this.updateSelectionCount()
  }

  showModal(modalId) {
    document.getElementById(modalId).style.display = "flex"
  }

  hideModal(modalId) {
    document.getElementById(modalId).style.display = "none"
  }

  showLoading() {
    const fileList = document.getElementById("fileList")
    fileList.innerHTML = '<div class="fm-loading"><i class="fas fa-spinner"></i> लोड हो रहा है...</div>'
  }

  hideLoading() {
    // Loading will be hidden when files are rendered
  }

  showMessage(message) {
    // You can implement a toast notification system here
    console.log("Message:", message)
  }

  showError(error) {
    // You can implement an error notification system here
    console.error("Error:", error)
    alert(error)
  }

  formatFileSize(bytes) {
    if (bytes === 0) return "0 B"

    const k = 1024
    const sizes = ["B", "KB", "MB", "GB", "TB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }
}

// Initialize file manager when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new FileManager()
})
