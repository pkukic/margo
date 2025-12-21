/**
 * Margo - AI PDF Reader and Annotator
 * Main Renderer Module
 */

// Import PDF.js as ES module
import * as pdfjsLib from './node_modules/pdfjs-dist/build/pdf.mjs';

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = './node_modules/pdfjs-dist/build/pdf.worker.mjs';

// App State
const state = {
    // PDF state
    pdfDoc: null,
    pdfPath: null,
    currentPage: 1,
    totalPages: 0,
    scale: 1.5,
    
    // Screenshot mode
    isScreenshotMode: false,
    selectionStart: null,
    selectionEnd: null,
    isSelecting: false,
    
    // Annotations and chat
    annotations: {},
    currentAnnotationId: null,
    
    // Backend connection
    backendUrl: 'http://127.0.0.1:8765',
    isConnected: false,
    
    // AI Model selection
    providers: [],
    currentProvider: null,
    currentModel: null
};

// DOM Elements
const elements = {
    // Toolbar
    btnOpen: document.getElementById('btn-open'),
    btnOpenWelcome: document.getElementById('btn-open-welcome'),
    fileName: document.getElementById('file-name'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    pageInfo: document.getElementById('page-info'),
    btnZoomIn: document.getElementById('btn-zoom-in'),
    btnZoomOut: document.getElementById('btn-zoom-out'),
    btnFit: document.getElementById('btn-fit'),
    zoomLevel: document.getElementById('zoom-level'),
    btnScreenshot: document.getElementById('btn-screenshot'),
    connectionStatus: document.getElementById('connection-status'),
    providerSelect: document.getElementById('provider-select'),
    modelSelect: document.getElementById('model-select'),
    
    // PDF Viewer
    pdfContainer: document.getElementById('pdf-container'),
    pdfViewer: document.getElementById('pdf-viewer'),
    pdfCanvas: document.getElementById('pdf-canvas'),
    welcomeMessage: document.getElementById('welcome-message'),
    selectionOverlay: document.getElementById('selection-overlay'),
    selectionBox: document.getElementById('selection-box'),
    
    // Sidebar
    annotationsList: document.getElementById('annotations-list'),
    noAnnotations: document.getElementById('no-annotations'),
    
    // Chat Panel
    chatPanel: document.getElementById('chat-panel'),
    btnCloseChat: document.getElementById('btn-close-chat'),
    btnDeleteAnnotation: document.getElementById('btn-delete-annotation'),
    chatTitle: document.getElementById('chat-title'),
    chatPreview: document.getElementById('chat-preview'),
    chatPreviewImage: document.getElementById('chat-preview-image'),
    chatPreviewText: document.getElementById('chat-preview-text'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input'),
    btnSend: document.getElementById('btn-send'),
    
    // Loading
    loadingOverlay: document.getElementById('loading-overlay'),
    loadingText: document.getElementById('loading-text')
};

// ============================================
// Utility Functions
// ============================================

function showLoading(text = 'Loading...') {
    elements.loadingText.textContent = text;
    elements.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    elements.loadingOverlay.classList.add('hidden');
}

function generateId() {
    return 'ann_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Markdown and LaTeX rendering
function renderMarkdown(text) {
    // First, protect LaTeX expressions
    const latexBlocks = [];
    const latexInline = [];
    
    // Extract display math ($$...$$)
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, latex) => {
        latexBlocks.push(latex);
        return `%%LATEX_BLOCK_${latexBlocks.length - 1}%%`;
    });
    
    // Extract inline math ($...$)
    text = text.replace(/\$([^\$\n]+?)\$/g, (match, latex) => {
        latexInline.push(latex);
        return `%%LATEX_INLINE_${latexInline.length - 1}%%`;
    });
    
    // Parse markdown
    let html = marked.parse(text);
    
    // Restore LaTeX blocks
    html = html.replace(/%%LATEX_BLOCK_(\d+)%%/g, (match, index) => {
        try {
            return katex.renderToString(latexBlocks[parseInt(index)], {
                displayMode: true,
                throwOnError: false
            });
        } catch (e) {
            return `<pre class="latex-error">${latexBlocks[parseInt(index)]}</pre>`;
        }
    });
    
    // Restore inline LaTeX
    html = html.replace(/%%LATEX_INLINE_(\d+)%%/g, (match, index) => {
        try {
            return katex.renderToString(latexInline[parseInt(index)], {
                displayMode: false,
                throwOnError: false
            });
        } catch (e) {
            return `<code class="latex-error">${latexInline[parseInt(index)]}</code>`;
        }
    });
    
    return html;
}

// ============================================
// Backend Communication
// ============================================

async function checkBackendConnection() {
    try {
        const response = await fetch(`${state.backendUrl}/health`);
        const data = await response.json();
        state.isConnected = data.status === 'ok';
        updateConnectionStatus();
        
        // If connected, load available providers and models
        if (state.isConnected) {
            await loadProviders();
        }
        
        return state.isConnected;
    } catch (e) {
        state.isConnected = false;
        updateConnectionStatus();
        return false;
    }
}

async function loadProviders() {
    try {
        const response = await fetch(`${state.backendUrl}/providers`);
        const data = await response.json();
        state.providers = data.providers || [];
        
        // Get current model
        const currentResponse = await fetch(`${state.backendUrl}/current-model`);
        const currentData = await currentResponse.json();
        state.currentProvider = currentData.provider;
        state.currentModel = currentData.model;
        
        updateProviderDropdowns();
    } catch (e) {
        console.error('Failed to load providers:', e);
    }
}

function updateProviderDropdowns() {
    const providerSelect = elements.providerSelect;
    const modelSelect = elements.modelSelect;
    
    // Clear existing options
    providerSelect.innerHTML = '';
    modelSelect.innerHTML = '';
    
    if (state.providers.length === 0) {
        providerSelect.innerHTML = '<option value="">No providers</option>';
        modelSelect.innerHTML = '<option value="">No models</option>';
        return;
    }
    
    // Populate provider dropdown
    for (const provider of state.providers) {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        if (provider.id === state.currentProvider) {
            option.selected = true;
        }
        providerSelect.appendChild(option);
    }
    
    // Populate models for the selected provider
    updateModelDropdown();
}

function updateModelDropdown() {
    const modelSelect = elements.modelSelect;
    const selectedProvider = elements.providerSelect.value;
    
    modelSelect.innerHTML = '';
    
    const provider = state.providers.find(p => p.id === selectedProvider);
    if (!provider) return;
    
    for (const model of provider.models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        option.title = model.description;
        if (model.id === state.currentModel) {
            option.selected = true;
        }
        modelSelect.appendChild(option);
    }
}

async function setModel(provider, modelId) {
    try {
        const response = await fetch(`${state.backendUrl}/set-model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, model_id: modelId })
        });
        
        if (response.ok) {
            state.currentProvider = provider;
            state.currentModel = modelId;
            console.log(`Model set to ${provider}/${modelId}`);
        }
    } catch (e) {
        console.error('Failed to set model:', e);
    }
}

function updateConnectionStatus() {
    if (state.isConnected) {
        elements.connectionStatus.classList.remove('disconnected');
        elements.connectionStatus.classList.add('connected');
        elements.connectionStatus.querySelector('.status-text').textContent = 'Connected';
    } else {
        elements.connectionStatus.classList.remove('connected');
        elements.connectionStatus.classList.add('disconnected');
        elements.connectionStatus.querySelector('.status-text').textContent = 'Disconnected';
    }
}

async function apiRequest(endpoint, data) {
    const response = await fetch(`${state.backendUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'API request failed');
    }
    
    return response.json();
}

// ============================================
// PDF Loading and Rendering
// ============================================

async function loadPDF(filePath) {
    showLoading('Loading PDF...');
    
    try {
        // Read file as buffer
        const buffer = await window.electronAPI.readFileBuffer(filePath);
        if (!buffer) {
            throw new Error('Failed to read PDF file');
        }
        
        // Convert to Uint8Array
        const uint8Array = new Uint8Array(buffer);
        
        // Load PDF document
        state.pdfDoc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
        state.pdfPath = filePath;
        state.totalPages = state.pdfDoc.numPages;
        state.currentPage = 1;
        
        // Update UI
        const pathInfo = await window.electronAPI.getPathInfo(filePath);
        elements.fileName.textContent = pathInfo.basename;
        elements.welcomeMessage.classList.add('hidden');
        elements.pdfCanvas.style.display = 'block';
        
        // Load existing chat data
        await loadChatData();
        
        // Render first page
        await renderPage(state.currentPage);
        
        hideLoading();
    } catch (error) {
        console.error('Error loading PDF:', error);
        hideLoading();
        alert('Failed to load PDF: ' + error.message);
    }
}

async function renderPage(pageNum) {
    if (!state.pdfDoc) return;
    
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.scale });
    
    const canvas = elements.pdfCanvas;
    const context = canvas.getContext('2d');
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;
    
    // Update page info
    elements.pageInfo.textContent = `Page ${pageNum} / ${state.totalPages}`;
    elements.zoomLevel.textContent = `${Math.round(state.scale * 100)}%`;
    
    // Update button states
    elements.btnPrev.disabled = pageNum <= 1;
    elements.btnNext.disabled = pageNum >= state.totalPages;
    
    // Update annotations display
    updateAnnotationsList();
}

