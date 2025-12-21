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
    renderScale: 2.0,  // Fixed high-res render scale for quality
    zoomLevel: 1.0,    // Visual zoom level (CSS transform)
    
    // Screenshot mode
    isScreenshotMode: false,
    selectionStart: null,
    selectionEnd: null,
    isSelecting: false,
    
    // Highlight/text selection mode
    isHighlightMode: false,
    
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
    btnResetZoom: document.getElementById('btn-reset-zoom'),
    zoomLevel: document.getElementById('zoom-level'),
    btnScreenshot: document.getElementById('btn-screenshot'),
    btnHighlight: document.getElementById('btn-highlight'),
    connectionStatus: document.getElementById('connection-status'),
    providerSelect: document.getElementById('provider-select'),
    modelSelect: document.getElementById('model-select'),
    
    // PDF Viewer
    pdfContainer: document.getElementById('pdf-container'),
    pdfViewer: document.getElementById('pdf-viewer'),
    pagesContainer: document.getElementById('pages-container'),
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
        
        // If we already have a saved model preference, use it and sync to backend
        if (state.currentProvider && state.currentModel) {
            // Verify the saved model still exists
            const provider = state.providers.find(p => p.id === state.currentProvider);
            const modelExists = provider && provider.models.some(m => m.id === state.currentModel);
            
            if (modelExists) {
                // Sync saved model to backend
                await setModel(state.currentProvider, state.currentModel);
            } else {
                // Saved model no longer exists, fall back to backend's current
                const currentResponse = await fetch(`${state.backendUrl}/current-model`);
                const currentData = await currentResponse.json();
                state.currentProvider = currentData.provider;
                state.currentModel = currentData.model;
            }
        } else {
            // No saved preference, get current model from backend
            const currentResponse = await fetch(`${state.backendUrl}/current-model`);
            const currentData = await currentResponse.json();
            state.currentProvider = currentData.provider;
            state.currentModel = currentData.model;
        }
        
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
            
            // Save model preference
            await window.electronAPI.updateSetting('lastModel', { provider, modelId });
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

async function loadPDF(filePath, restoreState = null) {
    showLoading('Loading PDF...');
    
    try {
        // Check if file exists
        const exists = await window.electronAPI.fileExists(filePath);
        if (!exists) {
            throw new Error('File not found');
        }
        
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
        elements.pagesContainer.innerHTML = '';
        elements.pagesContainer.style.display = 'block';
        
        // Restore zoom level if provided
        if (restoreState && restoreState.zoomLevel) {
            state.zoomLevel = restoreState.zoomLevel;
        }
        
        // Load existing chat data
        await loadChatData();
        
        // Render all pages for continuous scrolling
        await renderAllPages();
        
        // Setup scroll listener for page tracking
        setupScrollListener();
        
        // Restore scroll position if provided
        if (restoreState && restoreState.scrollTop !== undefined) {
            setTimeout(() => {
                elements.pdfContainer.scrollTop = restoreState.scrollTop;
            }, 100);
        }
        
        // Save as last opened PDF
        await window.electronAPI.updateSetting('lastPDF', filePath);
        
        hideLoading();
    } catch (error) {
        console.error('Error loading PDF:', error);
        hideLoading();
        // Only show alert if not restoring (don't annoy user on startup)
        if (!restoreState) {
            alert('Failed to load PDF: ' + error.message);
        }
    }
}
async function renderAllPages() {
    if (!state.pdfDoc) return;
    
    const dpr = window.devicePixelRatio || 1;
    
    for (let pageNum = 1; pageNum <= state.totalPages; pageNum++) {
        const page = await state.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: state.renderScale });
        
        // Create wrapper div for this page
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'pdf-page-wrapper';
        pageWrapper.dataset.pageNum = pageNum;
        pageWrapper.style.width = Math.floor(viewport.width) + 'px';
        pageWrapper.style.height = Math.floor(viewport.height) + 'px';
        
        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-page-canvas';
        canvas.dataset.pageNum = pageNum;
        
        // Set canvas dimensions for high DPI
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        
        // Set CSS dimensions (actual display size)
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';
        
        const context = canvas.getContext('2d');
        context.scale(dpr, dpr);
        
        pageWrapper.appendChild(canvas);
        
        // Create text layer for selectable text
        const textLayer = document.createElement('div');
        textLayer.className = 'text-layer';
        textLayer.dataset.pageNum = pageNum;
        pageWrapper.appendChild(textLayer);
        
        // Create link layer for clickable links
        const linkLayer = document.createElement('div');
        linkLayer.className = 'link-layer';
        linkLayer.dataset.pageNum = pageNum;
        pageWrapper.appendChild(linkLayer);
        
        // Add page number label
        const pageLabel = document.createElement('div');
        pageLabel.className = 'page-number-label';
        pageLabel.textContent = `Page ${pageNum}`;
        pageWrapper.appendChild(pageLabel);
        
        elements.pagesContainer.appendChild(pageWrapper);
        
        // Render page canvas
        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;
        
        // Render text layer
        const textContent = await page.getTextContent();
        renderTextLayer(textLayer, textContent, viewport);
        
        // Render link layer
        const annotations = await page.getAnnotations();
        renderLinkLayer(linkLayer, annotations, viewport, pageNum);
    }
    
    // Apply initial zoom
    applyZoom();
    
    // Update page info
    updatePageInfo(1);
}

