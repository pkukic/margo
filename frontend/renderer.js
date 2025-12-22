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
    
    // Annotations and chat
    annotations: {},
    currentAnnotationId: null,
    
    // Auto-open annotations in view
    visibleAnnotationIds: [],
    maxVisibleAnnotations: 3,
    autoOpenedAnnotationId: null, // Track which annotation was auto-opened
    
    // Sidebar state
    isSidebarOpen: false,
    
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
    sidebar: document.getElementById('sidebar'),
    btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
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
    
    // Floating annotations
    floatingAnnotationsContainer: document.getElementById('floating-annotations-container'),
    annotationArrows: document.getElementById('annotation-arrows'),
    
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
        
        // Render all pages for continuous scrolling (must happen before loading chat data)
        await renderAllPages();
        
        // Load existing chat data (after pages are rendered so overlays can be placed)
        await loadChatData();
        
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
        
        // Update visible annotations based on scroll position
        updateVisibleAnnotations();
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
    
    // Screenshot annotation - has image and bounding box
    if (annotation.image_base64 && annotation.bounding_box) {
        overlay.classList.add('screenshot-annotation');
        
        const scale = state.renderScale;
        const box = annotation.bounding_box;
        
        overlay.style.left = (box.x * scale) + 'px';
        overlay.style.top = (box.y * scale) + 'px';
        overlay.style.width = (box.width * scale) + 'px';
        overlay.style.height = (box.height * scale) + 'px';
    }
    // Text annotation with bounding box (new style)
    else if (annotation.selected_text && annotation.bounding_box) {
        overlay.classList.add('text-annotation');
        
        const scale = state.renderScale;
        const box = annotation.bounding_box;
        
        overlay.style.left = (box.x * scale) + 'px';
        overlay.style.top = (box.y * scale) + 'px';
        overlay.style.width = (box.width * scale) + 'px';
        overlay.style.height = (box.height * scale) + 'px';
        overlay.title = annotation.selected_text.substring(0, 100) + '...';
    }
    // Legacy text annotation without bounding box - skip overlay
    else if (annotation.selected_text && !annotation.bounding_box) {
        return;
    }
    // Unknown annotation type - skip
    else {
        return;
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

// ============================================
// Auto-Open Annotations on Scroll
// ============================================

function updateVisibleAnnotations() {
    const containerRect = elements.pdfContainer.getBoundingClientRect();
    const viewportTop = containerRect.top;
    const viewportBottom = containerRect.bottom;
    const viewportCenter = (viewportTop + viewportBottom) / 2;
    const viewportHeight = viewportBottom - viewportTop;
    
    // Calculate visibility score for each annotation
    const annotationScores = [];
    
    for (const annotation of Object.values(state.annotations)) {
        const overlay = document.querySelector(
            `.annotation-overlay[data-annotation-id="${annotation.id}"]`
        );
        if (!overlay) continue;
        
        const overlayRect = overlay.getBoundingClientRect();
        
        // Check if annotation is in viewport
        const isInView = overlayRect.bottom > viewportTop && overlayRect.top < viewportBottom;
        if (!isInView) continue;
        
        // Calculate distance from center of viewport (lower = better)
        const overlayCenter = (overlayRect.top + overlayRect.bottom) / 2;
        const distanceFromCenter = Math.abs(overlayCenter - viewportCenter);
        
        // Calculate how much of the annotation is visible (0-1)
        const visibleTop = Math.max(overlayRect.top, viewportTop);
        const visibleBottom = Math.min(overlayRect.bottom, viewportBottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const visibilityRatio = visibleHeight / overlayRect.height;
        
        // Score: higher visibility + closer to center = better
        const score = visibilityRatio * 1000 - distanceFromCenter;
        
        annotationScores.push({
            annotation,
            score,
            distanceFromCenter,
            overlayRect
        });
    }
    
    // Sort by score (highest first) and take top N
    annotationScores.sort((a, b) => b.score - a.score);
    const topAnnotations = annotationScores.slice(0, state.maxVisibleAnnotations);
    const newVisibleIds = topAnnotations.map(a => a.annotation.id);
    
    // Auto-focus annotation closest to center
    if (topAnnotations.length > 0) {
        const closest = topAnnotations[0];
        const threshold = viewportHeight * 0.25;
        
        // If sidebar is open, always switch focus to the closest annotation
        if (state.isSidebarOpen && closest.distanceFromCenter < threshold) {
            if (state.currentAnnotationId !== closest.annotation.id) {
                // Switch to the closer annotation
                openAnnotationChat(closest.annotation.id);
            }
        }
        // If sidebar is closed and chat panel is hidden, auto-open
        else if (!state.isSidebarOpen && elements.chatPanel.classList.contains('hidden')) {
            if (closest.distanceFromCenter < threshold * 0.8) {
                autoOpenAnnotationChat(closest.annotation.id);
            }
        }
        // If chat panel is open and was auto-opened, switch to closer annotation
        else if (!state.isSidebarOpen && state.autoOpenedAnnotationId && 
                 state.currentAnnotationId !== closest.annotation.id) {
            if (closest.distanceFromCenter < threshold) {
                autoOpenAnnotationChat(closest.annotation.id);
            }
        }
    }
    
    // Auto-close chat if current annotation is no longer in viewport
    // This applies to both auto-opened and manually opened annotations
    if (state.currentAnnotationId) {
        const currentInView = annotationScores.find(a => a.annotation.id === state.currentAnnotationId);
        if (!currentInView) {
            closeChatPanel();
        }
    }
    
    // Check if visible annotations changed
    const oldIds = [...state.visibleAnnotationIds].sort().join(',');
    const newIds = [...newVisibleIds].sort().join(',');
    
    if (oldIds !== newIds) {
        state.visibleAnnotationIds = newVisibleIds;
        renderFloatingAnnotations();
    } else {
        // Just update arrow positions
        updateAnnotationArrows();
    }
}

// Auto-open chat when annotation approaches center of screen
function autoOpenAnnotationChat(annotationId) {
    const annotation = state.annotations[annotationId];
    if (!annotation) return;
    
    // Don't auto-open if already showing this annotation
    if (state.currentAnnotationId === annotationId) return;
    
    // Track that this was auto-opened (so we can auto-close it)
    state.autoOpenedAnnotationId = annotationId;
    
    // Open the chat panel
    openAnnotationChat(annotationId);
}

function renderFloatingAnnotations() {
    elements.floatingAnnotationsContainer.innerHTML = '';
    
    // Show floating bubbles only when sidebar is collapsed
    if (!state.isSidebarOpen) {
        elements.floatingAnnotationsContainer.classList.remove('hidden');
        elements.floatingAnnotationsContainer.classList.add('sidebar-collapsed');
    } else {
        elements.floatingAnnotationsContainer.classList.add('hidden');
    }
    
    // Always show arrows (they point to sidebar cards or floating bubbles)
    elements.annotationArrows.classList.remove('hidden');
    
    for (const annotationId of state.visibleAnnotationIds) {
        const annotation = state.annotations[annotationId];
        if (!annotation) continue;
        
        const floatingEl = createFloatingAnnotation(annotation);
        elements.floatingAnnotationsContainer.appendChild(floatingEl);
    }
    
    // Update arrows after DOM is ready
    requestAnimationFrame(() => {
        updateAnnotationArrows();
    });
}

function createFloatingAnnotation(annotation) {
    const div = document.createElement('div');
    div.className = 'floating-annotation';
    div.dataset.annotationId = annotation.id;
    
    if (annotation.id === state.currentAnnotationId) {
        div.classList.add('active');
    }
    
    // Preview content
    let previewHtml = '';
    if (annotation.image_base64) {
        previewHtml = `<img src="data:image/png;base64,${annotation.image_base64}" alt="Selection">`;
    } else if (annotation.selected_text) {
        previewHtml = `<p>${escapeHtml(annotation.selected_text)}</p>`;
    }
    
    // First question
    let questionHtml = '';
    if (annotation.messages && annotation.messages.length > 0) {
        const userMessages = annotation.messages.filter(m => m.role === 'user');
        if (userMessages.length > 0) {
            const firstQ = userMessages[0].content.substring(0, 80);
            questionHtml = `<p class="floating-annotation-question">"${escapeHtml(firstQ)}${userMessages[0].content.length > 80 ? '...' : ''}"</p>`;
        }
    }
    
    const messageCount = annotation.messages ? annotation.messages.length : 0;
    
    // Use AI-generated title if available
    const title = annotation.title || `Page ${annotation.page_number}`;
    
    div.innerHTML = `
        <div class="floating-annotation-header">
            <span class="floating-annotation-title">${escapeHtml(title)}</span>
            <button class="floating-annotation-close" title="Close">&times;</button>
        </div>
        <div class="floating-annotation-preview">
            ${previewHtml}
        </div>
        ${questionHtml}
        <span class="floating-annotation-messages">${messageCount} message${messageCount !== 1 ? 's' : ''}</span>
    `;
    
    // Click to expand sidebar and scroll to annotation card
    div.addEventListener('click', (e) => {
        if (!e.target.classList.contains('floating-annotation-close')) {
            // Expand sidebar if collapsed
            if (!state.isSidebarOpen) {
                toggleSidebar();
            }
            // Scroll to the annotation card in sidebar after sidebar animation
            setTimeout(() => {
                const card = elements.annotationsList.querySelector(
                    `.annotation-card[data-id="${annotation.id}"]`
                );
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    card.classList.add('highlight');
                    setTimeout(() => card.classList.remove('highlight'), 1500);
                }
                // Update arrows to point to sidebar cards
                updateAnnotationArrows();
            }, 350);
        }
    });
    
    // Close button
    div.querySelector('.floating-annotation-close').addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove from visible list
        state.visibleAnnotationIds = state.visibleAnnotationIds.filter(id => id !== annotation.id);
        renderFloatingAnnotations();
    });
    
    return div;
}

