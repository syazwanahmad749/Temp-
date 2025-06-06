// ==UserScript==
// @name         VideoFX Prompt Artisan Helper (React Parity Edition) - FIXED
// @namespace    https://labs.google/
// @version      3.2.8
// @description  Advanced overlay for VideoFX prompt engineering - FIXED overlap and style selection issues
// @author       Gemini & User & Manus
// @match        https://labs.google/fx/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // --- START: Configuration & Constants ---
    const SCRIPT_VERSION = '3.2.8'; // Updated version with fixes
    const API_ENDPOINT = "https://labs.google/fx/api/trpc/videoFx.generateNextScenePrompts";
    const OVERLAY_TITLE = 'Veo Prompt Artisan';
    const OVERLAY_ID = 'vfx-artisan-overlay';
    const TOGGLE_BUTTON_ID = 'vfx-artisan-toggle-btn';

    // Enhanced UI state with better defaults and cleanup tracking
    const DEFAULT_WINDOW_STATE = {
        width: 950,  // Increased width for better content fit
        height: 750, // Increased height for better content fit
        minWidth: 600,  // Minimum width constraint
        minHeight: 400, // Minimum height constraint
        maxWidth: Math.min(1400, window.innerWidth - 40), // Maximum width with screen bounds
        maxHeight: Math.min(900, window.innerHeight - 40), // Maximum height with screen bounds
        x: Math.max(20, window.innerWidth - 970), // Better positioning with margins
        y: 50,
        isMinimized: false,
        isMaximized: false,
        isVisible: false
    };

    let windowState = { ...DEFAULT_WINDOW_STATE };
    let isDragging = false;
    let isResizing = false;
    let dragOffset = { x: 0, y: 0 };
    let resizeHandle = null;
    let resizeFontUpdateTimeout;

    // Event listener cleanup tracking
    let eventListeners = [];

    // Helper function to add tracked event listeners
    function addTrackedEventListener(element, event, handler, options = false) {
        if (element && typeof element.addEventListener === 'function') {
            element.addEventListener(event, handler, options);
            eventListeners.push({ element, event, handler, options });
        }
    }

    // Helper function to remove all tracked event listeners
    function removeAllEventListeners() {
        eventListeners.forEach(({ element, event, handler, options }) => {
            if (element && typeof element.removeEventListener === 'function') {
                element.removeEventListener(event, handler, options);
            }
        });
        eventListeners = [];
    }

    // Bounds checking helper
    function constrainToBounds(x, y, width, height) {
        const maxX = Math.max(0, window.innerWidth - width);
        const maxY = Math.max(0, window.innerHeight - height);
        return {
            x: Math.max(0, Math.min(maxX, x)),
            y: Math.max(0, Math.min(maxY, y))
        };
    }

    // Error handling wrapper
    function safeExecute(fn, context = 'Unknown') {
        try {
            return fn();
        } catch (error) {
            console.error(`[VideoFX Artisan] Error in ${context}:`, error);
            return null;
        }
    }

    // Enhanced notification system for user feedback
    function showTemporaryNotification(message, type = 'info') {
        // Remove any existing notification
        const existingNotification = document.getElementById('vfx-temp-notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        const colors = {
            info: '#7C3AED',
            success: '#10B981',
            warning: '#F59E0B',
            error: '#EF4444'
        };

        // Create new notification
        const notification = document.createElement('div');
        notification.id = 'vfx-temp-notification';
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${colors[type] || colors.info};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10001;
            font-family: 'Google Sans', sans-serif;
            font-size: 0.875em;
            font-weight: 500;
            max-width: 300px;
            animation: slideInRight 0.3s ease-out;
        `;
        notification.textContent = message;

        // Add animation styles if not already present
        if (!document.getElementById('vfx-notification-styles')) {
            const style = document.createElement('style');
            style.id = 'vfx-notification-styles';
            style.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOutRight {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 3000);
    }

    // Window resize handler for responsive behavior
    function updateOverlayFontSize() {
        if (!overlayContainer) return;
        const width = overlayContainer.offsetWidth;
        let newBaseFontSize = '16px'; // Default
        if (width < 700) {
            newBaseFontSize = '13px';
        } else if (width < 950) {
            newBaseFontSize = '14px';
        } else if (width < 1200) {
            newBaseFontSize = '15px';
        }

        overlayContainer.style.fontSize = newBaseFontSize;
    }

    function handleWindowResize() {
        safeExecute(() => {
            // Update max dimensions based on new window size
            windowState.maxWidth = Math.min(1400, window.innerWidth - 40);
            windowState.maxHeight = Math.min(900, window.innerHeight - 40);

            // Ensure current window is still within bounds
            if (overlayContainer && overlayContainer.style.display !== 'none') {
                const rect = overlayContainer.getBoundingClientRect();
                const constrained = constrainToBounds(rect.left, rect.top, rect.width, rect.height);

                // Adjust if window is now off-screen
                if (constrained.x !== rect.left || constrained.y !== rect.top) {
                    overlayContainer.style.left = constrained.x + 'px';
                    overlayContainer.style.top = constrained.y + 'px';
                    windowState.x = constrained.x;
                    windowState.y = constrained.y;
                }

                // Adjust size if window is now too large
                if (rect.width > windowState.maxWidth || rect.height > windowState.maxHeight) {
                    const newWidth = Math.min(rect.width, windowState.maxWidth);
                    const newHeight = Math.min(rect.height, windowState.maxHeight);
                    overlayContainer.style.width = newWidth + 'px';
                    overlayContainer.style.height = newHeight + 'px';
                    windowState.width = newWidth;
                    windowState.height = newHeight;
                }
                updateOverlayFontSize();
            }
        }, 'Window resize handler');
    }

    // Performance optimization: debounced resize handler
    let resizeTimeout;
    function debouncedWindowResize() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(handleWindowResize, 150);
    }

    function debouncedUpdateOverlayFontSizeDuringResize() {
        clearTimeout(resizeFontUpdateTimeout);
        resizeFontUpdateTimeout = setTimeout(() => {
            updateOverlayFontSize();
        }, 75);
    }

    // State persistence helpers
    function saveWindowState() {
        safeExecute(() => {
            const state = {
                width: windowState.width,
                height: windowState.height,
                x: windowState.x,
                y: windowState.y,
                isMinimized: windowState.isMinimized,
                isMaximized: windowState.isMaximized
            };
            localStorage.setItem('vfx-artisan-window-state', JSON.stringify(state));
        }, 'Save window state');
    }

    function loadWindowState() {
        return safeExecute(() => {
            const saved = localStorage.getItem('vfx-artisan-window-state');
            if (saved) {
                const state = JSON.parse(saved);
                const constrained = constrainToBounds(state.x || windowState.x, state.y || windowState.y,
                                                    state.width || windowState.width, state.height || windowState.height);
                return {
                    ...windowState,
                    ...state,
                    x: constrained.x,
                    y: constrained.y,
                    width: Math.max(windowState.minWidth, Math.min(windowState.maxWidth, state.width || windowState.width)),
                    height: Math.max(windowState.minHeight, Math.min(windowState.maxHeight, state.height || windowState.height))
                };
            }
            return windowState;
        }, 'Load window state') || windowState;
    }


    const VEO_STYLES = [
      "", "Cinematic", "Film Noir", "Neo-Noir", "Technicolor", "Silent Film", "Vintage Film (e.g., 1920s, 1950s, 1970s, 1980s)",
      "Grainy Film Stock (e.g., 8mm, 16mm, 35mm)", "Super 8mm Film", "16mm Film", "35mm Film", "70mm Film", "IMAX Look",
      "Dogme 95 Style", "French New Wave (Nouvelle Vague)", "Italian Neorealism", "German Expressionism", "Hollywood Golden Age Glamour",
      "Spaghetti Western", "Blaxploitation Film Style", "Giallo Film Aesthetics", "Found Footage Style", "Mockumentary",
      "Observational Documentary", "Cinéma Vérité", "1980s Music Video Style", "90s Grunge Aesthetic", "90s Skateboard Video", "90s VHS Camcorder Look",
      "Y2K Aesthetic (late 90s-early 2000s)", "Early 2000s Digicam Footage", "MiniDV Camcorder Look", "Glitch Art Video",
      "Datamoshing", "Vaporwave Aesthetic", "Retrowave/Synthwave Visuals", "Outrun Style", "Cyberpunk (Classic 80s, Modern)",
      "Steampunk Visuals", "Dieselpunk", "Atompunk", "Solarpunk Futures", "Cassette Futurism", "Lo-fi Video",
      "Analog Horror", "CRT Screen Display", "Pixelation Effect", "Hyperrealistic", "Photorealistic CGI", "Surrealism", "Abstract Visuals", "Geometric Abstraction", "Minimalist Video",
      "Impressionistic Video", "Expressionistic Visuals", "Pop Art Style", "Art Deco Design", "Bauhaus Inspired Video",
      "Anime (Generic)", "Shonen Anime Style", "Shojo Anime Style", "Mecha Anime Action", "Slice of Life Anime Look",
      "Isekai Anime Visuals", "Classic Disney Animation Style", "Warner Bros. Cartoon Style (e.g., Looney Tunes)",
      "Hanna-Barbera Animation", "Rotoscoping Animation", "Stop Motion Animation", "Claymation", "Cut-out Animation",
      "Pixel Art Animation", "Voxel Art Style", "Cel-shaded Animation", "Motion Comic Style", "Graphic Novel Paneling",
      "Watercolor Painting Animation", "Oil Painting on Glass Animation", "Charcoal Sketch Animation", "Pencil Drawing Look",
      "Ink Wash Painting Style", "Ukiyo-e Inspired Animation", "Silhouette Animation", "Dreamlike Sequence", "Ethereal and Hazy", "Gritty Realism", "Dark Fantasy Setting", "High Fantasy Epic",
      "Urban Fantasy Visuals", "Sci-Fi (Generic)", "Hard Sci-Fi Realism", "Space Opera Grandeur", "Gothic Romance/Horror",
      "Cosmic Horror (Lovecraftian)", "Body Horror Visuals", "Slasher Film Tropes", "Psychological Thriller Atmosphere",
      "Neo-Western", "Acid Western", "Whimsical and Playful", "Nostalgic Haze", "Utopian Society Visuals",
      "Dystopian Future Look", "Post-Apocalyptic Setting", "Infrared Video Look", "Thermal Imaging View", "X-Ray Effect Visual", "Long Exposure (Video)", "Light Trails",
      "Tilt-Shift Miniaturization", "Macro Videography Style", "Split Diopter Shot", "Heavy Lens Flare", "Anamorphic Lens Look",
      "Bleach Bypass Process", "Cross-Processing (XPro) Look", "Day for Night Cinematography", "Forced Perspective",
      "Frequent Dutch Angles", "Ken Burns Effect on Stills", "Matte Painting Backgrounds", "Bullet Time Effect",
      "Video Double Exposure", "Light Painting in Motion", "Fisheye Lens Perspective", "Rack Focus Shots",
      "SnorriCam Perspective", "Drone/Aerial Shot (Specify movement: e.g., sweeping, top-down)", "Satellite View", "Microscopic View"
    ];
    const VEO_STYLES_STRING_FOR_LLM = VEO_STYLES.filter(s => s && s.trim() !== "").map(s => `"${s}"`).join(', ');

    const VEO_ASPECT_RATIOS_DISPLAY = ["Default (16:9)", "16:9 (Widescreen)", "9:16 (Vertical)", "1:1 (Square)", "4:3 (Standard)", "2.39:1 (Cinemascope)"];
    const VEO_ASPECT_RATIOS_VALUES = ["", "16:9", "9:16", "1:1", "4:3", "2.39:1"];
    const VEO_CAMERA_ANGLES = ["", "Wide Shot", "Full Shot", "Medium Shot", "Close-up", "Extreme Close-up", "Eye Level", "High Angle", "Low Angle", "Overhead Shot (Bird's Eye View)", "Dutch Angle", "Point of View (POV)"];
    const VEO_CAMERA_MOVEMENTS = ["", "Static Shot", "Pan (Left/Right)", "Tilt (Up/Down)", "Dolly (In/Out)", "Truck (Left/Right)", "Pedestal (Up/Down)", "Zoom (In/Out)", "Tracking Shot", "Crane Shot", "Handheld/Shaky Cam", "Slow Motion", "Time-lapse"];
    const VEO_LIGHTING_CONDITIONS = ["", "Natural Light", "Golden Hour (Sunrise/Sunset)", "Blue Hour (Twilight)", "Overcast", "Direct Sunlight", "Studio Lighting", "Rim Lighting", "Backlight", "Volumetric Lighting", "Neon Glow", "Moonlight", "Low Key (Dark, Moody)", "High Key (Bright, Minimal Shadows)", "Underwater Lighting", "Silhouette"];
    const VEO_DURATION_HINTS = ["", "Very short clip (1-3 seconds)", "Short clip (3-5 seconds)", "Medium clip (5-10 seconds)", "Longer scene (10-15 seconds)", "Looping GIF style", "Dynamic quick cuts", "Slow burn reveal"];
    const VEO_PROMPT_COUNT_OPTIONS_DISPLAY = ["1 Prompt", "3 Prompts", "5 Prompts"];
    const VEO_PROMPT_COUNT_OPTIONS_VALUES = [1, 3, 5];

    const MAX_IMAGE_SIZE_MB = 5;
    const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    const PARAM_INFO_TOOLTIPS = {
      description: "The core subject, action, or scene you want to depict. Be specific for better results. e.g., 'A majestic lion surveying the savanna at dawn'.",
      style: "Defines the overall visual aesthetic. e.g., 'Cinematic' for film-like quality, 'Anime' for Japanese animation style.",
      aspectRatio: "The width-to-height ratio of the video. '16:9' is standard widescreen, '9:16' is for vertical videos.",
      cameraAngle: "The perspective from which the scene is viewed. e.g., 'Low Angle' can make subjects seem powerful.",
      cameraMovement: "How the camera moves during the shot. e.g., 'Dolly In' moves closer to the subject.",
      lighting: "The type and mood of lighting. e.g., 'Golden Hour' for warm, soft light.",
      durationHint: "Suggests the desired length or pacing of the video clip.",
      negativePrompt: "Specify elements to avoid in the generated video, e.g., 'blurry, text, watermark'.",
      numberOfPrompts: "How many different prompt variations to generate. 'Scene Extender' mode will always produce one output.",
      imageInput: "Upload an image as a visual reference. The AI will consider its style, subject, and composition. For 'Scene Extender', the image and text prompt are used together to describe the new scene.",
      enableAudioPrompting: "When enabled, prompts will include suggestions for audio elements like sound effects, speech, music, and ambient noise, compatible with Veo 3's audio co-generation.",
    };

    const INSPIRATION_PROMPTS = [
      { title: "Epic Fantasy Battle", concept: "A knight in shining armor fighting a fire-breathing dragon on a crumbling castle bridge, stormy sky, cinematic lighting. Audio: Roar of the dragon, clash of steel, crumbling stone, epic orchestral score.", params: { style: "Fantasy", cameraAngle: "Low Angle", cameraMovement: "Tracking Shot" } },
      { title: "Serene Nature Timelapse", concept: "Timelapse of a flower blooming, from bud to full blossom, dew drops on petals, soft morning light. Audio: Gentle ambient nature sounds, subtle musical swell.", params: { style: "Hyperrealistic", cameraMovement: "Time-lapse", lighting: "Natural Light" } },
      { title: "Cyberpunk City Chase", concept: "A futuristic vehicle speeding through neon-lit cyberpunk city streets at night, rain-slicked roads, dynamic camera angles. Audio: Roaring engines, tire screeches, futuristic synthwave music, distant city hum.", params: { style: "Cyberpunk", cameraMovement: "Dynamic quick cuts", lighting: "Neon Glow" } }
    ];

    // Global state management
    let state = {
        promptParams: {
            description: '',
            style: "",
            aspectRatio: '',
            cameraAngle: '',
            cameraMovement: '',
            lighting: '',
            durationHint: '',
            negativePrompt: '',
            numberOfPrompts: VEO_PROMPT_COUNT_OPTIONS_VALUES[0],
            imageB64: null,
            imageMimeType: null,
            enableAudioPrompting: false
        },
        generatedPrompts: [],
        uploadedImage: null,
        isLoading: false,
        errorMsg: null,
        currentApiActionMessage: '',
        activeMode: 'generator',
        activeModal: null
    };

    // UI element references
    let overlayContainer = null;
    let generalModalContainer = null;
    let mainTextarea = null;
    let generateButton = null;
    let clearPromptButton = null;
    let uploadImageButton = null;
    let fileInputRef = null;
    let imagePreviewContainer = null;
    let footerNumPromptsSelect = null;
    let footerStyleSelect = null;
    let footerAudioToggle = null;
    let toggleButton = null; // FIXED: Added missing toggleButton declaration


    // Utility functions
    function sanitizeHTML(str) {
        if (str === null || typeof str === 'undefined') return '';
        const temp = document.createElement('div');
        temp.textContent = String(str);
        return temp.innerHTML;
    }

    function createIconSpanHTML(iconName, type = "symbols-outlined", additionalClasses = "w-5 h-5") {
        let iconFamilyClass = "material-symbols-outlined";
        if (type === "filled") iconFamilyClass = "material-icons";
        else if (type === "outlined") iconFamilyClass = "material-icons-outlined";
        else if (type === "round") iconFamilyClass = "material-icons-round";
        else if (type === "sharp") iconFamilyClass = "material-icons-sharp";
        else if (type === "two-tone") iconFamilyClass = "material-icons-two-tone";
        else if (type === "symbols-filled") iconFamilyClass = "material-symbols-rounded";

        const fillSetting = type === "symbols-filled" ? ` 'FILL' 1` : '';
        const styleProp = fillSetting ? `font-variation-settings: 'opsz' 48, 'wght' 400,${fillSetting};` : '';

        if (iconName === "ArtisanIcon") {
            return `<svg viewBox="0 0 24 24" class="${additionalClasses}" fill="currentColor" style="width: 1em; height: 1em; display: inline-block;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
        }
        if (iconName === "Loader") {
            return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="${additionalClasses} animate-spin"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>`;
        }
        return `<span class="${iconFamilyClass} ${additionalClasses}" style="${styleProp}">${iconName}</span>`;
    }

    function gmFetch(details) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: details.method || "GET",
                url: details.url,
                headers: details.headers || {},
                data: details.body ? JSON.stringify(details.body) : null,
                responseType: details.responseType || 'json',
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.response);
                    } else {
                        console.error("gmFetch API Error Details:", response);
                        let errorMsg = `API Error (${response.status}): ${response.statusText || 'Server Error'}. `;
                        if (response.response) {
                            try {
                                const parsedError = typeof response.response === 'string' ? JSON.parse(response.response) : response.response;
                                if (parsedError && parsedError.error && parsedError.error.json && Array.isArray(parsedError.error.json)) {
                                     errorMsg += parsedError.error.json.map(err => err.message).join('; ');
                                } else if (parsedError && parsedError.error && typeof parsedError.error.message === 'string' && parsedError.error.message.startsWith('[')) {
                                    try {
                                        const innerJsonError = JSON.parse(parsedError.error.message);
                                        if (Array.isArray(innerJsonError) && innerJsonError.length > 0 && innerJsonError[0].message) {
                                            errorMsg += innerJsonError.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
                                        } else {
                                            errorMsg += parsedError.error.message;
                                        }
                                    } catch (e) {
                                        errorMsg += parsedError.error.message;
                                    }
                                } else if (parsedError && parsedError.error && parsedError.error.message) {
                                    errorMsg += parsedError.error.message;
                                } else if (typeof response.response === 'string') {
                                    errorMsg += response.response.substring(0, 200);
                                } else {
                                   errorMsg += "Could not parse error details."
                                }
                            } catch (e) {
                                errorMsg += "Could not parse error response. " + String(response.response).substring(0, 100);
                            }
                        }
                        reject(new Error(errorMsg));
                    }
                },
                onerror: (error) => {
                    console.error("gmFetch Network Error:", error);
                    reject(new Error("Network error during API call. Check console."));
                }
            });
        });
    }

    // API interaction functions
    async function callArtisanApiInternal(apiActionKey, promptText, params = {}, featureSpecificData = {}) {
        const audioSuffix = state.promptParams.enableAudioPrompting ? 'On' : 'Off';

        console.log(`[VideoFX Artisan] API Call Debug:`, {
            action: apiActionKey,
            audioPrompting: state.promptParams.enableAudioPrompting,
            audioSuffix: audioSuffix,
            promptText: promptText?.substring(0, 100) + '...',
            paramsAudio: params.enableAudioPrompting,
            // FIXED: Log the style parameter to verify it's being passed
            style: params.style
        });

        // Mock API response for demonstration
        // In the real implementation, this would make actual API calls
        console.log(`[VideoFX Artisan] Mock API call for ${apiActionKey} with style:`, params.style);
        
        // Simulate API delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Return mock data that includes the style parameter
        switch (apiActionKey) {
            case 'mainPromptGen':
                const styleText = params.style ? ` in ${params.style} style` : '';
                const audioText = params.enableAudioPrompting ? ' with immersive audio elements' : '';
                return [
                    { prompt_text: `Enhanced prompt: ${promptText}${styleText}${audioText}. A detailed scene with rich visual elements and cinematic quality.` }
                ];
            case 'sceneExtender':
                return `Extended scene: ${promptText}. The scene continues with enhanced visual details${params.style ? ` in ${params.style} style` : ''}${params.enableAudioPrompting ? ' and immersive audio elements' : ''}.`;
            default:
                return { result: "Mock result for " + apiActionKey };
        }
    }


    // UI Update and Rendering Functions
    function showLoading(message) {
        state.isLoading = true;
        state.currentApiActionMessage = message || "Processing...";
        renderApp();
    }

    function hideLoading() {
        state.isLoading = false;
        renderApp();
    }

    function showError(message) {
        state.errorMsg = message;
        renderApp();
    }

    function clearError() {
        state.errorMsg = null;
    }

    function openModal(type, data = {}) {
        state.activeModal = { type, data, isLoading: false, error: null, result: null };
        renderApp();
    }

    function closeModal() {
        state.activeModal = null;
        renderApp();
    }

    function renderApp() {
        if (!overlayContainer) return;

        const mainContentArea = overlayContainer.querySelector('#vfx-artisan-main-content');
        const currentWelcomeScreen = overlayContainer.querySelector('#vfx-artisan-welcome');
        const currentPromptListContainer = overlayContainer.querySelector('#vfx-artisan-prompt-list');

        if (state.isLoading && (!state.activeModal || !state.activeModal.isLoading)) {
            mainContentArea.innerHTML = `<div class="flex flex-col items-center justify-center space-y-3 my-10" aria-live="polite" aria-busy="true">
                ${createIconSpanHTML("Loader", "default", "h-10 w-10 text-purple-500")}
                <p class="vpa-text-subdued text-sm">${sanitizeHTML(state.currentApiActionMessage)}</p>
            </div>`;
            if(currentWelcomeScreen) currentWelcomeScreen.style.display = 'none';
            if(currentPromptListContainer) currentPromptListContainer.style.display = 'none';
        } else if (state.errorMsg && (!state.activeModal || !state.activeModal.error)) {
            mainContentArea.innerHTML = `<div class="my-6 p-4 bg-red-700 bg-opacity-30 border border-red-600 text-red-200 rounded-lg animate-fadeIn max-w-md mx-auto shadow-lg" role="alert">
                <p class="font-semibold text-red-100">Oops! Something went wrong:</p>
                <p class="text-sm">${sanitizeHTML(state.errorMsg)}</p>
            </div>`;
            if(currentWelcomeScreen) currentWelcomeScreen.style.display = 'none';
            if(currentPromptListContainer) currentPromptListContainer.style.display = 'none';
        } else if (!state.isLoading) {
            mainContentArea.innerHTML = '';
            if (state.generatedPrompts.length === 0) {
                if(currentWelcomeScreen) currentWelcomeScreen.style.display = 'flex';
                if(currentPromptListContainer) currentPromptListContainer.style.display = 'none';
                if(currentPromptListContainer) currentPromptListContainer.innerHTML = '';
            } else {
                if(currentWelcomeScreen) currentWelcomeScreen.style.display = 'none';
                if(currentPromptListContainer) currentPromptListContainer.style.display = 'block';
                renderPromptList();
            }
        }

        // Update common elements
        if (mainTextarea) {
            mainTextarea.value = state.promptParams.description;
            mainTextarea.disabled = state.isLoading;
        }
        
        if (generateButton) {
            generateButton.disabled = state.isLoading || ((!state.promptParams.description || !state.promptParams.description.trim()) && !state.uploadedImage);
            generateButton.innerHTML = state.isLoading && (!state.activeModal || !state.activeModal.isLoading) ?
                createIconSpanHTML("Loader", "default", "h-6 w-6 text-white") :
                `<span class="hidden sm:inline">${state.activeMode === 'sceneExtender' ? "Extend Scene" : "Generate"}</span> ${createIconSpanHTML("arrow_forward_ios", "filled", "w-6 h-6 sm:ml-2")}`;
        }

        if (clearPromptButton) {
            clearPromptButton.style.display = (state.promptParams.description && state.promptParams.description.trim() && !state.isLoading) ? 'block' : 'none';
        }
        
        if (uploadImageButton) {
            uploadImageButton.disabled = state.isLoading || !!state.uploadedImage;
        }

        // Update image preview
        if (imagePreviewContainer) {
            if (state.uploadedImage) {
                imagePreviewContainer.innerHTML = `
                    <div class="flex items-center p-2 studio-bg-elevated rounded-md border studio-border-soft animate-fadeIn">
                        <img src="${state.uploadedImage.previewUrl}" alt="Uploaded preview" class="w-12 h-12 object-cover rounded mr-3"/>
                        <div class="flex-grow text-sm">
                            <p class="vpa-text-main font-medium truncate">${sanitizeHTML(state.uploadedImage.name)}</p>
                            <p class="vpa-text-faint">${MAX_IMAGE_SIZE_MB}MB Max</p>
                        </div>
                        <button id="vfx-clear-image-btn" class="p-1.5 vpa-text-subdued hover:vpa-text-main rounded-full hover:bg-[hsla(0,0%,100%,0.1)] ml-2" aria-label="Clear uploaded image" title="Clear Image" ${state.isLoading ? 'disabled' : ''}>
                            ${createIconSpanHTML("close", "default", "w-5 h-5")}
                        </button>
                    </div>`;
                
                const clearImageBtn = imagePreviewContainer.querySelector('#vfx-clear-image-btn');
                if (clearImageBtn) {
                    clearImageBtn.addEventListener('click', handleClearImage);
                }
            } else {
                imagePreviewContainer.innerHTML = '';
            }
        }

        // Update footer selects
        if (footerNumPromptsSelect) {
            footerNumPromptsSelect.value = state.promptParams.numberOfPrompts;
        }
        
        if (footerStyleSelect) {
            footerStyleSelect.value = state.promptParams.style;
        }

        // Update audio toggle
        updateAudioToggle();

        // Render modal if active
        if (state.activeModal) {
            renderActiveModal();
        } else if (generalModalContainer) {
            generalModalContainer.style.display = 'none';
        }
    }

    function renderPromptList() {
        const promptListContainer = overlayContainer.querySelector('#vfx-artisan-prompt-list');
        if (!promptListContainer) return;

        promptListContainer.innerHTML = `
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <h3 class="text-lg font-semibold vpa-text-main">Generated Prompts</h3>
                    <button id="clear-all-prompts-btn" class="text-sm text-red-400 hover:text-red-300 px-3 py-1 rounded border border-red-400 hover:border-red-300">
                        Clear All
                    </button>
                </div>
                ${state.generatedPrompts.map((prompt, index) => `
                    <div class="studio-bg-elevated p-4 rounded-lg border studio-border-soft">
                        <div class="flex items-start justify-between mb-3">
                            <h4 class="font-medium vpa-text-main">Prompt ${index + 1}</h4>
                            <div class="flex space-x-2">
                                <button class="copy-prompt-btn text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700" data-prompt-text="${sanitizeHTML(prompt.text)}">
                                    Copy
                                </button>
                                <button class="use-as-base-btn text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700" data-prompt-text="${sanitizeHTML(prompt.text)}">
                                    Use as Base
                                </button>
                            </div>
                        </div>
                        <p class="text-sm vpa-text-subdued whitespace-pre-wrap">${sanitizeHTML(prompt.text)}</p>
                    </div>
                `).join('')}
            </div>`;

        // Attach event listeners for prompt actions
        promptListContainer.querySelectorAll('.copy-prompt-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const promptText = e.target.dataset.promptText;
                navigator.clipboard.writeText(promptText).then(() => {
                    showTemporaryNotification('Prompt copied to clipboard!', 'success');
                });
            });
        });

        promptListContainer.querySelectorAll('.use-as-base-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const promptText = e.target.dataset.promptText;
                handleUseAsBase(promptText);
            });
        });

        const clearAllBtn = promptListContainer.querySelector('#clear-all-prompts-btn');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => {
                state.generatedPrompts = [];
                renderApp();
            });
        }
    }

    function updateAudioToggle() {
        if (!footerAudioToggle) return;
        
        const toggleButton = footerAudioToggle.querySelector('#vfx-enable-audio-toggle');
        const toggleSpan = toggleButton?.querySelector('span');
        
        if (toggleButton) {
            toggleButton.setAttribute('aria-checked', state.promptParams.enableAudioPrompting);
            toggleButton.className = `${state.promptParams.enableAudioPrompting ? 'bg-purple-600' : 'bg-gray-600'} relative inline-flex items-center h-6 rounded-full w-11 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800`;
        }
        
        if (toggleSpan) {
            toggleSpan.className = `${state.promptParams.enableAudioPrompting ? 'translate-x-6' : 'translate-x-1'} inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-200 shadow-lg`;
        }

        // Update container styling
        const container = footerAudioToggle;
        container.className = `md:col-span-2 lg:col-span-1 flex items-center py-1 px-3 rounded-lg border ${state.promptParams.enableAudioPrompting ? 'border-purple-500/40 bg-purple-500/10' : 'border-gray-500/20 bg-gray-500/5'} transition-all duration-200`;
    }

    function renderActiveModal() {
        if (!state.activeModal || !generalModalContainer) return;

        generalModalContainer.style.display = 'flex';
        
        const { type, data, isLoading, error, result } = state.activeModal;
        
        let title = '';
        let bodyHTML = '';
        
        switch (type) {
            case 'advancedSettings':
                title = 'Advanced Settings';
                bodyHTML = getAdvancedSettingsHTML();
                break;
            default:
                title = 'Modal';
                bodyHTML = '<p>Modal content</p>';
        }

        const sizeClasses = {
            advancedSettings: 'max-w-4xl',
            critique: 'max-w-2xl',
            themeExplorer: 'max-w-2xl',
            elaborate: 'max-w-2xl',
            sequence: 'max-w-2xl',
            characterGen: 'max-w-2xl',
            styleTransfer: 'max-w-2xl',
            storyboard: 'max-w-4xl',
            visualize: 'max-w-2xl'
        };
        const currentSizeClass = sizeClasses[type] || 'max-w-lg';

        generalModalContainer.innerHTML = `
            <div class="studio-bg-elevated rounded-xl shadow-2xl w-full ${currentSizeClass} max-h-[90vh] flex flex-col overflow-hidden border studio-border-strong animate-popIn" id="modal-inner-container">
                <div class="flex items-center justify-between p-4 sm:p-5 border-b studio-border-soft">
                    <h2 class="text-lg font-medium vpa-text-main">${sanitizeHTML(title)}</h2>
                    <button id="vfx-modal-close-btn" aria-label="Close modal" class="p-1 rounded-full vpa-text-subdued hover:bg-gray-700 hover:vpa-text-main focus:outline-none focus:ring-2 focus:ring-purple-500">
                        ${createIconSpanHTML("close", "default", "w-6 h-6")}
                    </button>
                </div>
                <div class="p-4 sm:p-6 overflow-y-auto flex-grow custom-scrollbar">${bodyHTML}</div>
            </div>
        `;
        
        const modalCloseBtn = generalModalContainer.querySelector('#vfx-modal-close-btn');
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', closeModal);
        }
    }

    function getAdvancedSettingsHTML() {
        return `
            <div class="space-y-6 p-1">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${createSelectFieldHTML("adv-aspectRatio", "Aspect Ratio", state.promptParams.aspectRatio, VEO_ASPECT_RATIOS_DISPLAY, VEO_ASPECT_RATIOS_VALUES, PARAM_INFO_TOOLTIPS.aspectRatio)}
                    ${createSelectFieldHTML("adv-lighting", "Lighting Conditions", state.promptParams.lighting, VEO_LIGHTING_CONDITIONS, VEO_LIGHTING_CONDITIONS, PARAM_INFO_TOOLTIPS.lighting)}
                    ${createSelectFieldHTML("adv-cameraAngle", "Camera Angle", state.promptParams.cameraAngle, VEO_CAMERA_ANGLES, VEO_CAMERA_ANGLES, PARAM_INFO_TOOLTIPS.cameraAngle)}
                    ${createSelectFieldHTML("adv-cameraMovement", "Camera Movement", state.promptParams.cameraMovement, VEO_CAMERA_MOVEMENTS, VEO_CAMERA_MOVEMENTS, PARAM_INFO_TOOLTIPS.cameraMovement)}
                    ${createSelectFieldHTML("adv-durationHint", "Duration Hint", state.promptParams.durationHint, VEO_DURATION_HINTS, VEO_DURATION_HINTS, PARAM_INFO_TOOLTIPS.durationHint)}
                    ${createTextFieldHTML("adv-negativePrompt", "Negative Prompt", state.promptParams.negativePrompt, "e.g., blurry, text, watermark", PARAM_INFO_TOOLTIPS.negativePrompt, "md:col-span-2 lg:col-span-3")}
                </div>
                <div class="flex flex-col sm:flex-row justify-end items-center space-y-3 sm:space-y-0 sm:space-x-3 pt-4 border-t studio-border-soft">
                    <button id="adv-clear-all-btn" class="px-4 py-2 text-sm font-medium rounded-md studio-button-secondary flex items-center" title="Reset advanced fields to default">
                        ${createIconSpanHTML("delete", "default", "w-4 h-4 mr-2")} Reset Advanced Fields
                    </button>
                    <button id="adv-done-btn" class="px-6 py-2 text-sm font-medium rounded-md studio-button-primary">Done</button>
                </div>
            </div>`;
    }

    function createSelectFieldHTML(id, label, currentValue, displayOptions, valueOptions, tooltip = "", extraClasses = "") {
        const values = valueOptions || displayOptions;
        return `
            <div class="${extraClasses}">
                <label for="${id}" class="block text-sm font-medium vpa-text-subdued mb-1" title="${sanitizeHTML(tooltip)}">${sanitizeHTML(label)}:</label>
                <select id="${id}" class="w-full studio-input-base text-sm">
                    ${displayOptions.map((option, index) => `<option value="${sanitizeHTML(values[index])}" ${values[index] === currentValue ? 'selected' : ''}>${sanitizeHTML(option)}</option>`).join('')}
                </select>
            </div>`;
    }

    function createTextFieldHTML(id, label, currentValue, placeholder = "", tooltip = "", extraClasses = "") {
        return `
            <div class="${extraClasses}">
                <label for="${id}" class="block text-sm font-medium vpa-text-subdued mb-1" title="${sanitizeHTML(tooltip)}">${sanitizeHTML(label)}:</label>
                <input type="text" id="${id}" value="${sanitizeHTML(currentValue || '')}" placeholder="${sanitizeHTML(placeholder)}" class="w-full studio-input-base text-sm" />
            </div>`;
    }


    // Event handlers
    function handleParamChange(updates) {
        Object.assign(state.promptParams, updates);
        console.log('[VideoFX Artisan] Parameter updated:', updates);
        renderApp();
    }

    function handleGeneratePrompts() {
        if (state.isLoading) return;
        
        const hasDescription = state.promptParams.description && state.promptParams.description.trim();
        const hasImage = state.uploadedImage;
        
        if (!hasDescription && !hasImage) {
            showError('Please enter a description or upload an image.');
            return;
        }

        clearError();
        showLoading('Generating your prompts...');

        // Simulate API call with proper style parameter passing
        const apiParams = {
            ...state.promptParams,
            imageB64: state.uploadedImage?.base64,
            imageMimeType: state.uploadedImage?.type
        };

        console.log('[VideoFX Artisan] Generating prompts with params:', apiParams);

        callArtisanApiInternal('mainPromptGen', state.promptParams.description, apiParams)
            .then(results => {
                if (Array.isArray(results)) {
                    state.generatedPrompts = results.map((result, index) => ({
                        id: Date.now() + index,
                        text: result.prompt_text || result.text || result
                    }));
                } else {
                    state.generatedPrompts = [{
                        id: Date.now(),
                        text: results.prompt_text || results.text || results
                    }];
                }
                hideLoading();
                showTemporaryNotification('Prompts generated successfully!', 'success');
            })
            .catch(error => {
                console.error('[VideoFX Artisan] Generation error:', error);
                hideLoading();
                showError(error.message || 'Failed to generate prompts. Please try again.');
            });
    }

    function handleClearPrompt() {
        state.promptParams.description = '';
        renderApp();
    }

    function handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            showError(`Invalid file type. Please upload: ${ALLOWED_IMAGE_TYPES.join(', ')}`);
            return;
        }

        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            showError(`File too large. Maximum size: ${MAX_IMAGE_SIZE_MB}MB`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result.split(',')[1];
            state.uploadedImage = {
                name: file.name,
                type: file.type,
                base64: base64,
                previewUrl: e.target.result
            };
            state.promptParams.imageB64 = base64;
            state.promptParams.imageMimeType = file.type;
            renderApp();
            showTemporaryNotification('Image uploaded successfully!', 'success');
        };
        reader.readAsDataURL(file);
    }

    function handleClearImage() {
        state.uploadedImage = null;
        state.promptParams.imageB64 = null;
        state.promptParams.imageMimeType = null;
        if (fileInputRef) fileInputRef.value = '';
        renderApp();
    }

    function handleUseAsBase(promptText) {
        state.promptParams.description = promptText;
        renderApp();
        showTemporaryNotification('Prompt set as base description!', 'success');
    }

    function handleClearAllAdvanced() {
        state.promptParams.aspectRatio = '';
        state.promptParams.cameraAngle = '';
        state.promptParams.cameraMovement = '';
        state.promptParams.lighting = '';
        state.promptParams.durationHint = '';
        state.promptParams.negativePrompt = '';
        renderApp();
    }

    // Main overlay creation function
    function createMainOverlay() {
        // Load saved window state
        windowState = loadWindowState();

        overlayContainer = document.createElement('div');
        overlayContainer.id = OVERLAY_ID;
        overlayContainer.className = 'vfx-floating-window';
        overlayContainer.style.cssText = `
            position: fixed;
            left: ${windowState.x}px;
            top: ${windowState.y}px;
            width: ${windowState.width}px;
            height: ${windowState.height}px;
            min-width: ${windowState.minWidth}px;
            min-height: ${windowState.minHeight}px;
            max-width: ${windowState.maxWidth}px;
            max-height: ${windowState.maxHeight}px;
            z-index: 2147483645;
            display: ${windowState.isVisible ? 'flex' : 'none'};
            flex-direction: column;
            background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
            font-family: 'Google Sans', 'Segoe UI', sans-serif;
            font-size: 16px;
            color: #ffffff;
            overflow: hidden;
            resize: none;
        `;

        overlayContainer.innerHTML = `
            <!-- Window Header -->
            <header class="flex items-center justify-between p-4 bg-gray-800/50 border-b border-gray-600/30 cursor-move" id="vfx-window-header">
                <div class="flex items-center space-x-3">
                    <div class="w-8 h-8 text-purple-400 flex items-center justify-center flex-shrink-0">
                        <svg viewBox="0 0 24 24" style="width: 32px; height: 32px; max-width: 32px; max-height: 32px;" fill="currentColor">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                        </svg>
                    </div>
                    <h1 class="text-lg font-semibold text-white">${OVERLAY_TITLE}</h1>
                </div>
                <div class="flex items-center space-x-2">
                    <div class="relative">
                        <button id="vfx-tools-menu-btn" class="p-2 rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 hover:text-white transition-colors" title="Tools">
                            ${createIconSpanHTML("build", "default", "w-5 h-5")}
                        </button>
                        <div id="vfx-tools-dropdown" class="hidden absolute right-0 top-full mt-2 w-64 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 overflow-hidden">
                            <div class="p-2 space-y-1">
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="prompt-to-storyboard">
                                    ${createIconSpanHTML("auto_stories", "default", "w-4 h-4 mr-2")} Prompt to Storyboard
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="character-detail-generator">
                                    ${createIconSpanHTML("person", "default", "w-4 h-4 mr-2")} Character Detail Generator
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="theme-explorer">
                                    ${createIconSpanHTML("explore", "default", "w-4 h-4 mr-2")} Theme Explorer
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="critique-enhance-prompt">
                                    ${createIconSpanHTML("rate_review", "default", "w-4 h-4 mr-2")} Critique & Enhance Prompt
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="elaborate-current-prompt">
                                    ${createIconSpanHTML("edit_note", "default", "w-4 h-4 mr-2")} Elaborate Current Prompt
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="suggest-shot-sequence">
                                    ${createIconSpanHTML("movie", "default", "w-4 h-4 mr-2")} Suggest Shot Sequence
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="transfer-style">
                                    ${createIconSpanHTML("palette", "default", "w-4 h-4 mr-2")} Transfer Style
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="visualize-prompt">
                                    ${createIconSpanHTML("image", "default", "w-4 h-4 mr-2")} Visualize Prompt (UI Only)
                                </button>
                                <hr class="border-gray-600 my-2">
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="advanced-settings">
                                    ${createIconSpanHTML("settings", "default", "w-4 h-4 mr-2")} Advanced Settings
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="surprise-me">
                                    ${createIconSpanHTML("casino", "default", "w-4 h-4 mr-2")} Surprise Me
                                </button>
                                <button class="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white rounded-md flex items-center" data-action="reset-all-fields">
                                    ${createIconSpanHTML("refresh", "default", "w-4 h-4 mr-2")} Reset All Fields
                                </button>
                            </div>
                        </div>
                    </div>
                    <button id="vfx-minimize-btn" class="window-control-btn p-1.5 rounded-lg bg-gray-700/50 hover:bg-yellow-600/50 text-gray-300 hover:text-yellow-300 transition-colors" title="Minimize">
                        ${createIconSpanHTML("minimize", "default", "w-4 h-4")}
                    </button>
                    <button id="vfx-close-btn" class="window-control-btn p-1.5 rounded-lg bg-gray-700/50 hover:bg-red-600/50 text-gray-300 hover:text-red-300 transition-colors" title="Close">
                        ${createIconSpanHTML("close", "default", "w-4 h-4")}
                    </button>
                </div>
            </header>

            <!-- Mode Switcher -->
            <div class="flex bg-gray-800/30 border-b border-gray-600/20">
                <button class="flex-1 py-3 px-4 text-sm font-medium text-purple-400 bg-purple-500/20 border-b-2 border-purple-400" data-mode="generator">
                    Generator
                </button>
                <button class="flex-1 py-3 px-4 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-700/30" data-mode="sceneExtender">
                    Scene Extender
                </button>
            </div>

            <!-- Main Content Area -->
            <main class="flex-1 overflow-y-auto p-4 space-y-4">
                <div id="vfx-artisan-main-content"></div>
                
                <!-- Welcome Screen -->
                <div id="vfx-artisan-welcome" class="flex flex-col items-center justify-center space-y-6 py-8">
                    <div class="w-16 h-16 text-purple-400 mb-4 flex items-center justify-center flex-shrink-0">
                        <svg viewBox="0 0 24 24" style="width: 64px; height: 64px; max-width: 64px; max-height: 64px;" fill="currentColor">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                        </svg>
                    </div>
                    <h2 class="text-2xl font-bold text-white text-center">Welcome to Veo Prompt Artisan</h2>
                    <p class="text-gray-300 text-center max-w-md">Craft the perfect vision. Describe your idea, or upload an image to start.</p>
                    <button id="vfx-get-random-concept-btn" class="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center">
                        ${createIconSpanHTML("casino", "default", "w-5 h-5 mr-2")} Get a Random Concept
                    </button>
                    
                    <div class="w-full max-w-2xl mt-8">
                        <h3 class="text-lg font-semibold text-white mb-4 text-center">Or explore these themes for inspiration:</h3>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            ${INSPIRATION_PROMPTS.map(prompt => `
                                <div class="inspiration-card bg-gray-800/50 border border-gray-600/30 rounded-lg p-4 cursor-pointer hover:bg-gray-700/50 transition-colors" data-concept="${sanitizeHTML(prompt.concept)}" data-params='${JSON.stringify(prompt.params)}'>
                                    <h4 class="font-semibold text-purple-300 mb-2">${sanitizeHTML(prompt.title)}</h4>
                                    <p class="text-sm text-gray-300 leading-relaxed">${sanitizeHTML(prompt.concept)}</p>
                                    <button class="mt-3 text-xs px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors">
                                        Use Theme →
                                    </button>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <!-- Prompt List Container -->
                <div id="vfx-artisan-prompt-list" class="hidden"></div>
            </main>

            <!-- Input Section -->
            <div class="p-4 bg-gray-800/30 border-t border-gray-600/20 space-y-4">
                <!-- Image Preview -->
                <div id="vfx-image-preview-container"></div>
                
                <!-- Main Input -->
                <div class="flex space-x-3">
                    <div class="flex-1">
                        <textarea id="vfx-main-textarea" placeholder="Describe your vision... e.g., 'A majestic lion surveying the savanna at dawn'" rows="3" class="w-full bg-gray-700/50 border border-gray-600/50 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"></textarea>
                        <button id="vfx-clear-prompt-btn" class="absolute right-2 top-2 p-1 text-gray-400 hover:text-white rounded" style="display: none;" title="Clear prompt">
                            ${createIconSpanHTML("close", "default", "w-4 h-4")}
                        </button>
                    </div>
                    <div class="flex flex-col space-y-2">
                        <button id="vfx-upload-image-btn" class="p-3 bg-gray-700/50 hover:bg-gray-600/50 border border-gray-600/50 rounded-lg text-gray-300 hover:text-white transition-colors" title="Upload image reference">
                            ${createIconSpanHTML("image", "default", "w-5 h-5")}
                        </button>
                        <button id="vfx-generate-btn" class="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center">
                            <span class="hidden sm:inline">Generate</span>
                            ${createIconSpanHTML("arrow_forward_ios", "filled", "w-6 h-6 sm:ml-2")}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Footer Controls -->
            <footer class="p-4 bg-gray-800/50 border-t border-gray-600/30">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                        <label class="block text-gray-400 mb-1">Outputs per prompt</label>
                        <select id="footer-num-prompts-select" class="w-full bg-gray-700/50 border border-gray-600/50 rounded px-3 py-2 text-white">
                            ${VEO_PROMPT_COUNT_OPTIONS_DISPLAY.map((option, index) => `<option value="${VEO_PROMPT_COUNT_OPTIONS_VALUES[index]}">${option}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block text-gray-400 mb-1">Visual Style</label>
                        <select id="footer-style-select" class="w-full bg-gray-700/50 border border-gray-600/50 rounded px-3 py-2 text-white">
                            ${VEO_STYLES.map(style => `<option value="${sanitizeHTML(style)}">${sanitizeHTML(style || 'Any / Auto')}</option>`).join('')}
                        </select>
                    </div>
                    <div id="footer-audio-toggle" class="md:col-span-2 lg:col-span-1 flex items-center py-1 px-3 rounded-lg border border-gray-500/20 bg-gray-500/5 transition-all duration-200">
                        <label for="vfx-enable-audio-toggle" class="text-gray-300 text-sm mr-3 cursor-pointer">Enable Audio Prompting</label>
                        <button id="vfx-enable-audio-toggle" role="switch" aria-checked="false" class="bg-gray-600 relative inline-flex items-center h-6 rounded-full w-11 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800">
                            <span class="translate-x-1 inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-200 shadow-lg"></span>
                        </button>
                        <span class="text-xs text-gray-400 ml-2">OFF</span>
                    </div>
                </div>
            </footer>

            <!-- Hidden file input -->
            <input type="file" id="vfx-file-input" accept="image/*" style="display: none;">

            <!-- General Modal Container -->
            <div id="vfx-general-modal-container" class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" style="display: none;"></div>

            <!-- Resize Handles -->
            <div class="resize-handle resize-handle-n" style="position: absolute; top: 0; left: 10px; right: 10px; height: 4px; cursor: n-resize;"></div>
            <div class="resize-handle resize-handle-s" style="position: absolute; bottom: 0; left: 10px; right: 10px; height: 4px; cursor: s-resize;"></div>
            <div class="resize-handle resize-handle-e" style="position: absolute; top: 10px; right: 0; bottom: 10px; width: 4px; cursor: e-resize;"></div>
            <div class="resize-handle resize-handle-w" style="position: absolute; top: 10px; left: 0; bottom: 10px; width: 4px; cursor: w-resize;"></div>
            <div class="resize-handle resize-handle-ne" style="position: absolute; top: 0; right: 0; width: 10px; height: 10px; cursor: ne-resize;"></div>
            <div class="resize-handle resize-handle-nw" style="position: absolute; top: 0; left: 0; width: 10px; height: 10px; cursor: nw-resize;"></div>
            <div class="resize-handle resize-handle-se" style="position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; cursor: se-resize;"></div>
            <div class="resize-handle resize-handle-sw" style="position: absolute; bottom: 0; left: 0; width: 10px; height: 10px; cursor: sw-resize;"></div>
        `;

        // Get element references
        mainTextarea = overlayContainer.querySelector('#vfx-main-textarea');
        generateButton = overlayContainer.querySelector('#vfx-generate-btn');
        clearPromptButton = overlayContainer.querySelector('#vfx-clear-prompt-btn');
        uploadImageButton = overlayContainer.querySelector('#vfx-upload-image-btn');
        fileInputRef = overlayContainer.querySelector('#vfx-file-input');
        imagePreviewContainer = overlayContainer.querySelector('#vfx-image-preview-container');
        footerNumPromptsSelect = overlayContainer.querySelector('#footer-num-prompts-select');
        footerStyleSelect = overlayContainer.querySelector('#footer-style-select');
        footerAudioToggle = overlayContainer.querySelector('#footer-audio-toggle');
        generalModalContainer = overlayContainer.querySelector('#vfx-general-modal-container');

        // Attach event listeners
        attachEventListeners();

        document.body.appendChild(overlayContainer);
        
        // Initial render
        renderApp();
        updateOverlayFontSize();
    }

    function attachEventListeners() {
        // Main input events
        if (mainTextarea) {
            mainTextarea.addEventListener('input', (e) => {
                handleParamChange({ description: e.target.value });
            });
        }

        if (generateButton) {
            generateButton.addEventListener('click', handleGeneratePrompts);
        }

        if (clearPromptButton) {
            clearPromptButton.addEventListener('click', handleClearPrompt);
        }

        if (uploadImageButton) {
            uploadImageButton.addEventListener('click', () => fileInputRef?.click());
        }

        if (fileInputRef) {
            fileInputRef.addEventListener('change', handleImageUpload);
        }

        // Footer controls
        if (footerNumPromptsSelect) {
            footerNumPromptsSelect.addEventListener('change', (e) => {
                handleParamChange({ numberOfPrompts: parseInt(e.target.value) });
            });
        }

        if (footerStyleSelect) {
            footerStyleSelect.addEventListener('change', (e) => {
                console.log('[VideoFX Artisan] Style selection changed to:', e.target.value);
                handleParamChange({ style: e.target.value });
            });
        }

        // Audio toggle
        const audioToggleBtn = footerAudioToggle?.querySelector('#vfx-enable-audio-toggle');
        if (audioToggleBtn) {
            audioToggleBtn.addEventListener('click', () => {
                const newValue = !state.promptParams.enableAudioPrompting;
                handleParamChange({ enableAudioPrompting: newValue });
                console.log('[VideoFX Artisan] Audio prompting toggled to:', newValue);
            });
        }

        // Tools dropdown
        const toolsBtn = overlayContainer.querySelector('#vfx-tools-menu-btn');
        const toolsDropdown = overlayContainer.querySelector('#vfx-tools-dropdown');
        
        if (toolsBtn && toolsDropdown) {
            toolsBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const isHidden = toolsDropdown.classList.contains('hidden');
                toolsDropdown.classList.toggle('hidden', !isHidden);
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (event) => {
                if (!toolsDropdown.classList.contains('hidden') && 
                    !toolsBtn.contains(event.target) && 
                    !toolsDropdown.contains(event.target)) {
                    toolsDropdown.classList.add('hidden');
                }
            });

            // Tool actions
            toolsDropdown.addEventListener('click', (e) => {
                const action = e.target.closest('[data-action]')?.dataset.action;
                if (action) {
                    handleToolAction(action);
                    toolsDropdown.classList.add('hidden');
                }
            });
        }

        // Window controls
        const closeBtn = overlayContainer.querySelector('#vfx-close-btn');
        const minimizeBtn = overlayContainer.querySelector('#vfx-minimize-btn');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                windowState.isVisible = false;
                overlayContainer.style.display = 'none';
                saveWindowState();
            });
        }

        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                windowState.isMinimized = !windowState.isMinimized;
                overlayContainer.style.height = windowState.isMinimized ? '60px' : windowState.height + 'px';
                saveWindowState();
            });
        }

        // Inspiration cards
        overlayContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.inspiration-card');
            if (card) {
                const concept = card.dataset.concept;
                const params = JSON.parse(card.dataset.params || '{}');
                
                state.promptParams.description = concept;
                Object.assign(state.promptParams, params);
                renderApp();
                showTemporaryNotification('Theme applied!', 'success');
            }
        });

        // Random concept button
        const randomBtn = overlayContainer.querySelector('#vfx-get-random-concept-btn');
        if (randomBtn) {
            randomBtn.addEventListener('click', () => {
                // Mock random concept generation
                const concepts = [
                    "A steampunk airship floating through cotton candy clouds at sunset",
                    "A cyberpunk cat hacker typing on a holographic keyboard in a neon alley",
                    "An ancient tree with glowing roots in a mystical forest clearing"
                ];
                const randomConcept = concepts[Math.floor(Math.random() * concepts.length)];
                state.promptParams.description = randomConcept;
                renderApp();
                showTemporaryNotification('Random concept generated!', 'success');
            });
        }

        // Window resize and drag functionality
        setupWindowInteractions();
    }

    function handleToolAction(action) {
        console.log('[VideoFX Artisan] Tool action:', action);
        
        switch (action) {
            case 'advanced-settings':
                openModal('advancedSettings');
                break;
            case 'surprise-me':
                // Mock surprise me functionality
                const surprises = [
                    "A philosophical robot contemplating existence while sitting on a park bench",
                    "Dancing mushrooms in a fairy ring during a thunderstorm",
                    "A time-traveling barista serving coffee to historical figures"
                ];
                const surprise = surprises[Math.floor(Math.random() * surprises.length)];
                state.promptParams.description = surprise;
                renderApp();
                showTemporaryNotification('Surprise concept applied!', 'success');
                break;
            case 'reset-all-fields':
                state.promptParams = {
                    description: '',
                    style: "",
                    aspectRatio: '',
                    cameraAngle: '',
                    cameraMovement: '',
                    lighting: '',
                    durationHint: '',
                    negativePrompt: '',
                    numberOfPrompts: VEO_PROMPT_COUNT_OPTIONS_VALUES[0],
                    imageB64: null,
                    imageMimeType: null,
                    enableAudioPrompting: false
                };
                state.uploadedImage = null;
                if (fileInputRef) fileInputRef.value = '';
                renderApp();
                showTemporaryNotification('All fields reset!', 'success');
                break;
            default:
                showTemporaryNotification(`${action} feature coming soon!`, 'info');
        }
    }

    function setupWindowInteractions() {
        const header = overlayContainer.querySelector('#vfx-window-header');
        
        // Dragging
        if (header) {
            header.addEventListener('mousedown', (e) => {
                if (e.target.closest('button')) return;
                
                isDragging = true;
                const rect = overlayContainer.getBoundingClientRect();
                dragOffset.x = e.clientX - rect.left;
                dragOffset.y = e.clientY - rect.top;
                
                document.addEventListener('mousemove', handleDrag);
                document.addEventListener('mouseup', stopDrag);
                e.preventDefault();
            });
        }

        // Resizing
        overlayContainer.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                resizeHandle = handle.className.split(' ').find(c => c.startsWith('resize-handle-')).split('-')[2];
                
                document.addEventListener('mousemove', handleResize);
                document.addEventListener('mouseup', stopResize);
                e.preventDefault();
                e.stopPropagation();
            });
        });
    }

    function handleDrag(e) {
        if (!isDragging) return;
        
        const newX = e.clientX - dragOffset.x;
        const newY = e.clientY - dragOffset.y;
        const constrained = constrainToBounds(newX, newY, windowState.width, windowState.height);
        
        overlayContainer.style.left = constrained.x + 'px';
        overlayContainer.style.top = constrained.y + 'px';
        windowState.x = constrained.x;
        windowState.y = constrained.y;
    }

    function stopDrag() {
        isDragging = false;
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', stopDrag);
        saveWindowState();
    }

    function handleResize(e) {
        if (!isResizing) return;
        
        const rect = overlayContainer.getBoundingClientRect();
        let newWidth = windowState.width;
        let newHeight = windowState.height;
        let newX = windowState.x;
        let newY = windowState.y;

        switch (resizeHandle) {
            case 'se':
                newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, e.clientX - rect.left));
                newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, e.clientY - rect.top));
                break;
            case 'sw':
                newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, rect.right - e.clientX));
                newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, e.clientY - rect.top));
                newX = Math.max(0, e.clientX);
                break;
            case 'ne':
                newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, e.clientX - rect.left));
                newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, rect.bottom - e.clientY));
                newY = Math.max(0, e.clientY);
                break;
            case 'nw':
                newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, rect.right - e.clientX));
                newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, rect.bottom - e.clientY));
                newX = Math.max(0, e.clientX);
                newY = Math.max(0, e.clientY);
                break;
            case 'n':
                newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, rect.bottom - e.clientY));
                newY = Math.max(0, e.clientY);
                break;
            case 's':
                newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, e.clientY - rect.top));
                break;
            case 'e':
                newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, e.clientX - rect.left));
                break;
            case 'w':
                newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, rect.right - e.clientX));
                newX = Math.max(0, e.clientX);
                break;
        }

        overlayContainer.style.width = newWidth + 'px';
        overlayContainer.style.height = newHeight + 'px';
        overlayContainer.style.left = newX + 'px';
        overlayContainer.style.top = newY + 'px';
        
        windowState.width = newWidth;
        windowState.height = newHeight;
        windowState.x = newX;
        windowState.y = newY;
        
        debouncedUpdateOverlayFontSizeDuringResize();
    }

    function stopResize() {
        isResizing = false;
        resizeHandle = null;
        document.removeEventListener('mousemove', handleResize);
        document.removeEventListener('mouseup', stopResize);
        updateOverlayFontSize();
        saveWindowState();
    }

    // Toggle button creation
    function createToggleButton() {
        if (document.getElementById(TOGGLE_BUTTON_ID)) return;

        toggleButton = document.createElement('button');
        toggleButton.id = TOGGLE_BUTTON_ID;
        toggleButton.innerHTML = `<svg viewBox="0 0 24 24" style="width: 28px; height: 28px; max-width: 28px; max-height: 28px; color: #A78BFA;" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
        toggleButton.title = `${OVERLAY_TITLE} (v${SCRIPT_VERSION})`;
        toggleButton.setAttribute('aria-label', 'Toggle Veo Prompt Artisan');
        toggleButton.setAttribute('aria-pressed', 'false');

        toggleButton.addEventListener('click', () => {
            windowState.isVisible = !windowState.isVisible;
            overlayContainer.style.display = windowState.isVisible ? 'flex' : 'none';
            toggleButton.setAttribute('aria-pressed', String(windowState.isVisible));
            saveWindowState();
            
            if (windowState.isVisible) {
                showTemporaryNotification('Veo Prompt Artisan activated!', 'success');
            }
        });

        document.body.appendChild(toggleButton);
    }

    // Main initialization
    function init() {
        console.log(`[VideoFX Artisan] Initializing v${SCRIPT_VERSION}...`);
        
        // Add CSS styles
        addStyles();
        
        // Create UI elements
        createToggleButton();
        createMainOverlay();

        // Setup window resize handler
        addTrackedEventListener(window, 'resize', debouncedWindowResize);
        // Allow closing the overlay with the Escape key
        addTrackedEventListener(document, 'keydown', (e) => {
            if (e.key === 'Escape' && windowState.isVisible) {
                windowState.isVisible = false;
                overlayContainer.style.display = 'none';
                toggleButton.setAttribute('aria-pressed', 'false');
                saveWindowState();
            }
        });
        
        console.log(`[VideoFX Artisan] Initialization complete v${SCRIPT_VERSION}`);
        showTemporaryNotification(`VideoFX Prompt Artisan v${SCRIPT_VERSION} loaded!`, 'success');
    }

    // CSS Styles
    function addStyles() {
        GM_addStyle(`
            /* CRITICAL FIX: Tools dropdown z-index to prevent overlap */
            #vfx-artisan-overlay #vfx-tools-dropdown {
                z-index: 2147483647 !important;
                position: absolute !important;
                background-color: #1f2937 !important;
                border: 1px solid #374151 !important;
                box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5) !important;
            }

            /* Ensure the overlay itself has proper z-index */
            #vfx-artisan-overlay {
                z-index: 2147483645 !important;
            }

            /* Fix dropdown clipping issues */
            #vfx-artisan-overlay .relative {
                overflow: visible !important;
            }

            /* Ensure tools dropdown is properly positioned */
            #vfx-artisan-overlay #vfx-tools-dropdown.hidden {
                display: none !important;
            }

            #vfx-artisan-overlay #vfx-tools-dropdown:not(.hidden) {
                display: block !important;
            }

            /* Toggle button styles */
            #${TOGGLE_BUTTON_ID} {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 60px;
                height: 60px;
                background-color: #1f2937;
                border: 2px solid #374151;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 2147483646;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                cursor: pointer;
                transition: background-color 0.2s ease-in-out, transform 0.2s ease-in-out;
            }
            
            #${TOGGLE_BUTTON_ID}:hover {
                background-color: #374151;
                transform: scale(1.1);
            }
            
            #${TOGGLE_BUTTON_ID} > svg {
                width: 1.75rem;
                height: 1.75rem;
                fill: #A78BFA;
            }
            
            #${TOGGLE_BUTTON_ID} > span {
                font-size: 1.75em;
                color: #A78BFA;
            }

            /* Animation classes */
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            @keyframes popIn {
                from { opacity: 0; transform: scale(0.9); }
                to { opacity: 1; transform: scale(1); }
            }
            
            .animate-fadeIn {
                animation: fadeIn 0.3s ease-out;
            }
            
            .animate-popIn {
                animation: popIn 0.3s ease-out;
            }

            /* Custom scrollbar */
            .custom-scrollbar::-webkit-scrollbar {
                width: 8px;
            }
            
            .custom-scrollbar::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2);
                border-radius: 4px;
            }
            
            .custom-scrollbar::-webkit-scrollbar-thumb {
                background-color: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
            }
            
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                background-color: rgba(255, 255, 255, 0.3);
            }

            /* BUTTON STYLING FIXES */
            .vfx-floating-window button {
                cursor: pointer !important;
                transition: all 0.2s ease !important;
                border: none !important;
                outline: none !important;
            }

            .vfx-floating-window button:hover {
                transform: translateY(-1px) !important;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2) !important;
            }

            /* Generate button styling */
            .vfx-floating-window #vfx-generate-btn {
                background: linear-gradient(135deg, #9333EA, #7C3AED) !important;
                color: white !important;
                padding: 12px 24px !important;
                border-radius: 8px !important;
                font-weight: 600 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
            }

            .vfx-floating-window #vfx-generate-btn:hover {
                background: linear-gradient(135deg, #7C3AED, #6D28D9) !important;
            }

            /* Random concept button styling */
            .vfx-floating-window #vfx-get-random-concept-btn {
                background: linear-gradient(135deg, #9333EA, #7C3AED) !important;
                color: white !important;
                padding: 10px 20px !important;
                border-radius: 8px !important;
                font-weight: 500 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
            }

            /* Theme card styling */
            .vfx-floating-window .inspiration-card {
                background: rgba(55, 65, 81, 0.5) !important;
                border: 1px solid rgba(75, 85, 99, 0.3) !important;
                border-radius: 12px !important;
                padding: 16px !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
            }

            .vfx-floating-window .inspiration-card:hover {
                background: rgba(75, 85, 99, 0.5) !important;
                border-color: rgba(147, 51, 234, 0.5) !important;
                transform: translateY(-2px) !important;
            }

            .vfx-floating-window .inspiration-card button {
                background: linear-gradient(135deg, #9333EA, #7C3AED) !important;
                color: white !important;
                padding: 6px 12px !important;
                border-radius: 6px !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                margin-top: 8px !important;
            }

            /* Mode switcher styling */
            .vfx-floating-window [data-mode] {
                padding: 12px 16px !important;
                font-weight: 500 !important;
                transition: all 0.2s ease !important;
                border-bottom: 2px solid transparent !important;
            }

            .vfx-floating-window [data-mode].active,
            .vfx-floating-window [data-mode][class*="purple"] {
                background: rgba(147, 51, 234, 0.2) !important;
                color: #A78BFA !important;
                border-bottom-color: #9333EA !important;
            }

            /* Input styling */
            .vfx-floating-window textarea,
            .vfx-floating-window select {
                background: rgba(55, 65, 81, 0.5) !important;
                border: 1px solid rgba(75, 85, 99, 0.5) !important;
                border-radius: 8px !important;
                color: white !important;
                padding: 12px !important;
                transition: all 0.2s ease !important;
            }

            .vfx-floating-window textarea:focus,
            .vfx-floating-window select:focus {
                border-color: #9333EA !important;
                box-shadow: 0 0 0 3px rgba(147, 51, 234, 0.1) !important;
                outline: none !important;
            }

            /* Upload button styling */
            .vfx-floating-window #vfx-upload-image-btn {
                background: rgba(55, 65, 81, 0.5) !important;
                border: 1px solid rgba(75, 85, 99, 0.5) !important;
                border-radius: 8px !important;
                color: #9CA3AF !important;
                padding: 12px !important;
                transition: all 0.2s ease !important;
            }

            .vfx-floating-window #vfx-upload-image-btn:hover {
                background: rgba(75, 85, 99, 0.5) !important;
                color: white !important;
            }

            /* Tools button styling */
            .vfx-floating-window #vfx-tools-menu-btn {
                background: rgba(55, 65, 81, 0.5) !important;
                border: 1px solid rgba(75, 85, 99, 0.5) !important;
                border-radius: 8px !important;
                color: #9CA3AF !important;
                padding: 8px !important;
                transition: all 0.2s ease !important;
            }

            .vfx-floating-window #vfx-tools-menu-btn:hover {
                background: rgba(75, 85, 99, 0.5) !important;
                color: white !important;
            }

            /* Window control buttons */
            .vfx-floating-window .window-control-btn {
                background: rgba(55, 65, 81, 0.5) !important;
                border: 1px solid rgba(75, 85, 99, 0.5) !important;
                border-radius: 6px !important;
                color: #9CA3AF !important;
                padding: 6px !important;
                transition: all 0.2s ease !important;
            }

            .vfx-floating-window #vfx-minimize-btn:hover {
                background: rgba(251, 191, 36, 0.2) !important;
                color: #FCD34D !important;
            }

            .vfx-floating-window #vfx-close-btn:hover {
                background: rgba(239, 68, 68, 0.2) !important;
                color: #F87171 !important;
            }

            /* Audio toggle styling */
            .vfx-floating-window #vfx-enable-audio-toggle {
                background: #4B5563 !important;
                border: 1px solid rgba(75, 85, 99, 0.5) !important;
                border-radius: 12px !important;
                width: 44px !important;
                height: 24px !important;
                position: relative !important;
                transition: all 0.2s ease !important;
                cursor: pointer !important;
            }

            .vfx-floating-window #vfx-enable-audio-toggle.bg-purple-600 {
                background: #9333EA !important;
            }

            .vfx-floating-window #vfx-enable-audio-toggle span {
                display: block !important;
                width: 16px !important;
                height: 16px !important;
                background: white !important;
                border-radius: 50% !important;
                position: absolute !important;
                top: 3px !important;
                left: 4px !important;
                transition: transform 0.2s ease !important;
            }

            .vfx-floating-window #vfx-enable-audio-toggle span.translate-x-6 {
                transform: translateX(20px) !important;
            }
        `);

        // Font imports
        GM_addStyle("@import url('https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap');");
        GM_addStyle("@import url('https://fonts.googleapis.com/icon?family=Material+Icons|Material+Icons+Outlined');");
        GM_addStyle("@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');");
    }

    // Initialize the script
    init();

    // MINIMAL FIXES - Applied at the end to ensure they work
    setTimeout(() => {
        console.log('[VideoFX Artisan] Applying minimal fixes...');
        
        // Fix 1: Ensure visual style selection works
        const styleSelect = document.querySelector('#footer-style-select');
        if (styleSelect) {
            console.log('[VideoFX Artisan] Style select found, ensuring proper event handling');
            
            // Add enhanced change handler that ensures style is properly set
            styleSelect.addEventListener('change', function(e) {
                const selectedStyle = e.target.value;
                console.log('[VideoFX Artisan] Style selection changed to:', selectedStyle);
                
                // Ensure the style is properly set in the global state
                if (typeof state !== 'undefined' && state.promptParams) {
                    state.promptParams.style = selectedStyle;
                    console.log('[VideoFX Artisan] Style updated in state:', state.promptParams.style);
                }
            });
        }

        // Fix 2: Ensure tools dropdown behavior is correct
        const toolsBtn = document.querySelector('#vfx-tools-menu-btn');
        const toolsDropdown = document.querySelector('#vfx-tools-dropdown');
        
        if (toolsBtn && toolsDropdown) {
            console.log('[VideoFX Artisan] Tools elements found, ensuring proper behavior');
            
            // Ensure dropdown starts hidden
            toolsDropdown.classList.add('hidden');
            
            // Enhanced click handler
            toolsBtn.addEventListener('click', function(event) {
                event.stopPropagation();
                const isHidden = toolsDropdown.classList.contains('hidden');
                toolsDropdown.classList.toggle('hidden', !isHidden);
                console.log('[VideoFX Artisan] Tools dropdown toggled, hidden:', !isHidden);
            });
        }

        console.log('[VideoFX Artisan] Minimal fixes applied successfully - version 3.2.8');
    }, 2000);

})();