function renderTextLayer(container, textContent, viewport) {
    container.innerHTML = '';
    
    for (const item of textContent.items) {
        const div = document.createElement('span');
        div.textContent = item.str;
        
        // Get the transform for positioning
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        
        // Calculate position and size
        const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
        const left = tx[4];
        const top = tx[5] - fontSize;
        
        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.fontSize = `${fontSize}px`;
        div.style.fontFamily = item.fontName || 'sans-serif';
        
        container.appendChild(div);
    }
}

function renderLinkLayer(container, annotations, viewport, pageNum) {
    container.innerHTML = '';
    
    for (const annotation of annotations) {
        // Only process link annotations
        if (annotation.subtype !== 'Link') continue;
        
        // Get the rectangle coordinates (in PDF coordinates)
        const rect = annotation.rect;
        if (!rect || rect.length !== 4) continue;
        
        // Transform PDF coordinates to viewport coordinates
        // PDF coordinates have origin at bottom-left, viewport at top-left
        const [x1, y1, x2, y2] = rect;
        
        // Convert using viewport transform
        const viewRect = viewport.convertToViewportRectangle(rect);
        
        // viewRect is [x1, y1, x2, y2] in viewport coordinates
        const left = Math.min(viewRect[0], viewRect[2]);
        const top = Math.min(viewRect[1], viewRect[3]);
        const width = Math.abs(viewRect[2] - viewRect[0]);
        const height = Math.abs(viewRect[3] - viewRect[1]);
        
        // Create link element
        const link = document.createElement('a');
        link.className = 'pdf-link';
        link.style.left = `${left}px`;
        link.style.top = `${top}px`;
        link.style.width = `${width}px`;
        link.style.height = `${height}px`;
        
        // Determine link type and set up click handler
        if (annotation.url) {
            // External URL link
            link.href = annotation.url;
            link.title = `Ctrl+Click to open: ${annotation.url}`;
            link.dataset.linkType = 'external';
            link.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.electronAPI.openExternal(annotation.url);
                } else {
                    e.preventDefault();
                }
            });
        } else if (annotation.dest) {
            // Internal destination link (named destination)
            link.href = '#';
            link.title = 'Click to jump to destination';
            link.dataset.linkType = 'internal';
            link.dataset.dest = typeof annotation.dest === 'string' 
                ? annotation.dest 
                : JSON.stringify(annotation.dest);
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await navigateToDestination(annotation.dest);
            });
        } else if (annotation.action && annotation.action.dest) {
            // GoTo action with destination
            link.href = '#';
            link.title = 'Click to jump to destination';
            link.dataset.linkType = 'internal';
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await navigateToDestination(annotation.action.dest);
            });
        } else if (annotation.action && annotation.action.url) {
            // URI action
            link.href = annotation.action.url;
            link.title = `Ctrl+Click to open: ${annotation.action.url}`;
            link.dataset.linkType = 'external';
            link.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    window.electronAPI.openExternal(annotation.action.url);
                } else {
                    e.preventDefault();
                }
            });
        } else {
            // Unknown link type, skip
            continue;
        }
        
        container.appendChild(link);
    }
}