function updateAnnotationArrows() {
    const svg = elements.annotationArrows;
    svg.innerHTML = '';
    
    // Don't draw arrows if no visible annotations
    if (state.visibleAnnotationIds.length === 0) return;
    
    for (const annotationId of state.visibleAnnotationIds) {
        const overlay = document.querySelector(
            `.annotation-overlay[data-annotation-id="${annotationId}"]`
        );
        
        if (!overlay) continue;
        
        const overlayRect = overlay.getBoundingClientRect();
        
        // Start point: right edge of annotation overlay
        const startX = overlayRect.right;
        const startY = overlayRect.top + overlayRect.height / 2;
        
        let endX, endY;
        
        if (state.isSidebarOpen) {
            // Point to annotation card in sidebar
            const card = elements.annotationsList.querySelector(
                `.annotation-card[data-id="${annotationId}"]`
            );
            if (!card) continue;
            
            const cardRect = card.getBoundingClientRect();
            // Skip if card is not visible in viewport
            if (cardRect.height === 0 || cardRect.top > window.innerHeight || cardRect.bottom < 0) continue;
            
            endX = cardRect.left;
            endY = cardRect.top + cardRect.height / 2;
        } else {
            // Point to floating annotation bubble
            const floatingEl = elements.floatingAnnotationsContainer.querySelector(
                `.floating-annotation[data-annotation-id="${annotationId}"]`
            );
            if (!floatingEl) continue;
            
            const floatingRect = floatingEl.getBoundingClientRect();
            // Skip if floating element is not visible
            if (floatingRect.width === 0 || floatingRect.height === 0) continue;
            
            endX = floatingRect.left;
            endY = floatingRect.top + floatingRect.height / 2;
        }
        
        // Create curved path
        const midX = (startX + endX) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'annotation-arrow');
        path.setAttribute('d', `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`);
        svg.appendChild(path);
        
        // Arrow head
        const arrowSize = 6;
        const arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        arrowHead.setAttribute('class', 'annotation-arrow-head');
        arrowHead.setAttribute('points', `
            ${endX} ${endY},
            ${endX - arrowSize} ${endY - arrowSize},
            ${endX - arrowSize} ${endY + arrowSize}
        `);
        svg.appendChild(arrowHead);
    }
}

