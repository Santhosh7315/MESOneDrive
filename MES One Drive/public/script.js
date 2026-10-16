const fileListEl = document.getElementById("fileList");

async function login() {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const error = document.getElementById("error");
    if (!username || !password) { error.textContent = "Enter username and password"; error.style.display = "block"; return; }
    try {
        const res = await fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
        if (!res.ok) throw new Error("Invalid username or password");
        window.location.href = "/dashboard.html";
    } catch (err) { error.textContent = err.message || "Login failed"; error.style.display = "block"; }
}

async function logout() {
    await fetch("/logout", { method: "POST" });
    window.location.href = "/login.html";
}

async function loadFiles() {
    if (!fileListEl) return;
    try {
        const res = await fetch("/files");
        if (res.status === 401) { window.location.href = "/login.html"; return; }
        if (!res.ok) throw new Error("Unable to load files");
        displayFiles(await res.json());
    } catch (err) {
        console.error(err);
        fileListEl.replaceChildren();
        const row = fileListEl.insertRow();
        const cell = row.insertCell(); cell.colSpan = 6; cell.textContent = "Failed to load files.";
    }
}

function displayFiles(files) {
    fileListEl.replaceChildren();
    if (!files.length) {
        const row = fileListEl.insertRow(); const cell = row.insertCell();
        cell.colSpan = 6; cell.textContent = "No files found in the configured storage folder."; return;
    }
    files.forEach(file => {
        const row = fileListEl.insertRow();
        const check = document.createElement("input"); check.type = "checkbox"; check.className = "selectFile"; check.dataset.name = file.name;
        row.insertCell().append(check);
        [file.type || "File", file.name, file.size, file.date].forEach(value => { const cell = row.insertCell(); cell.textContent = value; });
        const actions = row.insertCell();
        const download = document.createElement("button"); download.className = "btn download"; download.textContent = "Download"; download.addEventListener("click", () => downloadFile(file.name));
        const remove = document.createElement("button"); remove.className = "btn delete"; remove.textContent = "Delete"; remove.addEventListener("click", () => deleteFile(file.name));
        actions.append(download, document.createTextNode(" "), remove);
    });
}

function downloadFile(filename) { window.location.href = `/download/${encodeURIComponent(filename)}`; }

async function downloadFiles() {
    const files = Array.from(document.querySelectorAll(".selectFile:checked"), checkbox => checkbox.dataset.name);
    if (!files.length) return alert("Select at least one file!");
    try {
        const res = await fetch("/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files }) });
        if (!res.ok) throw new Error("Failed to download files");
        const blob = await res.blob(); const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = "files.zip"; link.click(); URL.revokeObjectURL(url);
    } catch (err) { alert(err.message); }
}

async function deleteFile(filename) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
    try {
        const res = await fetch(`/delete/${encodeURIComponent(filename)}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to delete file");
        await loadFiles();
    } catch (err) { alert(err.message); }
}

function searchFiles() {
    const filter = document.getElementById("search").value.toLowerCase();
    fileListEl.querySelectorAll("tr").forEach(row => {
        const nameCell = row.children[2];
        row.style.display = !nameCell || nameCell.textContent.toLowerCase().includes(filter) ? "" : "none";
    });
}

async function uploadFile() {
    const input = document.getElementById("fileInput");
    if (!input.files.length) return alert("Select files to upload");
    const formData = new FormData(); Array.from(input.files).forEach(file => formData.append("files", file));
    const status = document.getElementById("progress");
    try {
        const res = await fetch("/upload", { method: "POST", body: formData });
        const data = await res.json(); if (!res.ok) throw new Error(data.message || "Upload failed");
        status.textContent = data.message; input.value = ""; await loadFiles();
    } catch (err) { status.textContent = err.message; }
}

if (fileListEl) {
    loadFiles();
    const area = document.getElementById("uploadArea");
    area?.addEventListener("dragover", event => { event.preventDefault(); area.classList.add("dragover"); });
    area?.addEventListener("dragleave", () => area.classList.remove("dragover"));
    area?.addEventListener("drop", event => {
        event.preventDefault(); area.classList.remove("dragover");
        const input = document.getElementById("fileInput");
        if (event.dataTransfer.files.length) { input.files = event.dataTransfer.files; uploadFile(); }
    });
}