async function navigateToDestination(dest) {
    if (!state.pdfDoc) return;
    
    try {
        let pageNum = 1;
        let destArray = dest;
        
        // If dest is a string (named destination), resolve it
        if (typeof dest === 'string') {
            destArray = await state.pdfDoc.getDestination(dest);
        }
        
        if (!destArray) return;
        
        // Get the page reference from the destination
        const pageRef = destArray[0];
        
        // Resolve the page index from the reference
        const pageIndex = await state.pdfDoc.getPageIndex(pageRef);
        pageNum = pageIndex + 1; // Convert to 1-based page number
        
        // Find the page wrapper and scroll to it
        const pageWrapper = elements.pagesContainer.querySelector(
            `.pdf-page-wrapper[data-page-num="${pageNum}"]`
        );
        
        if (pageWrapper) {
            // Get the destination type and coordinates
            const destType = destArray[1].name;
            let scrollTop = pageWrapper.offsetTop * state.zoomLevel;
            
            // Handle different destination types
            if (destType === 'XYZ' && destArray[3] !== null) {
                // XYZ destination: [page, /XYZ, left, top, zoom]
                // destArray[3] is the top coordinate in PDF space
                const page = await state.pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: state.renderScale });
                const pdfTop = destArray[3];
                // Convert from PDF coordinates (bottom-left origin) to viewport coordinates
                const viewportTop = viewport.height - (pdfTop * state.renderScale);
                scrollTop = (pageWrapper.offsetTop + viewportTop) * state.zoomLevel;
            } else if (destType === 'FitH' && destArray[2] !== null) {
                // FitH destination: [page, /FitH, top]
                const page = await state.pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: state.renderScale });
                const pdfTop = destArray[2];
                const viewportTop = viewport.height - (pdfTop * state.renderScale);
                scrollTop = (pageWrapper.offsetTop + viewportTop) * state.zoomLevel;
            }
            
            // Scroll to the destination
            elements.pdfContainer.scrollTo({
                top: scrollTop,
                behavior: 'smooth'
            });
        }
    } catch (error) {
        console.error('Failed to navigate to destination:', error);
    }
}

function applyZoom() {
    if (!elements.pagesContainer) return;
    
    elements.pagesContainer.style.transform = `scale(${state.zoomLevel})`;
    elements.pagesContainer.style.transformOrigin = 'top center';
    elements.zoomLevel.textContent = `${Math.round(state.zoomLevel * 100)}%`;
}

function applyZoomAtPoint(oldZoom, newZoom, clientX, clientY) {
    if (!elements.pagesContainer) return;
    
    const container = elements.pdfContainer;
    const containerRect = container.getBoundingClientRect();
    
    // Get the mouse position relative to the container
    const mouseX = clientX - containerRect.left;
    const mouseY = clientY - containerRect.top;
    
    // Calculate the scroll position before zoom
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;
    
    // Calculate the point in the content that's under the mouse
    const contentX = (scrollLeft + mouseX) / oldZoom;
    const contentY = (scrollTop + mouseY) / oldZoom;
    
    // Apply the new zoom
    state.zoomLevel = newZoom;
    elements.pagesContainer.style.transform = `scale(${state.zoomLevel})`;
    elements.pagesContainer.style.transformOrigin = 'top center';
    elements.zoomLevel.textContent = `${Math.round(state.zoomLevel * 100)}%`;
    
    // Calculate new scroll position to keep the same content point under the mouse
    const newScrollLeft = contentX * newZoom - mouseX;
    const newScrollTop = contentY * newZoom - mouseY;
    
    container.scrollLeft = newScrollLeft;
    container.scrollTop = newScrollTop;
}