function scrollToAnnotation(annotation) {
    const pageWrapper = elements.pagesContainer.querySelector(
        `.pdf-page-wrapper[data-page-num="${annotation.page_number}"]`
    );
    if (!pageWrapper) return;
    
    if (annotation.bounding_box) {
        // Scroll to the bounding box
        const box = annotation.bounding_box;
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
// Sidebar Toggle
// ============================================

function toggleSidebar() {
    state.isSidebarOpen = !state.isSidebarOpen;
    
    if (state.isSidebarOpen) {
        elements.sidebar.classList.remove('collapsed');
        // Hide floating bubbles when sidebar is expanded (arrows will point to sidebar cards)
        elements.floatingAnnotationsContainer.classList.add('hidden');
        elements.floatingAnnotationsContainer.classList.remove('sidebar-collapsed');
    } else {
        elements.sidebar.classList.add('collapsed');
        // Show floating bubbles when sidebar is collapsed
        elements.floatingAnnotationsContainer.classList.remove('hidden');
        elements.floatingAnnotationsContainer.classList.add('sidebar-collapsed');
    }
    
    // Update arrows after transition (they'll point to sidebar cards or floating bubbles)
    setTimeout(() => {
        updateAnnotationArrows();
    }, 300);
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
    
    // Use AI-generated title if available
    const title = annotation.title || `Page ${annotation.page_number}`;
    
    card.innerHTML = `
        <div class="annotation-card-header">
            <span class="annotation-title">${escapeHtml(title)}</span>
            <span class="annotation-page">p. ${annotation.page_number}</span>
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
    
    // Update active state on floating annotations
    document.querySelectorAll('.floating-annotation').forEach(el => {
        el.classList.toggle('active', el.dataset.annotationId === annotationId);
    });
    
    // Update chat panel title - use AI-generated title if available
    const title = annotation.title || `Page ${annotation.page_number} Annotation`;
    elements.chatTitle.textContent = title;
    
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
    
    // Scroll chat to top
    elements.chatMessages.scrollTop = 0;
    
    // Focus input
    elements.chatInput.focus();
}

function closeChatPanel() {
    elements.chatPanel.classList.add('hidden');
    state.currentAnnotationId = null;
    state.autoOpenedAnnotationId = null; // Clear auto-opened tracking
    
    // Remove active state from cards
    document.querySelectorAll('.annotation-card').forEach(card => {
        card.classList.remove('active');
    });
    
    // Remove active state from overlays
    updateAnnotationOverlayStates();
    
    // Remove active state from floating annotations
    document.querySelectorAll('.floating-annotation').forEach(el => {
        el.classList.remove('active');
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
        
        // Update title if returned by backend
        if (response.title) {
            annotation.title = response.title;
            elements.chatTitle.textContent = response.title;
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
    
    const annotationId = state.currentAnnotationId;
    
    try {
        await apiRequest('/delete-annotation', {
            pdf_path: state.pdfPath,
            annotation_id: annotationId
        });
        
        // Remove from annotations
        delete state.annotations[annotationId];
        
        // Remove from visible annotations list
        state.visibleAnnotationIds = state.visibleAnnotationIds.filter(id => id !== annotationId);
        
        // Clear current annotation ID before closing panel
        state.currentAnnotationId = null;
        
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
    
    // Sidebar toggle
    elements.btnToggleSidebar.addEventListener('click', toggleSidebar);
    
    elements.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // For Ctrl+A, always handle it (close annotation and toggle sidebar)
        if (e.ctrlKey && e.key === 'a') {
            e.preventDefault();
            // If chat panel is open, close it first
            if (!elements.chatPanel.classList.contains('hidden')) {
                closeChatPanel();
            }
            toggleSidebar();
            return;
        }
        
        // Handle Ctrl+Delete or Ctrl+Backspace to delete current annotation
        if (e.ctrlKey && (e.key === 'Delete' || e.key === 'Backspace') && state.currentAnnotationId) {
            e.preventDefault();
            deleteCurrentAnnotation();
            return;
        }
        
        // Ignore other shortcuts if typing in input
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
    
    // Set initial sidebar state (collapsed by default)
    elements.sidebar.classList.add('collapsed');
    elements.floatingAnnotationsContainer.classList.add('sidebar-collapsed');
    
    // Get backend port from main process (dynamic port for each instance)
    try {
        const port = await window.electronAPI.getBackendPort();
        if (port) {
            state.backendUrl = `http://127.0.0.1:${port}`;
            console.log('Using backend URL:', state.backendUrl);
        }
    } catch (e) {
        console.log('Could not get backend port, using default');
    }
    
    // Also listen for backend port updates
    window.electronAPI.onBackendPort((port) => {
        if (port) {
            state.backendUrl = `http://127.0.0.1:${port}`;
            console.log('Backend port updated:', port);
            checkBackendConnection();
        }
    });
    
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
    
    // Update annotation arrows on resize
    window.addEventListener('resize', () => {
        updateAnnotationArrows();
    });
    
    // Retry connection every 5 seconds if disconnected
    setInterval(() => {
        if (!state.isConnected) {
            checkBackendConnection();
        }
    }, 5000);
}

// Start the app
init();
