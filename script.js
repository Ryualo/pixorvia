// ==========================================
// 1. CONFIGURATION & AUTHENTICATION
// ==========================================
const API_URL = 'https://ryualz.pythonanywhere.com/api';
const IMGBB_API_KEY = 'd0c91137ced695243206c17f75dd6f0a'; 
const ADMIN_NAME = 'Ryual'; 

if (!localStorage.getItem('customName')) {
    window.location.href = 'login.html';
}
const getUsername = () => localStorage.getItem('customName');

// ==========================================
// 2. NETWORK TIMEOUT CONTROLLER
// ==========================================
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 12000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
}

// ==========================================
// 3. IMAGE PROCESSING & CLOUD UPLOADS
// ==========================================
async function pixelateImage(base64Str, pixelSize = 10) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width; 
            canvas.height = img.height;
            
            const smallW = img.width / pixelSize;
            const smallH = img.height / pixelSize;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, smallW, smallH);
            ctx.drawImage(canvas, 0, 0, smallW, smallH, 0, 0, img.width, img.height);
            
            resolve(canvas.toDataURL("image/png"));
        };
    });
}

async function uploadToImgBB(base64Image) {
    if (!IMGBB_API_KEY || IMGBB_API_KEY === 'YOUR_IMGBB_API_KEY') {
        throw new Error("ImgBB API key is missing!");
    }
    const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;
    const formData = new FormData();
    formData.append('image', base64Data);

    const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
        method: 'POST', body: formData
    });
    const data = await res.json();
    if (data.success) return data.data.url;
    throw new Error("ImgBB upload failed: " + data.error.message);
}

// ==========================================
// 4. UI ELEMENTS & STATE VARIABLES
// ==========================================
const createModal = document.getElementById('create-post-modal');
const studioModal = document.getElementById('canvas-modal');
const titleInput = document.getElementById('post-title-input');
const bodyInput = document.getElementById('post-body-input');
const driveLinkInput = document.getElementById('drive-link-input');
const previewBox = document.getElementById('draft-media-preview');
const previewText = document.getElementById('file-name-display');
const retroToggleBox = document.getElementById('retro-toggle-box');

let attachedFile = null;
let hasDrawn = false;

// ==========================================
// 5. DRAFT & MODAL MANAGEMENT
// ==========================================
document.getElementById('open-create-modal').addEventListener('click', () => {
    createModal.style.display = 'flex';
    const savedDraft = JSON.parse(localStorage.getItem('pixelDraft'));
    if (savedDraft) {
        titleInput.value = savedDraft.title || '';
        bodyInput.value = savedDraft.body || '';
        if (savedDraft.hasMedia) {
            previewBox.style.display = 'block';
            previewText.textContent = "Draft media recovered!";
        }
    }
});

function hasUnsavedChanges() {
    return titleInput.value.trim() !== '' || bodyInput.value.trim() !== '' || hasDrawn || attachedFile !== null || (driveLinkInput && driveLinkInput.value.trim() !== '');
}

document.getElementById('close-create-modal').addEventListener('click', () => {
    if (hasUnsavedChanges()) {
        if (confirm("You have unsaved changes. Do you want to save this as a draft?")) {
            localStorage.setItem('pixelDraft', JSON.stringify({
                title: titleInput.value.trim(), 
                body: bodyInput.value.trim(), 
                hasMedia: hasDrawn || attachedFile !== null
            }));
        } else {
            localStorage.removeItem('pixelDraft');
            titleInput.value = ''; bodyInput.value = ''; 
            if(driveLinkInput) driveLinkInput.value = '';
            attachedFile = null; hasDrawn = false;
            previewBox.style.display = 'none';
            if (retroToggleBox) retroToggleBox.style.display = 'none'; 
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
        }
    } else {
        if (retroToggleBox) retroToggleBox.style.display = 'none';
    }
    createModal.style.display = 'none';
});

window.addEventListener('beforeunload', (e) => {
    if (createModal.style.display === 'flex' && hasUnsavedChanges()) {
        e.preventDefault(); e.returnValue = ''; 
    }
});