async function renderPage(pageNum) {
    // For re-rendering a single page (e.g., after zoom change)
    if (!state.pdfDoc) return;
    
    const pageWrapper = elements.pagesContainer.querySelector(`[data-page-num="${pageNum}"]`);
    if (!pageWrapper) return;
    
    const canvas = pageWrapper.querySelector('canvas');
    if (!canvas) return;
    
    const dpr = window.devicePixelRatio || 1;
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.renderScale });
    
    // Set canvas dimensions for high DPI
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    
    // Set CSS dimensions (actual display size)
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    
    const context = canvas.getContext('2d');
    context.scale(dpr, dpr);
    
    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;
}

async function reRenderAllPages() {
    if (!state.pdfDoc) return;
    
    for (let pageNum = 1; pageNum <= state.totalPages; pageNum++) {
        await renderPage(pageNum);
    }
    updatePageInfo(state.currentPage);
}

function setupScrollListener() {
    elements.pdfContainer.addEventListener('scroll', () => {
        const scrollTop = elements.pdfContainer.scrollTop;
        const containerRect = elements.pdfContainer.getBoundingClientRect();
        const viewerCenter = scrollTop + containerRect.height / 2;
        
        // Find which page is most visible
        const pageWrappers = elements.pagesContainer.querySelectorAll('.pdf-page-wrapper');
        let currentPage = 1;
        
        for (const wrapper of pageWrappers) {
            const offsetTop = wrapper.offsetTop;
            const height = wrapper.offsetHeight;
            
            if (offsetTop + height / 2 > viewerCenter) {
                break;
            }
            currentPage = parseInt(wrapper.dataset.pageNum);
        }
        
        if (currentPage !== state.currentPage) {
            state.currentPage = currentPage;
            updatePageInfo(currentPage);
        }
    });
}