// ============================================
// Chat Data Persistence
// ============================================

async function loadChatData() {
    if (!state.pdfPath) return;
    
    try {
        const result = await apiRequest('/load-chat', { pdf_path: state.pdfPath });
        if (result.chat_data) {
            state.annotations = {};
            for (const [id, annotation] of Object.entries(result.chat_data.annotations || {})) {
                state.annotations[id] = annotation;
            }
            updateAnnotationsList();
        }
    } catch (e) {
        console.log('No existing chat data or backend unavailable');
    }
}

async function saveChatData() {
    if (!state.pdfPath) return;
    
    try {
        await apiRequest('/save-chat', { pdf_path: state.pdfPath });
    } catch (e) {
        console.error('Failed to save chat data:', e);
    }
}

// ============================================
// Screenshot Selection
// ============================================

function enableScreenshotMode() {
    state.isScreenshotMode = true;
    elements.btnScreenshot.classList.add('active');
    elements.selectionOverlay.classList.remove('hidden');
}

function disableScreenshotMode() {
    state.isScreenshotMode = false;
    elements.btnScreenshot.classList.remove('active');
    elements.selectionOverlay.classList.add('hidden');
    elements.selectionBox.style.display = 'none';
    state.selectionStart = null;
    state.selectionEnd = null;
}