// ==========================================
// 6. PIXEL STUDIO CONTROLS & ZOOM
// ==========================================
document.getElementById('open-canvas-btn').addEventListener('click', () => studioModal.style.display = 'flex');
document.getElementById('close-studio-btn').addEventListener('click', () => studioModal.style.display = 'none');
document.getElementById('done-drawing-btn').addEventListener('click', () => {
    studioModal.style.display = 'none';
    if(hasDrawn) { previewBox.style.display = 'block'; previewText.textContent = "Canvas Art Attached"; }
});

let currentScale = 1;
const canvas = document.getElementById('pixel-canvas');
const ctx = canvas.getContext('2d');
const zoomLevelDisplay = document.getElementById('zoom-level-display');

document.getElementById('zoom-in-btn').addEventListener('click', () => {
    if (currentScale < 4) { currentScale += 0.5; canvas.style.transform = `scale(${currentScale})`; zoomLevelDisplay.textContent = `${Math.round(currentScale * 100)}%`; }
});
document.getElementById('zoom-out-btn').addEventListener('click', () => {
    if (currentScale > 0.5) { currentScale -= 0.5; canvas.style.transform = `scale(${currentScale})`; zoomLevelDisplay.textContent = `${Math.round(currentScale * 100)}%`; }
});

// ==========================================
// ACCESSIBILITY: ARROW KEY PANNING
// ==========================================
const canvasViewport = document.querySelector('.canvas-viewport');
window.addEventListener('keydown', (e) => {
    if (studioModal.style.display === 'flex') {
        const panSpeed = 30; // Speed of movement per arrow press
        switch(e.key) {
            case 'ArrowUp':
                canvasViewport.scrollTop -= panSpeed;
                e.preventDefault();
                break;
            case 'ArrowDown':
                canvasViewport.scrollTop += panSpeed;
                e.preventDefault();
                break;
            case 'ArrowLeft':
                canvasViewport.scrollLeft -= panSpeed;
                e.preventDefault();
                break;
            case 'ArrowRight':
                canvasViewport.scrollLeft += panSpeed;
                e.preventDefault();
                break;
        }
    }
});

document.getElementById('clear-canvas-btn').addEventListener('click', () => { 
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height); 
    hasDrawn = false; previewBox.style.display = 'none';
});

// ==========================================
// 7. ADVANCED CANVAS LOGIC (Flood Fill & Shapes)
// ==========================================
let isDrawing = false;
ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);

function hexToRgba(hex) {
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, 255];
}

function colorsMatch(data, pos, colorData) {
    return (data[pos] === colorData[0] && data[pos+1] === colorData[1] && data[pos+2] === colorData[2] && data[pos+3] === colorData[3]);
}