function updatePageInfo(pageNum) {
    elements.pageInfo.textContent = `Page ${pageNum} / ${state.totalPages}`;
    elements.zoomLevel.textContent = `${Math.round(state.zoomLevel * 100)}%`;
    
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

// ============================================
// Highlight/Text Selection Mode
// ============================================

function enableHighlightMode() {
    state.isHighlightMode = true;
    elements.btnHighlight.classList.add('active');
    // Add highlight-mode class to all text layers
    const textLayers = document.querySelectorAll('.text-layer');
    textLayers.forEach(layer => layer.classList.add('highlight-mode'));
}

function disableHighlightMode() {
    state.isHighlightMode = false;
    elements.btnHighlight.classList.remove('active');
    // Remove highlight-mode class from all text layers
    const textLayers = document.querySelectorAll('.text-layer');
    textLayers.forEach(layer => layer.classList.remove('highlight-mode'));
}

function getSelectedText() {
    const selection = window.getSelection();
    return selection ? selection.toString().trim() : '';
}

function createAnnotationFromSelection() {
    const selectedText = getSelectedText();
    if (!selectedText) return;
    
    // Find which page the selection is on
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const textLayer = range.startContainer.parentElement?.closest('.text-layer');
    const pageNum = textLayer ? parseInt(textLayer.dataset.pageNum) : state.currentPage;
    
    // Create annotation
    const annotationId = generateId();
    state.annotations[annotationId] = {
        id: annotationId,
        page_number: pageNum,
        selected_text: selectedText,
        image_base64: null,
        messages: [],
        created_at: new Date().toISOString()
    };
    
    // Clear selection
    selection.removeAllRanges();
    
    // Update UI and open chat
    updateAnnotationsList();
    openAnnotationChat(annotationId);
    
    // Disable highlight mode
    disableHighlightMode();
}

// Listen for text selection completion in highlight mode
document.addEventListener('mouseup', () => {
    if (state.isHighlightMode) {
        const selectedText = getSelectedText();
        if (selectedText) {
            createAnnotationFromSelection();
        }
    }
});

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
    
    // Calculate selection box in viewport/overlay coordinates
    const viewportLeft = Math.min(state.selectionStart.x, state.selectionEnd.x);
    const viewportTop = Math.min(state.selectionStart.y, state.selectionEnd.y);
    const width = Math.abs(state.selectionEnd.x - state.selectionStart.x);
    const height = Math.abs(state.selectionEnd.y - state.selectionStart.y);
    
    // Minimum size check
    if (width < 20 || height < 20) {
        elements.selectionBox.style.display = 'none';
        return;
    }
    
    // Selection center point in viewport coordinates
    const selectionCenterX = viewportLeft + width / 2;
    const selectionCenterY = viewportTop + height / 2;
    
    // Find the page wrapper that contains this selection by checking bounding rects
    const pageWrappers = elements.pagesContainer.querySelectorAll('.pdf-page-wrapper');
    let targetPage = null;
    let pageNum = 1;
    let pageRect = null;
    
    for (const wrapper of pageWrappers) {
        const rect = wrapper.getBoundingClientRect();
        
        if (selectionCenterY >= rect.top && selectionCenterY < rect.bottom &&
            selectionCenterX >= rect.left && selectionCenterX < rect.right) {
            targetPage = wrapper;
            pageNum = parseInt(wrapper.dataset.pageNum);
            pageRect = rect;
            break;
        }
    }
    
    if (!targetPage) {
        elements.selectionBox.style.display = 'none';
        return;
    }
    
    // Calculate position relative to the page (in viewport coordinates, then divide by zoom)
    const relativeLeft = (viewportLeft - pageRect.left) / state.zoomLevel;
    const relativeTop = (viewportTop - pageRect.top) / state.zoomLevel;
    const relativeWidth = width / state.zoomLevel;
    const relativeHeight = height / state.zoomLevel;
    
    // Capture the selected area from the canvas
    const containerRect = elements.pdfContainer.getBoundingClientRect();
    const imageData = captureCanvasRegion(viewportLeft, viewportTop, width, height, containerRect);
    
    // Create new annotation with coordinates relative to the page at renderScale
    const annotationId = generateId();
    const boundingBox = {
        x: relativeLeft / state.renderScale,
        y: relativeTop / state.renderScale,
        width: relativeWidth / state.renderScale,
        height: relativeHeight / state.renderScale
    };
    
    state.annotations[annotationId] = {
        id: annotationId,
        page_number: pageNum,
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

function captureCanvasRegion(viewportX, viewportY, width, height, containerRect) {
    // viewportX, viewportY are in viewport/screen coordinates
    const dpr = window.devicePixelRatio || 1;
    
    // Selection center point in viewport coordinates
    const selectionCenterX = viewportX + width / 2;
    const selectionCenterY = viewportY + height / 2;
    
    // Find the canvas at this position using bounding rects
    const pageWrappers = elements.pagesContainer.querySelectorAll('.pdf-page-wrapper');
    let targetCanvas = null;
    let canvasRect = null;
    
    for (const wrapper of pageWrappers) {
        const rect = wrapper.getBoundingClientRect();
        
        if (selectionCenterY >= rect.top && selectionCenterY < rect.bottom &&
            selectionCenterX >= rect.left && selectionCenterX < rect.right) {
            targetCanvas = wrapper.querySelector('canvas');
            canvasRect = targetCanvas.getBoundingClientRect();
            break;
        }
    }
    
    if (!targetCanvas) {
        // Fallback to first canvas
        targetCanvas = elements.pagesContainer.querySelector('canvas');
        canvasRect = targetCanvas.getBoundingClientRect();
    }
    
    // Calculate position relative to the canvas in viewport coordinates
    // Then convert to canvas pixel coordinates
    const canvasRelativeX = (viewportX - canvasRect.left) / state.zoomLevel;
    const canvasRelativeY = (viewportY - canvasRect.top) / state.zoomLevel;
    
    // Scale to actual canvas pixels (canvas is at renderScale resolution)
    const canvasX = canvasRelativeX * dpr;
    const canvasY = canvasRelativeY * dpr;
    const captureWidth = (width / state.zoomLevel) * dpr;
    const captureHeight = (height / state.zoomLevel) * dpr;
    
    // Create temporary canvas at display resolution (not scaled)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw the region
    tempCtx.drawImage(
        targetCanvas,
        canvasX, canvasY, captureWidth, captureHeight,
        0, 0, width, height
    );
    
    // Convert to base64
    return tempCanvas.toDataURL('image/png').split(',')[1];
}

// ============================================
// Annotation Overlays on PDF
// ============================================

function renderAnnotationOverlays() {
    // Remove existing overlays
    document.querySelectorAll('.annotation-overlay').forEach(el => el.remove());
    
    const annotations = Object.values(state.annotations);
    
    for (const annotation of annotations) {
        renderAnnotationOverlay(annotation);
    }
}

function renderAnnotationOverlay(annotation) {
    const pageWrapper = elements.pagesContainer.querySelector(
        `.pdf-page-wrapper[data-page-num="${annotation.page_number}"]`
    );
    if (!pageWrapper) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'annotation-overlay';
    overlay.dataset.annotationId = annotation.id;
    
    if (annotation.id === state.currentAnnotationId) {
        overlay.classList.add('active');
    }
    
    if (annotation.bounding_box) {
        // Screenshot annotation - draw bounding box
        overlay.classList.add('screenshot-annotation');
        
        const scale = state.renderScale;
        const box = annotation.bounding_box;
        
        overlay.style.left = (box.x * scale) + 'px';
        overlay.style.top = (box.y * scale) + 'px';
        overlay.style.width = (box.width * scale) + 'px';
        overlay.style.height = (box.height * scale) + 'px';
    } else if (annotation.selected_text) {
        // Text annotation - create a highlight marker
        // For text annotations we'll show a small indicator at the page
        overlay.classList.add('text-annotation');
        
        // Place at left side of page as a marker
        overlay.style.left = '5px';
        overlay.style.top = '50px';
        overlay.style.width = '20px';
        overlay.style.height = '20px';
        overlay.style.borderRadius = '50%';
        overlay.title = annotation.selected_text.substring(0, 100) + '...';
    }
    
    // Click handler to open the annotation
    overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        openAnnotationChat(annotation.id);
    });
    
    pageWrapper.appendChild(overlay);
}