function handleSelectionStart(e) {
    if (!state.isScreenshotMode) return;
    
    const rect = elements.selectionOverlay.getBoundingClientRect();
    state.selectionStart = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    state.isSelecting = true;
    elements.selectionBox.style.display = 'block';
    updateSelectionBox(e);
}

function handleSelectionMove(e) {
    if (!state.isSelecting) return;
    updateSelectionBox(e);
}

function updateSelectionBox(e) {
    const rect = elements.selectionOverlay.getBoundingClientRect();
    state.selectionEnd = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    
    const left = Math.min(state.selectionStart.x, state.selectionEnd.x);
    const top = Math.min(state.selectionStart.y, state.selectionEnd.y);
    const width = Math.abs(state.selectionEnd.x - state.selectionStart.x);
    const height = Math.abs(state.selectionEnd.y - state.selectionStart.y);
    
    elements.selectionBox.style.left = left + 'px';
    elements.selectionBox.style.top = top + 'px';
    elements.selectionBox.style.width = width + 'px';
    elements.selectionBox.style.height = height + 'px';
}

async function handleSelectionEnd(e) {
    if (!state.isSelecting) return;
    state.isSelecting = false;
    
    // Calculate bounding box
    const left = Math.min(state.selectionStart.x, state.selectionEnd.x);
    const top = Math.min(state.selectionStart.y, state.selectionEnd.y);
    const width = Math.abs(state.selectionEnd.x - state.selectionStart.x);
    const height = Math.abs(state.selectionEnd.y - state.selectionStart.y);
    
    // Minimum size check
    if (width < 20 || height < 20) {
        elements.selectionBox.style.display = 'none';
        return;
    }
    
    // Capture the selected area from the canvas
    const imageData = captureCanvasRegion(left, top, width, height);
    
    // Create new annotation
    const annotationId = generateId();
    const boundingBox = {
        x: left / state.scale,
        y: top / state.scale,
        width: width / state.scale,
        height: height / state.scale,
        scale: state.scale
    };
    
    state.annotations[annotationId] = {
        id: annotationId,
        page_number: state.currentPage,
        bounding_box: boundingBox,
        image_base64: imageData,
        messages: [],
        created_at: new Date().toISOString()
    };
    
    // Update UI and open chat
    updateAnnotationsList();
    openAnnotationChat(annotationId);
    
    // Disable screenshot mode
    disableScreenshotMode();
}