function floodFill(startX, startY, fillColorHex) {
    const fillColor = hexToRgba(fillColorHex);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const startPos = (startY * canvas.width + startX) * 4;
    const targetColor = [data[startPos], data[startPos+1], data[startPos+2], data[startPos+3]];

    if (colorsMatch(data, startPos, fillColor)) return;
    const stack = [[startX, startY]];
    
    while (stack.length > 0) {
        let [x, y] = stack.pop();
        let currentPos = (y * canvas.width + x) * 4;
        
        while (x >= 0 && colorsMatch(data, currentPos, targetColor)) { x--; currentPos -= 4; }
        x++; currentPos += 4;
        let spanAbove = false, spanBelow = false;
        
        while (x < canvas.width && colorsMatch(data, currentPos, targetColor)) {
            data[currentPos] = fillColor[0]; data[currentPos+1] = fillColor[1]; data[currentPos+2] = fillColor[2]; data[currentPos+3] = fillColor[3];
            if (y > 0) {
                const abovePos = currentPos - (canvas.width * 4);
                if (!spanAbove && colorsMatch(data, abovePos, targetColor)) { stack.push([x, y - 1]); spanAbove = true; } 
                else if (spanAbove && !colorsMatch(data, abovePos, targetColor)) spanAbove = false;
            }
            if (y < canvas.height - 1) {
                const belowPos = currentPos + (canvas.width * 4);
                if (!spanBelow && colorsMatch(data, belowPos, targetColor)) { stack.push([x, y + 1]); spanBelow = true; } 
                else if (spanBelow && !colorsMatch(data, belowPos, targetColor)) spanBelow = false;
            }
            x++; currentPos += 4;
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

canvas.addEventListener('mousedown', (e) => { 
    const rect = canvas.getBoundingClientRect();
    const rawX = Math.floor((e.clientX - rect.left) / currentScale);
    const rawY = Math.floor((e.clientY - rect.top) / currentScale);
    const mode = document.getElementById('paint-mode-select').value;
    
    if (mode === 'fill') { 
        floodFill(rawX, rawY, document.getElementById('color-picker').value); 
        hasDrawn = true; 
    } else { 
        isDrawing = true; 
        drawPixel(e); 
    }
});
canvas.addEventListener('mousemove', (e) => { if (isDrawing) drawPixel(e); });
window.addEventListener('mouseup', () => isDrawing = false);

function drawPixel(e) {
    const rect = canvas.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / currentScale;
    const rawY = (e.clientY - rect.top) / currentScale;
    const size = canvas.width / parseInt(document.getElementById('grid-size-select').value);
    
    const gx = Math.floor(rawX / size) * size;
    const gy = Math.floor(rawY / size) * size;
    const cx = gx + size/2, cy = gy + size/2;
    
    const mode = document.getElementById('paint-mode-select').value;
    if (mode === 'erase') { 
        ctx.fillStyle = '#ffffff'; 
        ctx.fillRect(gx, gy, size, size); 
        return; 
    }
    
    ctx.fillStyle = document.getElementById('color-picker').value;
    const shape = document.getElementById('pixel-shape-select').value;
    
    if (shape === 'square') {
        ctx.fillRect(gx, gy, size, size);
    } else if (shape === 'circle') { 
        ctx.beginPath(); ctx.arc(cx, cy, size/2, 0, Math.PI*2); ctx.fill(); 
    } else if (shape === 'triangle') { 
        ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(gx+size, gy+size); ctx.lineTo(gx, gy+size); ctx.closePath(); ctx.fill(); 
    }
    hasDrawn = true;
}

// ==========================================
// 8. MEDIA ATTACHMENT
// ==========================================
document.getElementById('file-upload').addEventListener('change', (e) => {
    if(e.target.files[0]) {
        const r = new FileReader(); 
        r.onload = (ev) => { 
            attachedFile = ev.target.result; 
            previewBox.style.display = 'block'; 
            previewText.textContent = e.target.files[0].name; 
            if (retroToggleBox) retroToggleBox.style.display = 'flex'; 
        }; 
        r.readAsDataURL(e.target.files[0]);
    }
});

// ==========================================
// 9. FEED LOADING & SEARCH (With Admin Logic)
// ==========================================
const searchBar = document.getElementById('main-search-bar');
searchBar.addEventListener('input', (e) => loadPosts(e.target.value));

async function loadPosts(searchQuery = "") {
    const wrapper = document.getElementById('posts-wrapper');
    wrapper.innerHTML = `
        <div style="text-align: center; padding: 50px;">
            <i class="fas fa-circle-notch fa-spin" style="font-size: 35px; color: #0079d3; margin-bottom: 15px;"></i>
            <p style="color: var(--secondary-text); font-weight: bold; font-size: 14px;">Waking up the server...</p>
        </div>
    `; 
    
    try {
        const response = await fetchWithTimeout(`${API_URL}/posts`, { timeout: 15000 });
        if (!response.ok) throw new Error("Server error");
        const posts = await response.json();
        
        const query = searchQuery.toLowerCase();
        const filteredPosts = posts.filter(post => {
            return (post.title || '').toLowerCase().includes(query) || 
                   (post.body || '').toLowerCase().includes(query) || 
                   (post.username || '').toLowerCase().includes(query);
        });

        wrapper.innerHTML = ''; 

        if (filteredPosts.length === 0) {
            wrapper.innerHTML = `<p style="text-align:center; color: var(--secondary-text); padding: 20px;">No posts found.</p>`;
            return;
        }
        
        filteredPosts.reverse().forEach(post => {
            const isOwner = post.username === getUsername();
            const isAdminPoster = post.username === ADMIN_NAME; 
            const iAmAdmin = getUsername() === ADMIN_NAME; 

            const el = document.createElement('article');
            el.className = 'post';
            
            const mediaHtml = post.media ? `<img src="${post.media}" class="post-image-main">` : '';
            const badgeHtml = isAdminPoster ? `<span class="admin-badge"><i class="fas fa-crown"></i> Admin</span>` : '';
            const deleteHtml = (isOwner || iAmAdmin) ? `<button class="delete-btn" onclick="deletePost(${post.id})"><i class="fas fa-trash"></i></button>` : '';
            
            el.innerHTML = `
                <div class="vote-sidebar"><button class="vote-btn">▲</button><span class="score">${post.votes || 1}</span><button class="vote-btn">▼</button></div>
                <div class="post-content">
                    <div class="post-header">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <a href="profile.html?user=${post.username}" class="username-display">@${post.username}</a>
                            ${badgeHtml}
                            <span style="font-size:11px; color:#888;">• ${post.date}</span>
                        </div>
                        ${deleteHtml}
                    </div>
                    <h2 class="post-title">${post.title}</h2>
                    <p class="post-body">${post.body.replace(/\n/g, '<br>')}</p>
                    ${mediaHtml}
                </div>
            `;
            wrapper.appendChild(el); 
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            wrapper.innerHTML = '<p style="text-align:center; color: #ff4757; padding: 20px;"><i class="fas fa-snail"></i> The server is taking too long to respond. Please wait a minute and refresh.</p>';
        } else {
            wrapper.innerHTML = '<p style="text-align:center; color: #ff4757; padding: 20px;">Failed to connect to the server.</p>';
        }
    }
}

// ==========================================
// 10. POST DELETION LOGIC
// ==========================================
window.deletePost = async function(postId) {
    if (!confirm("Are you sure you want to delete this post?")) return;
    try {
        const response = await fetchWithTimeout(`${API_URL}/posts/${postId}?user=${getUsername()}`, { method: 'DELETE' });
        if (response.ok) {
            loadPosts(document.getElementById('main-search-bar').value); 
        } else {
            const err = await response.json();
            alert("Error: " + err.error);
        }
    } catch (error) {
        console.error("Delete failed:", error);
        alert("Failed to communicate with server.");
    }
};

// ==========================================
// 11. POST SUBMISSION (Final Payload)
// ==========================================
document.getElementById('submit-post-btn').addEventListener('click', async () => {
    const t = titleInput.value.trim();
    let b = bodyInput.value.trim();
    const driveLink = driveLinkInput ? driveLinkInput.value.trim() : "";
    const isRetro = document.getElementById('retro-mode-toggle') ? document.getElementById('retro-mode-toggle').checked : false;
    
    if(!t && !hasDrawn && !attachedFile && !driveLink) return;

    const submitBtn = document.getElementById('submit-post-btn');
    submitBtn.textContent = "Uploading Media...";
    submitBtn.disabled = true; 

    try {
        let finalMediaUrl = "";

        if (hasDrawn) {
            finalMediaUrl = await uploadToImgBB(canvas.toDataURL("image/png"));
        } else if (attachedFile) {
            if (isRetro) {
                submitBtn.textContent = "Applying Retro Filter...";
                const pixelatedData = await pixelateImage(attachedFile, 10);
                finalMediaUrl = await uploadToImgBB(pixelatedData);
            } else {
                finalMediaUrl = await uploadToImgBB(attachedFile);
            }
        }

        if (driveLink) {
            b += `\n\n🔗 <a href="${driveLink}" target="_blank" style="color: #0079d3; font-weight: bold; text-decoration: none;">View Attached File</a>`;
        }

        submitBtn.textContent = "Saving to Database...";

        const newPost = {
            username: getUsername(), 
            title: t, 
            body: b,
            media: finalMediaUrl, 
            date: new Date().toLocaleDateString()
        };

        const response = await fetchWithTimeout(`${API_URL}/posts`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(newPost),
            timeout: 15000 
        });
        
        if (!response.ok) throw new Error("Server rejected the post");
        
        // Reset Everything
        localStorage.removeItem('pixelDraft');
        titleInput.value = ''; bodyInput.value = ''; 
        if(driveLinkInput) driveLinkInput.value = '';
        attachedFile = null; document.getElementById('file-upload').value = '';
        hasDrawn = false; previewBox.style.display = 'none'; 
        if (retroToggleBox) retroToggleBox.style.display = 'none'; 
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
        currentScale = 1; canvas.style.transform = `scale(1)`; zoomLevelDisplay.textContent = `100%`;
        createModal.style.display = 'none';

        loadPosts(); 
        
    } catch (error) {
        alert(error.message);
        console.error(error);
    } finally {
        submitBtn.textContent = "Post";
        submitBtn.disabled = false;
    }
});

// Initialize app on load
window.onload = () => loadPosts();