function updateAnnotationOverlayStates() {
    // Update active state on all overlays
    document.querySelectorAll('.annotation-overlay').forEach(overlay => {
        if (overlay.dataset.annotationId === state.currentAnnotationId) {
            overlay.classList.add('active');
        } else {
            overlay.classList.remove('active');
        }
    });
}

function scrollToAnnotation(annotation) {
    const pageWrapper = elements.pagesContainer.querySelector(
        `.pdf-page-wrapper[data-page-num="${annotation.page_number}"]`
    );
    if (!pageWrapper) return;
    
    if (annotation.bounding_box) {
        // Scroll to the bounding box
        const box = annotation.bounding_box;
        const scale = state.renderScale * state.zoomLevel;
        const targetY = pageWrapper.offsetTop + (box.y * state.renderScale * state.zoomLevel);
        
        elements.pdfContainer.scrollTo({
            top: targetY - 100, // Offset to show some context above
            behavior: 'smooth'
        });
    } else {
        // Scroll to the page
        pageWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// ============================================
// Annotations List
// ============================================

function updateAnnotationsList() {
    const annotations = Object.values(state.annotations);
    
    // Also update overlays on PDF
    renderAnnotationOverlays();
    
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
    
    card.addEventListener('click', () => {
        // Scroll to the annotation location in the PDF
        scrollToAnnotation(annotation);
        // Open the chat panel
        openAnnotationChat(annotation.id);
    });
    
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
    
    // Update active state on overlays
    updateAnnotationOverlayStates();
    
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
}

function closeChatPanel() {
    elements.chatPanel.classList.add('hidden');
    state.currentAnnotationId = null;
    
    // Remove active state from cards
    document.querySelectorAll('.annotation-card').forEach(card => {
        card.classList.remove('active');
    });
    
    // Remove active state from overlays
    updateAnnotationOverlayStates();
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

function scrollToPage(pageNum) {
    const pageWrapper = elements.pagesContainer.querySelector(`[data-page-num="${pageNum}"]`);
    if (pageWrapper) {
        pageWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function prevPage() {
    if (state.currentPage > 1) {
        state.currentPage--;
        scrollToPage(state.currentPage);
        updatePageInfo(state.currentPage);
    }
}

function nextPage() {
    if (state.currentPage < state.totalPages) {
        state.currentPage++;
        scrollToPage(state.currentPage);
        updatePageInfo(state.currentPage);
    }
}

function zoomIn() {
    state.zoomLevel = Math.min(state.zoomLevel + 0.1, 3);
    applyZoom();
}

function zoomOut() {
    state.zoomLevel = Math.max(state.zoomLevel - 0.1, 0.25);
    applyZoom();
}

function fitToWidth() {
    if (!state.pdfDoc) return;
    
    // Calculate zoom to fit container width
    const containerWidth = elements.pdfContainer.clientWidth - 40; // padding
    
    state.pdfDoc.getPage(1).then(page => {
        const viewport = page.getViewport({ scale: state.renderScale });
        state.zoomLevel = containerWidth / viewport.width;
        applyZoom();
    });
}

function resetZoom() {
    state.zoomLevel = 1.0;
    applyZoom();
}

function handleWheelZoom(e) {
    // Only zoom if Ctrl is held
    if (!e.ctrlKey) return;
    
    e.preventDefault();
    
    const oldZoom = state.zoomLevel;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.25, Math.min(3, state.zoomLevel + delta));
    
    // Zoom towards the mouse cursor position
    applyZoomAtPoint(oldZoom, newZoom, e.clientX, e.clientY);
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
    elements.btnResetZoom.addEventListener('click', resetZoom);
    
    // Mouse wheel zoom (Ctrl + scroll)
    elements.pdfContainer.addEventListener('wheel', handleWheelZoom, { passive: false });
    
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
            disableHighlightMode();
            enableScreenshotMode();
        }
    });
    
    // Highlight mode
    elements.btnHighlight.addEventListener('click', () => {
        if (state.isHighlightMode) {
            disableHighlightMode();
        } else {
            disableScreenshotMode();
            enableHighlightMode();
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
                if (e.ctrlKey) {
                    e.preventDefault();
                    if (state.pdfDoc) {
                        if (state.isScreenshotMode) {
                            disableScreenshotMode();
                        } else {
                            disableHighlightMode();
                            enableScreenshotMode();
                        }
                    }
                }
                break;
            case 'h':
                if (e.ctrlKey) {
                    e.preventDefault();
                    if (state.pdfDoc) {
                        if (state.isHighlightMode) {
                            disableHighlightMode();
                        } else {
                            disableScreenshotMode();
                            enableHighlightMode();
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

async function saveViewState() {
    if (!state.pdfPath) return;
    
    await window.electronAPI.updateSetting('viewState', {
        scrollTop: elements.pdfContainer.scrollTop,
        zoomLevel: state.zoomLevel
    });
}

async function loadSavedSettings() {
    try {
        const settings = await window.electronAPI.getSettings();
        
        // Restore last model selection into state (before provider dropdown is populated)
        if (settings.lastModel) {
            state.currentProvider = settings.lastModel.provider;
            state.currentModel = settings.lastModel.modelId;
        }
        
        return settings;
    } catch (e) {
        console.error('Failed to load settings:', e);
        return {};
    }
}

async function restoreLastPDF(settings) {
    try {
        // Restore last PDF if it exists
        if (settings.lastPDF) {
            const exists = await window.electronAPI.fileExists(settings.lastPDF);
            if (exists) {
                await loadPDF(settings.lastPDF, settings.viewState);
            }
        }
    } catch (e) {
        console.error('Failed to restore last PDF:', e);
    }
}

async function init() {
    initEventListeners();
    
    // Load saved settings first (sets state.currentModel before dropdown is populated)
    const settings = await loadSavedSettings();
    
    // Check backend connection (this loads providers and populates dropdowns)
    await checkBackendConnection();
    
    // Restore last opened PDF
    await restoreLastPDF(settings);
    
    // Listen for files opened via command line / "Open with..."
    window.electronAPI.onOpenFile((filePath) => {
        console.log('Opening file from command line:', filePath);
        loadPDF(filePath);
    });
    
    // Save view state periodically and before unload
    setInterval(saveViewState, 5000);
    window.addEventListener('beforeunload', saveViewState);
    
    // Retry connection every 5 seconds if disconnected
    setInterval(() => {
        if (!state.isConnected) {
            checkBackendConnection();
        }
    }, 5000);
}

// Start the app
init();