function captureCanvasRegion(x, y, width, height) {
    // Account for scroll position of the PDF container
    const containerRect = elements.pdfContainer.getBoundingClientRect();
    const canvasRect = elements.pdfCanvas.getBoundingClientRect();
    
    // Calculate position relative to canvas
    const canvasX = x - (canvasRect.left - containerRect.left) + elements.pdfContainer.scrollLeft;
    const canvasY = y - (canvasRect.top - containerRect.top) + elements.pdfContainer.scrollTop;
    
    // Create temporary canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw the region
    tempCtx.drawImage(
        elements.pdfCanvas,
        canvasX, canvasY, width, height,
        0, 0, width, height
    );
    
    // Convert to base64
    return tempCanvas.toDataURL('image/png').split(',')[1];
}

// ============================================
// Annotations List
// ============================================

function updateAnnotationsList() {
    const annotations = Object.values(state.annotations);
    
    if (annotations.length === 0) {
        elements.noAnnotations.classList.remove('hidden');
        elements.annotationsList.innerHTML = '';
        elements.annotationsList.appendChild(elements.noAnnotations);
        return;
    }
    
    elements.noAnnotations.classList.add('hidden');
    elements.annotationsList.innerHTML = '';
    
    // Sort by page number, then by creation time
    annotations.sort((a, b) => {
        if (a.page_number !== b.page_number) {
            return a.page_number - b.page_number;
        }
        return new Date(a.created_at) - new Date(b.created_at);
    });
    
    for (const annotation of annotations) {
        const card = createAnnotationCard(annotation);
        elements.annotationsList.appendChild(card);
    }
}

function createAnnotationCard(annotation) {
    const card = document.createElement('div');
    card.className = 'annotation-card';
    card.dataset.id = annotation.id;
    
    if (annotation.id === state.currentAnnotationId) {
        card.classList.add('active');
    }
    
    // Preview image
    let previewHtml = '';
    if (annotation.image_base64) {
        previewHtml = `<img class="annotation-preview-image" src="data:image/png;base64,${annotation.image_base64}" alt="Selection">`;
    } else if (annotation.selected_text) {
        previewHtml = `<p class="annotation-preview">${escapeHtml(annotation.selected_text)}</p>`;
    }
    
    // First message preview
    let firstQuestion = 'No questions yet';
    if (annotation.messages && annotation.messages.length > 0) {
        const userMessages = annotation.messages.filter(m => m.role === 'user');
        if (userMessages.length > 0) {
            firstQuestion = userMessages[0].content.substring(0, 100);
            if (userMessages[0].content.length > 100) firstQuestion += '...';
        }
    }
    
    const messageCount = annotation.messages ? annotation.messages.length : 0;
    
    card.innerHTML = `
        <div class="annotation-card-header">
            <span class="annotation-page">Page ${annotation.page_number}</span>
        </div>
        ${previewHtml}
        <p class="annotation-preview">${escapeHtml(firstQuestion)}</p>
        <p class="annotation-message-count">${messageCount} message${messageCount !== 1 ? 's' : ''}</p>
    `;
    
    card.addEventListener('click', () => openAnnotationChat(annotation.id));
    
    return card;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================
// Chat Panel
// ============================================

function openAnnotationChat(annotationId) {
    const annotation = state.annotations[annotationId];
    if (!annotation) return;
    
    state.currentAnnotationId = annotationId;
    
    // Update active state in annotations list
    document.querySelectorAll('.annotation-card').forEach(card => {
        card.classList.toggle('active', card.dataset.id === annotationId);
    });
    
    // Update chat panel
    elements.chatTitle.textContent = `Page ${annotation.page_number} Annotation`;
    
    // Show preview
    if (annotation.image_base64) {
        elements.chatPreviewImage.src = `data:image/png;base64,${annotation.image_base64}`;
        elements.chatPreviewImage.style.display = 'block';
        elements.chatPreviewText.style.display = 'none';
    } else if (annotation.selected_text) {
        elements.chatPreviewText.textContent = annotation.selected_text;
        elements.chatPreviewText.style.display = 'block';
        elements.chatPreviewImage.style.display = 'none';
    }
    
    // Render messages
    renderChatMessages(annotation.messages || []);
    
    // Show chat panel
    elements.chatPanel.classList.remove('hidden');
    
    // Focus input
    elements.chatInput.focus();
    
    // Jump to page if different
    if (annotation.page_number !== state.currentPage) {
        state.currentPage = annotation.page_number;
        renderPage(state.currentPage);
    }
}

function closeChatPanel() {
    elements.chatPanel.classList.add('hidden');
    state.currentAnnotationId = null;
    
    // Remove active state from cards
    document.querySelectorAll('.annotation-card').forEach(card => {
        card.classList.remove('active');
    });
}

function renderChatMessages(messages) {
    elements.chatMessages.innerHTML = '';
    
    for (const message of messages) {
        const messageEl = createMessageElement(message);
        elements.chatMessages.appendChild(messageEl);
    }
    
    // Scroll to bottom
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function createMessageElement(message) {
    const div = document.createElement('div');
    div.className = `chat-message ${message.role}`;
    div.dataset.id = message.id;
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    if (message.role === 'assistant') {
        content.innerHTML = renderMarkdown(message.content);
    } else {
        content.textContent = message.content;
    }
    
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    
    if (message.role === 'user') {
        actions.innerHTML = `
            <button class="edit" onclick="editMessage('${message.id}')">Edit</button>
            <button class="delete" onclick="deleteMessage('${message.id}')">Delete</button>
        `;
    } else {
        actions.innerHTML = `
            <button class="delete" onclick="deleteMessage('${message.id}')">Delete</button>
        `;
    }
    
    div.appendChild(content);
    div.appendChild(actions);
    
    return div;
}

function addTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'chat-message assistant';
    div.id = 'typing-indicator';
    
    div.innerHTML = `
        <div class="message-content">
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    
    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

// ============================================
// Chat Actions
// ============================================

async function sendMessage() {
    const question = elements.chatInput.value.trim();
    if (!question || !state.currentAnnotationId) return;
    
    const annotation = state.annotations[state.currentAnnotationId];
    if (!annotation) return;
    
    // Check backend connection
    if (!state.isConnected) {
        const connected = await checkBackendConnection();
        if (!connected) {
            alert('Backend is not connected. Please make sure the Python server is running.');
            return;
        }
    }
    
    // Clear input
    elements.chatInput.value = '';
    
    // Add user message to UI immediately
    const userMessageId = generateId();
    const userMessage = {
        id: userMessageId,
        role: 'user',
        content: question,
        timestamp: new Date().toISOString()
    };
    
    if (!annotation.messages) {
        annotation.messages = [];
    }
    annotation.messages.push(userMessage);
    renderChatMessages(annotation.messages);
    
    // Show typing indicator
    addTypingIndicator();
    
    // Disable send button
    elements.btnSend.disabled = true;
    
    try {
        // Build chat history (without the current message)
        const chatHistory = annotation.messages.slice(0, -1).map(m => ({
            role: m.role,
            content: m.content
        }));
        
        // Send to backend
        const response = await apiRequest('/ask', {
            pdf_path: state.pdfPath,
            annotation_id: annotation.id,
            question: question,
            image_base64: annotation.image_base64 || null,
            bounding_box: annotation.bounding_box || null,
            selected_text: annotation.selected_text || null,
            page_number: annotation.page_number,
            chat_history: chatHistory.length > 0 ? chatHistory : null
        });
        
        // Remove typing indicator
        removeTypingIndicator();
        
        // Add assistant message
        const assistantMessage = {
            id: response.assistant_message_id,
            role: 'assistant',
            content: response.response,
            timestamp: new Date().toISOString()
        };
        annotation.messages.push(assistantMessage);
        
        // Update local message IDs from server
        if (response.user_message_id) {
            userMessage.id = response.user_message_id;
        }
        
        // Re-render messages
        renderChatMessages(annotation.messages);
        updateAnnotationsList();
        
    } catch (error) {
        removeTypingIndicator();
        console.error('Error sending message:', error);
        
        // Show error in chat
        const errorMessage = {
            id: generateId(),
            role: 'assistant',
            content: `Error: ${error.message}`,
            timestamp: new Date().toISOString()
        };
        annotation.messages.push(errorMessage);
        renderChatMessages(annotation.messages);
    }
    
    elements.btnSend.disabled = false;
}

// Make these functions global for onclick handlers
window.editMessage = async function(messageId) {
    const annotation = state.annotations[state.currentAnnotationId];
    if (!annotation) return;
    
    const message = annotation.messages.find(m => m.id === messageId);
    if (!message) return;
    
    // Find message element
    const messageEl = document.querySelector(`.chat-message[data-id="${messageId}"]`);
    if (!messageEl) return;
    
    const contentEl = messageEl.querySelector('.message-content');
    const originalContent = message.content;
    
    // Replace with edit form
    contentEl.innerHTML = `
        <div class="message-edit-container">
            <textarea class="message-edit-textarea">${escapeHtml(originalContent)}</textarea>
            <div class="message-edit-actions">
                <button class="cancel-btn">Cancel</button>
                <button class="save-btn">Save</button>
            </div>
        </div>
    `;
    
    const textarea = contentEl.querySelector('.message-edit-textarea');
    const cancelBtn = contentEl.querySelector('.cancel-btn');
    const saveBtn = contentEl.querySelector('.save-btn');
    
    textarea.focus();
    
    cancelBtn.addEventListener('click', () => {
        renderChatMessages(annotation.messages);
    });
    
    saveBtn.addEventListener('click', async () => {
        const newContent = textarea.value.trim();
        if (!newContent) return;
        
        try {
            await apiRequest('/edit-message', {
                pdf_path: state.pdfPath,
                annotation_id: annotation.id,
                message_id: messageId,
                new_content: newContent
            });
            
            message.content = newContent;
            renderChatMessages(annotation.messages);
            updateAnnotationsList();
        } catch (error) {
            console.error('Failed to edit message:', error);
            alert('Failed to edit message: ' + error.message);
        }
    });
};

window.deleteMessage = async function(messageId) {
    const annotation = state.annotations[state.currentAnnotationId];
    if (!annotation) return;
    
    if (!confirm('Are you sure you want to delete this message?')) return;
    
    try {
        await apiRequest('/delete-message', {
            pdf_path: state.pdfPath,
            annotation_id: annotation.id,
            message_id: messageId
        });
        
        annotation.messages = annotation.messages.filter(m => m.id !== messageId);
        renderChatMessages(annotation.messages);
        updateAnnotationsList();
    } catch (error) {
        console.error('Failed to delete message:', error);
        alert('Failed to delete message: ' + error.message);
    }
};

async function deleteCurrentAnnotation() {
    if (!state.currentAnnotationId) return;
    
    if (!confirm('Are you sure you want to delete this annotation and all its messages?')) return;
    
    try {
        await apiRequest('/delete-annotation', {
            pdf_path: state.pdfPath,
            annotation_id: state.currentAnnotationId
        });
        
        delete state.annotations[state.currentAnnotationId];
        closeChatPanel();
        updateAnnotationsList();
    } catch (error) {
        console.error('Failed to delete annotation:', error);
        alert('Failed to delete annotation: ' + error.message);
    }
}

// ============================================
// Navigation and Zoom
// ============================================

function prevPage() {
    if (state.currentPage > 1) {
        state.currentPage--;
        renderPage(state.currentPage);
    }
}

function nextPage() {
    if (state.currentPage < state.totalPages) {
        state.currentPage++;
        renderPage(state.currentPage);
    }
}

function zoomIn() {
    state.scale = Math.min(state.scale + 0.25, 4);
    renderPage(state.currentPage);
}

function zoomOut() {
    state.scale = Math.max(state.scale - 0.25, 0.5);
    renderPage(state.currentPage);
}

function fitToWidth() {
    if (!state.pdfDoc) return;
    
    // Calculate scale to fit container width
    const containerWidth = elements.pdfContainer.clientWidth - 40; // padding
    
    state.pdfDoc.getPage(state.currentPage).then(page => {
        const viewport = page.getViewport({ scale: 1 });
        state.scale = containerWidth / viewport.width;
        renderPage(state.currentPage);
    });
}

// ============================================
// File Opening
// ============================================

async function openFile() {
    const filePath = await window.electronAPI.openFileDialog();
    if (filePath) {
        loadPDF(filePath);
    }
}

// ============================================
// Event Listeners
// ============================================

function initEventListeners() {
    // Toolbar buttons
    elements.btnOpen.addEventListener('click', openFile);
    elements.btnOpenWelcome.addEventListener('click', openFile);
    elements.btnPrev.addEventListener('click', prevPage);
    elements.btnNext.addEventListener('click', nextPage);
    elements.btnZoomIn.addEventListener('click', zoomIn);
    elements.btnZoomOut.addEventListener('click', zoomOut);
    elements.btnFit.addEventListener('click', fitToWidth);
    
    // Model selection
    elements.providerSelect.addEventListener('change', () => {
        updateModelDropdown();
        const provider = elements.providerSelect.value;
        const model = elements.modelSelect.value;
        if (provider && model) {
            setModel(provider, model);
        }
    });
    
    elements.modelSelect.addEventListener('change', () => {
        const provider = elements.providerSelect.value;
        const model = elements.modelSelect.value;
        if (provider && model) {
            setModel(provider, model);
        }
    });
    
    // Screenshot mode
    elements.btnScreenshot.addEventListener('click', () => {
        if (state.isScreenshotMode) {
            disableScreenshotMode();
        } else {
            enableScreenshotMode();
        }
    });
    
    // Selection overlay
    elements.selectionOverlay.addEventListener('mousedown', handleSelectionStart);
    elements.selectionOverlay.addEventListener('mousemove', handleSelectionMove);
    elements.selectionOverlay.addEventListener('mouseup', handleSelectionEnd);
    
    // Chat panel
    elements.btnCloseChat.addEventListener('click', closeChatPanel);
    elements.btnDeleteAnnotation.addEventListener('click', deleteCurrentAnnotation);
    elements.btnSend.addEventListener('click', sendMessage);
    
    elements.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
        
        switch (e.key) {
            case 'o':
                if (e.ctrlKey) {
                    e.preventDefault();
                    openFile();
                }
                break;
            case 's':
                if (!e.ctrlKey) {
                    if (state.pdfDoc) {
                        if (state.isScreenshotMode) {
                            disableScreenshotMode();
                        } else {
                            enableScreenshotMode();
                        }
                    }
                }
                break;
            case 'Escape':
                if (state.isScreenshotMode) {
                    disableScreenshotMode();
                } else if (!elements.chatPanel.classList.contains('hidden')) {
                    closeChatPanel();
                }
                break;
            case 'ArrowLeft':
                prevPage();
                break;
            case 'ArrowRight':
                nextPage();
                break;
            case '+':
            case '=':
                zoomIn();
                break;
            case '-':
                zoomOut();
                break;
        }
    });
    
    // Connection status click to retry
    elements.connectionStatus.addEventListener('click', checkBackendConnection);
}

// ============================================
// Initialization
// ============================================

async function init() {
    initEventListeners();
    
    // Check backend connection
    await checkBackendConnection();
    
    // Retry connection every 5 seconds if disconnected
    setInterval(() => {
        if (!state.isConnected) {
            checkBackendConnection();
        }
    }, 5000);
}

// Start the app
init();
