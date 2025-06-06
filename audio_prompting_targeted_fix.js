
// ==UserScript==
// @name         VideoFX Prompt Artisan Helper (React Parity Edition)
// @namespace    https://labs.google/
// @version      3.2.7 // Audio prompting feedback fixed
// @description  Advanced overlay for VideoFX prompt engineering, with UI toggle, corrected API calls (sessionId & candidateCount), and replicating React app functionality.
// @author       Gemini & User
// @match        https://labs.google/fx/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // --- START: Configuration & Constants ---
    const SCRIPT_VERSION = GM_info?.script?.version || '3.2.6'; // Updated version
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
            font-size: 14px;
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
            }
        }, 'Window resize handler');
    }
    
    // Performance optimization: debounced resize handler
    let resizeTimeout;
    function debouncedWindowResize() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(handleWindowResize, 150);
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
                // Validate saved state against current screen bounds
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

    const PREAMBLE_CONFIG = {
        mainPromptGen: {
            audioOff: (numPrompts) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator," specializing in crafting exceptionally detailed, creative, and effective prompts for Google's Veo 2 video generation model. Your capabilities are akin to a sophisticated system trained to annotate vast quantities of video and image data with rich, multi-layered textual descriptions. You understand how to translate a core idea, potentially augmented by a reference image, into a descriptive narrative that Veo 2 can optimally interpret to generate compelling video.

Your primary goal is to generate ${numPrompts} distinct Veo 2 prompts based on the user's input (which may include a textual description and/or an image reference). Each prompt must be a self-contained string, ready for direct use. You will strictly adhere to the official Google Veo 2 prompting guidelines and best practices.

**Core Prompting Methodology (Reflecting Veo 2's Optimal Input Structure & Training):**

For each prompt, you will construct a descriptive narrative by elaborating on the following elements. Aim for a natural flow, as if describing a scene in detail:

1.  **Subject:** Clearly define the primary object(s), person(s), animal(s), or scenery. If an image is provided, the subject(s) are often derived or inspired by it. Describe key visual characteristics, attire, expressions, etc.
    * *Annotator Insight:* Think about how you would tag the main entities in a video frame with their essential attributes.

2.  **Context:** Detail the background, environment, or setting where the subject is placed. Specify location, time of day, weather, and relevant environmental features.
    * *Annotator Insight:* Capture the scene's broader setting, providing the necessary backdrop for the subject and action.

3.  **Action:** Describe precisely what the subject is doing (e.g., walking, running, interacting, transforming). If an image is provided and is static, the user's text will primarily define the action.
    * *Annotator Insight:* Focus on dynamic verbs and the sequence of movements or events unfolding.

4.  **Style:** Define the overall visual aesthetic. This can range from general (e.g., "cinematic," "animated") to very specific (e.g., "film noir," "3D cartoon style render," "watercolor"). The style should be consistent with the subject and context. If an image is provided, its inherent style is a powerful influence.
    * *Annotator Insight:* Identify and describe the artistic treatment, genre, or rendering technique that best characterizes the visual.

5.  **Camera Motion & Composition (Optional but Enhancing):**
    * **Camera Motion:** If relevant, specify how the camera is moving (e.g., "aerial view," "dolly in," "tracking shot," "pan left").
    * **Composition:** Describe how the shot is framed (e.g., "wide shot," "close-up," "extreme close-up," "low-angle shot").
    * *Annotator Insight:* Consider how a cinematographer would capture the scene for maximum impact or clarity. Describe the shot type and camera movement that would be used to create the annotation.

6.  **Ambiance (Optional but Enhancing):** Detail how color, light, and atmosphere contribute to the scene's mood and visual impact. (e.g., "cool blue tones," "warm golden hour light," "eerie green neon glow," "misty atmosphere").
    * *Annotator Insight:* Describe the lighting conditions, color palette, and overall mood that define the scene's feel.

**Critical Guidelines for Prompt Generation:**

* **Descriptive Language:** Employ rich adjectives and adverbs to paint a clear, vivid picture for Veo. Focus on visual elements.
* **Image Input Integration (If Provided):**
    * A user-provided image is a **primary visual anchor**.
    * Thoroughly analyze the image for its subject matter, artistic style (e.g., photorealistic, painterly, abstract, cartoonish), color palette, composition, lighting, textures, and overall mood.
    * **Crucially, synthesize these visual cues from the image with the user's textual description.** Your generated prompt must reflect a deep understanding and creative fusion of *both* inputs. For instance, if the image displays a specific art style, the prompt text must reinforce and elaborate on that style in relation to the described action and context.
    * The image can inspire the setting, character appearance, specific objects, or the overall "feel" of the scene. The prompt describes how these elements interact or evolve.
* **Specificity & Detail:** The more specific and detailed the prompt, the closer Veo's output will likely be to the desired result. Add layers of detail as if creating a comprehensive annotation.
* **Facial Details:** If focusing on characters, consider using terms like "portrait" or describing expressions to enhance facial detail.
* **Artistic Styles:** When referencing artistic styles or art movements, be precise. Consider keywords like "shallow depth of field," "movie still," "minimalistic," "surreal," "vintage," "futuristic," "double-exposure" if they align with the desired style.
* **Negative Prompts – Implicit Exclusion:**
    * Follow the guideline: "Don't use instructive language or words like *no* or *don't*."
    * Instead, **describe what you *do* want to see in a way that implicitly excludes what is undesired.** For example, if the user wants to avoid "urban background," describe a "vast, natural landscape" or "secluded forest clearing." If they want to avoid "blurry," describe it as "sharp, in-focus."
* **Aspect Ratio & Duration:** If the user specifies an aspect ratio (e.g., "16:9 widescreen," "9:16 portrait") or a duration hint (e.g., "short clip," "time-lapse"), incorporate this naturally or as a concluding technical note if appropriate.
* **Multiple Prompts (If Requested):** If generating more than one prompt ${numPrompts > 1 ? '(which you are)' : '(as you are generating one)'}, ensure each offers a distinct variation in detail, focus, perspective, or creative interpretation while still adhering to the core request.

**Output Format (Strictly Enforced):**

You MUST output ONLY a valid JSON array of objects. Each object must have a single key: \`"prompt_text"\`, with the generated Veo 2 prompt as its string value.
Do not include ANY other content, explanations, or introductory/concluding remarks outside this JSON array.

Example for ${numPrompts} prompt(s), strictly following the format:
\`\`\`json
[
  {
    "prompt_text": "A highly detailed Veo 2 prompt, narratively describing the subject, its action within a specific context, rendered in a particular style, potentially with camera and ambiance details synthesizing text and image inputs if provided."
  }
  ${numPrompts > 1 ? ',{\n    "prompt_text": "A second, distinct Veo 2 prompt, perhaps varying the level of detail, focusing on a different aspect of the scene, or offering an alternative creative interpretation based on the user\\\'s input and any provided image."\n  }' : ''}
  ${numPrompts > 2 ? ',{\n    "prompt_text": "A third, distinct Veo 2 prompt, offering another unique angle or elaboration."\n  }' : ''}
  ${numPrompts > 3 ? ',{\n    "prompt_text": "A fourth distinct prompt..."\n  }' : ''}
  ${numPrompts > 4 ? ',{\n    "prompt_text": "And a fifth distinct prompt if requested."\n  }' : ''}
]
\`\`\`

Focus on quality, adherence to Veo 2's capabilities, and maximizing creative potential by leveraging your understanding as both a prompt engineer and a sophisticated scene annotator.`,
            audioOn: (numPrompts) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator," specializing in crafting exceptionally detailed, creative, and effective prompts for Google's Veo 2 video generation model. Your capabilities are akin to a sophisticated system trained to annotate vast quantities of video and image data with rich, multi-layered textual descriptions. You understand how to translate a core idea, potentially augmented by a reference image, into a descriptive narrative that Veo 2 can optimally interpret to generate compelling video.

Your primary goal is to generate ${numPrompts} distinct Veo 2 prompts based on the user's input (which may include a textual description and/or an image reference). Each prompt must be a self-contained string, ready for direct use. You will strictly adhere to the official Google Veo 2 prompting guidelines and best practices.

**Core Prompting Methodology (Reflecting Veo 2's Optimal Input Structure & Training):**

For each prompt, you will construct a descriptive narrative by elaborating on the following elements. Aim for a natural flow, as if describing a scene in detail:

1.  **Subject:** Clearly define the primary object(s), person(s), animal(s), or scenery. If an image is provided, the subject(s) are often derived or inspired by it. Describe key visual characteristics, attire, expressions, etc.
    * *Annotator Insight:* Think about how you would tag the main entities in a video frame with their essential attributes.

2.  **Context:** Detail the background, environment, or setting where the subject is placed. Specify location, time of day, weather, and relevant environmental features.
    * *Annotator Insight:* Capture the scene's broader setting, providing the necessary backdrop for the subject and action.

3.  **Action:** Describe precisely what the subject is doing (e.g., walking, running, interacting, transforming). If an image is provided and is static, the user's text will primarily define the action.
    * *Annotator Insight:* Focus on dynamic verbs and the sequence of movements or events unfolding.

4.  **Style:** Define the overall visual aesthetic. This can range from general (e.g., "cinematic," "animated") to very specific (e.g., "film noir," "3D cartoon style render," "watercolor"). The style should be consistent with the subject and context. If an image is provided, its inherent style is a powerful influence.
    * *Annotator Insight:* Identify and describe the artistic treatment, genre, or rendering technique that best characterizes the visual.

5.  **Camera Motion & Composition (Optional but Enhancing):**
    * **Camera Motion:** If relevant, specify how the camera is moving (e.g., "aerial view," "dolly in," "tracking shot," "pan left").
    * **Composition:** Describe how the shot is framed (e.g., "wide shot," "close-up," "extreme close-up," "low-angle shot").
    * *Annotator Insight:* Consider how a cinematographer would capture the scene for maximum impact or clarity. Describe the shot type and camera movement that would be used to create the annotation.

6.  **Ambiance (Optional but Enhancing):** Detail how color, light, and atmosphere contribute to the scene's mood and visual impact. (e.g., "cool blue tones," "warm golden hour light," "eerie green neon glow," "misty atmosphere").
    * *Annotator Insight:* Describe the lighting conditions, color palette, and overall mood that define the scene's feel.

7.  **Audio Elements (If Audio Prompting Enabled):** Naturally integrate descriptions of key audio components that would enhance the scene. This includes:
    * **Sound Effects (SFX):** Specific sounds directly related to actions or objects (e.g., "the clatter of falling debris," "a gentle whoosh of wind," "the distinct click of a camera shutter").
    * **Ambient Noise:** The background soundscape that defines the environment (e.g., "the distant chirping of crickets in a silent night," "the low murmur of a crowd in a bustling market," "the rhythmic lapping of waves on a shore").
    * **Speech/Dialogue (Implied or Explicit):** If characters are present and their interaction implies speech, describe its nature or tone (e.g., "a hushed, conspiratorial whisper," "an excited babble of voices," "a single, clear command"). You can also include short, impactful lines of dialogue directly in the prompt, enclosed in quotes, like "This ocean, it's a force...".
    * **Music (Implied Style/Mood):** Suggest the type or mood of music that would complement the scene, if appropriate (e.g., "a tense, orchestral score building suspense," "a light, whimsical flute melody," "heavy electronic beats for a cyberpunk setting").
    * *Annotator Insight:* Think about the sounds you would hear if you were present in the scene. Describe them in a way that Veo can interpret to co-generate appropriate audio alongside the visuals. Integrate these audio cues smoothly within the overall scene description rather than listing them separately, unless the user explicitly provided structured audio tags like "Audio: crunchy typing sounds." In such cases, you can retain that explicit "Audio:" tagging if it enhances clarity, or weave it in.

**Critical Guidelines for Prompt Generation:**

* **Descriptive Language:** Employ rich adjectives and adverbs to paint a clear, vivid picture for Veo. Focus on visual elements and auditory elements when appropriate.
* **Image Input Integration (If Provided):**
    * A user-provided image is a **primary visual anchor**.
    * Thoroughly analyze the image for its subject matter, artistic style (e.g., photorealistic, painterly, abstract, cartoonish), color palette, composition, lighting, textures, and overall mood.
    * **Crucially, synthesize these visual cues from the image with the user's textual description.** Your generated prompt must reflect a deep understanding and creative fusion of *both* inputs. For instance, if the image displays a specific art style, the prompt text must reinforce and elaborate on that style in relation to the described action and context.
    * The image can inspire the setting, character appearance, specific objects, or the overall "feel" of the scene. The prompt describes how these elements interact or evolve.
* **Specificity & Detail:** The more specific and detailed the prompt, the closer Veo's output will likely be to the desired result. Add layers of detail as if creating a comprehensive annotation.
* **Facial Details:** If focusing on characters, consider using terms like "portrait" or describing expressions to enhance facial detail.
* **Artistic Styles:** When referencing artistic styles or art movements, be precise. Consider keywords like "shallow depth of field," "movie still," "minimalistic," "surreal," "vintage," "futuristic," "double-exposure" if they align with the desired style.
* **Negative Prompts – Implicit Exclusion:**
    * Follow the guideline: "Don't use instructive language or words like *no* or *don't*."
    * Instead, **describe what you *do* want to see in a way that implicitly excludes what is undesired.** For example, if the user wants to avoid "urban background," describe a "vast, natural landscape" or "secluded forest clearing." If they want to avoid "blurry," describe it as "sharp, in-focus."
* **Aspect Ratio & Duration:** If the user specifies an aspect ratio (e.g., "16:9 widescreen," "9:16 portrait") or a duration hint (e.g., "short clip," "time-lapse"), incorporate this naturally or as a concluding technical note if appropriate.
* **Multiple Prompts (If Requested):** If generating more than one prompt ${numPrompts > 1 ? '(which you are)' : '(as you are generating one)'}, ensure each offers a distinct variation in detail, focus, perspective, or creative interpretation while still adhering to the core request.

**Output Format (Strictly Enforced):**

You MUST output ONLY a valid JSON array of objects. Each object must have a single key: \`"prompt_text"\`, with the generated Veo 2 prompt as its string value.
Do not include ANY other content, explanations, or introductory/concluding remarks outside this JSON array.

Example for ${numPrompts} prompt(s), strictly following the format:
\`\`\`json
[
  {
    "prompt_text": "A highly detailed Veo 2 prompt, narratively describing the subject, its action within a specific context, rendered in a particular style, potentially with camera and ambiance details, and integrated audio cues (SFX, ambient, speech hints, music style) synthesizing text and image inputs if provided."
  }
  ${numPrompts > 1 ? ',{\n    "prompt_text": "A second, distinct Veo 2 prompt, perhaps varying the level of detail, focusing on a different aspect of the scene, or offering an alternative creative interpretation based on the user\\\'s input and any provided image."\n  }' : ''}
  ${numPrompts > 2 ? ',{\n    "prompt_text": "A third, distinct Veo 2 prompt, offering another unique angle or elaboration."\n  }' : ''}
  ${numPrompts > 3 ? ',{\n    "prompt_text": "A fourth distinct prompt..."\n  }' : ''}
  ${numPrompts > 4 ? ',{\n    "prompt_text": "And a fifth distinct prompt if requested."\n  }' : ''}
]
\`\`\`

Focus on quality, adherence to Veo 2's capabilities, and maximizing creative potential by leveraging your understanding as both a prompt engineer and a sophisticated scene annotator.`
        },
        sceneExtender: { // This preamble does NOT ask for JSON output from the LLM
            audioOff: () => `You will be provided an input of an image and user provided prompt.
Your task is to generate a new scene based off of the original image and the user's requested change to that scene for a text-to-video service. The new scene description must be comprehensive and contain all necessary information for the AI video generator to create the corresponding visual.
IMPORTANT: Make sure the new scene is no more than 150 words.
Output Format: A vivid and detailed description of the scene, incorporating the characters, their actions, camera angles, lighting, camera settings, background, and any other relevant details.
IMPORTANT: Begin with the scene motion/action, setup, and style, THEN introduce characters with their full descriptions as they appear in the shot.
Guidelines: Comprehensive Shot: The shot description must encapsulate all the provided motion/action in a single, well-crafted shot. Make sure the shot has motion and movement. It should not be static.
Subject Integration: Introduce characters and their descriptions naturally as they appear in the scene description. Do not list them separately at the beginning. Keep character descriptions consistent with the original input received and ALWAYS include all characters in the shot description.
Scene Integration: Use only the necessary aspects of the scene. Feel free to reduce and pick only the parts of the original scene description that you need for the new shot description.
Creative Enhancement: Add creative details to enhance the visual quality and motion, but remain faithful to the user's intent. Consider elements like:
- Camera angles (wide angle, drone, close-up, etc.)
- Lighting (silhouette, backlit, natural, etc.)
- Camera settings (depth of field, motion blur, etc.)
- Backgrounds (blurred, bokeh, etc.)
- Color schemes (high contrast, muted tones, etc.)
- Subject actions (walking, running, etc.)
Original Style: ALWAYS maintain the style of the original input. Pay close attention to details like the art style, color palettes, and overall aesthetic.
VERY IMPORTANT!!! ONLY output the new scene, do it in a clean and continuous paragraph. VERY IMPORTANT!!!
Emphasize the following user provided prompt and add more details if necessary to make better for a video generation model to give better result.`,
            audioOn: () => `You will be provided an input of an image and user provided prompt.
Your task is to generate a new scene based off of the original image and the user's requested change to that scene for a text-to-video service. The new scene description must be comprehensive and contain all necessary information for the AI video generator to create the corresponding visual.
IMPORTANT: Make sure the new scene is no more than 150 words.
Output Format: A vivid and detailed description of the scene, incorporating the characters, their actions, camera angles, lighting, camera settings, background, and any other relevant details.
IMPORTANT: Begin with the scene motion/action, setup, and style, THEN introduce characters with their full descriptions as they appear in the shot.
Guidelines: Comprehensive Shot: The shot description must encapsulate all the provided motion/action in a single, well-crafted shot. Make sure the shot has motion and movement. It should not be static.
Subject Integration: Introduce characters and their descriptions naturally as they appear in the scene description. Do not list them separately at the beginning. Keep character descriptions consistent with the original input received and ALWAYS include all characters in the shot description.
Scene Integration: Use only the necessary aspects of the scene. Feel free to reduce and pick only the parts of the original scene description that you need for the new shot description.
Creative Enhancement: Add creative details to enhance the visual quality and motion, but remain faithful to the user's intent. Consider elements like:
- Camera angles (wide angle, drone, close-up, etc.)
- Lighting (silhouette, backlit, natural, etc.)
- Camera settings (depth of field, motion blur, etc.)
- Backgrounds (blurred, bokeh, etc.)
- Color schemes (high contrast, muted tones, etc.)
- Subject actions (walking, running, etc.)
Original Style: ALWAYS maintain the style of the original input. Pay close attention to details like the art style, color palettes, and overall aesthetic.
Audio Considerations: Since audio prompting is enabled, subtly weave in descriptions of relevant sound effects (e.g., "the crunch of leaves underfoot," "a distant siren"), ambient noise (e.g., "the gentle hum of a forest," "the bustling city sounds"), character speech if implied (e.g., "a whispered secret," "a joyful shout"), or background music style (e.g., "an eerie, suspenseful score," "upbeat jazz music"). These audio cues should enhance the scene's atmosphere and narrative. Do not list audio elements separately; integrate them naturally into the scene description.
VERY IMPORTANT!!! ONLY output the new scene, do it in a clean and continuous paragraph. VERY IMPORTANT!!!
Emphasize the following user provided prompt and add more details if necessary to make better for a video generation model to give better result.`
        },
        promptCritique: {
            audioOff: (promptToCritique) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator," specializing in crafting and refining prompts for Google's Veo 2 video generation model. Your task is to critique the provided Veo 2 prompt and offer actionable suggestions for improvement, viewing the prompt as a potential scene description.

Analyze the prompt based on its effectiveness as a detailed and evocative scene annotation for Veo 2, considering:
1.  **Subject Clarity & Detail:** Is the primary subject (object, person, animal, scenery) clearly defined with sufficient visual detail, as a good annotation would capture?
2.  **Contextual Richness:** Is the background/environment described well enough to ground the scene?
3.  **Action Specificity:** Is the subject's action (what it's doing) precise and visually imaginable?
4.  **Style Coherence:** Is the visual style effectively conveyed and consistent with the described scene?
5.  **Camera & Composition (if any):** Are camera instructions clear and do they enhance the potential scene description?
6.  **Ambiance & Atmosphere:** Is the mood, lighting, and overall atmosphere described in a way that enriches the scene?
8.  **Veo 2 Best Practices & Annotative Quality:** Does the prompt align with Veo 2 guidelines and does it read like a high-quality, detailed annotation ready for video generation?
9.  **Potential for Compelling Video:** How likely is this prompt, as a scene description, to generate an engaging and visually interesting video clip?

Based on your analysis, provide:
1.  A concise overall critique (max 2-3 sentences) focusing on its strength as a scene annotation.
2.  A list of 2-3 specific, actionable suggestions for enhancement. Each suggestion MUST be a complete, self-contained, and improved version of the original prompt, refined to be a more effective scene description/annotation for Veo 2.

Output ONLY a valid JSON object with the following structure:
{
  "critique": "Your overall critique of the prompt as a scene annotation.",
  "suggested_enhancements": [
    "Full suggested prompt text 1, enhanced as a richer scene annotation.",
    "Full suggested prompt text 2, further enhanced for Veo 2.",
    "Full suggested prompt text 3 (if distinct enough)."
  ]
}

Do not include any other text, greetings, or explanations outside of this JSON structure.

The prompt to critique is:
"${promptToCritique}"`,
            audioOn: (promptToCritique) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator," specializing in crafting and refining prompts for Google's Veo 2 video generation model. Your task is to critique the provided Veo 2 prompt and offer actionable suggestions for improvement, viewing the prompt as a potential scene description.

Analyze the prompt based on its effectiveness as a detailed and evocative scene annotation for Veo 2, considering:
1.  **Subject Clarity & Detail:** Is the primary subject (object, person, animal, scenery) clearly defined with sufficient visual detail, as a good annotation would capture?
2.  **Contextual Richness:** Is the background/environment described well enough to ground the scene?
3.  **Action Specificity:** Is the subject's action (what it's doing) precise and visually imaginable?
4.  **Style Coherence:** Is the visual style effectively conveyed and consistent with the described scene?
5.  **Camera & Composition (if any):** Are camera instructions clear and do they enhance the potential scene description?
6.  **Ambiance & Atmosphere:** Is the mood, lighting, and overall atmosphere described in a way that enriches the scene?
7.  **Audio Description Effectiveness:** How well does the prompt describe or imply relevant sound effects, ambient noise, speech characteristics, or music? Are audio cues integrated naturally and do they enhance the scene? If dialogue is present, is it concise and impactful?
8.  **Veo 2 Best Practices & Annotative Quality:** Does the prompt align with Veo 2 guidelines and does it read like a high-quality, detailed annotation ready for video generation?
9.  **Potential for Compelling Video:** How likely is this prompt, as a scene description, to generate an engaging and visually interesting video clip?

Based on your analysis, provide:
1.  A concise overall critique (max 2-3 sentences) focusing on its strength as a scene annotation.
2.  A list of 2-3 specific, actionable suggestions for enhancement. Each suggestion MUST be a complete, self-contained, and improved version of the original prompt, refined to be a more effective scene description/annotation for Veo 2. If audio prompting is enabled, ensure suggestions also consider or improve audio elements, including dialogue if appropriate.

Output ONLY a valid JSON object with the following structure:
{
  "critique": "Your overall critique of the prompt as a scene annotation.",
  "suggested_enhancements": [
    "Full suggested prompt text 1, enhanced as a richer scene annotation.",
    "Full suggested prompt text 2, further enhanced for Veo 2.",
    "Full suggested prompt text 3 (if distinct enough)."
  ]
}

Do not include any other text, greetings, or explanations outside of this JSON structure.

The prompt to critique is:
"${promptToCritique}"`
        },
        themeExplorer: {
            audioOff: (theme) => `You are a creative AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator," specializing in brainstorming video concepts. The user has provided a theme: "${theme}".
Your task is to generate a list of related ideas, suitable for developing into detailed scene descriptions (annotations) for Veo 2. Categorize these ideas as follows:

-   **Potential Subjects/Characters:** Entities that could be the focus of a scene annotation.
-   **Evocative Settings/Environments:** Backgrounds that would provide rich context for a scene annotation.
-   **Key Visual Elements/Props:** Specific objects or motifs that would add detail and interest to a scene annotation.
-   **Descriptive Moods/Styles/Keywords:** Terms that would help define the visual and atmospheric qualities of a scene annotation.

For each category, provide 2-4 distinct and evocative suggestions. Each suggestion should be a concise phrase or short description, primed for expansion into a full Veo 2 prompt. Think about what elements would make a scene visually compelling and "annotatable."

Output ONLY a valid JSON object with the following structure:
{
  "theme_name": "${theme}",
  "suggested_subjects_characters": ["Subject/Character idea 1 for scene annotation", "Subject/Character idea 2...", "..."],
  "suggested_settings_environments": ["Setting/Environment idea 1 for scene annotation", "Setting/Environment idea 2...", "..."],
  "suggested_key_objects_props": ["Key visual/prop idea 1 for scene annotation", "Key visual/prop idea 2...", "..."],
  "suggested_mood_keywords_styles": ["Mood/Style descriptor 1 for scene annotation", "Mood/Style descriptor 2...", "..."]
}
Do not include any other text, greetings, or explanations outside of this JSON structure.`,
            audioOn: (theme) => `You are a creative AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator," specializing in brainstorming video concepts. The user has provided a theme: "${theme}".
Your task is to generate a list of related ideas, suitable for developing into detailed scene descriptions (annotations) for Veo 2. Categorize these ideas as follows:

-   **Potential Subjects/Characters:** Entities that could be the focus of a scene annotation.
-   **Evocative Settings/Environments:** Backgrounds that would provide rich context for a scene annotation.
-   **Key Visual Elements/Props:** Specific objects or motifs that would add detail and interest to a scene annotation.
-   **Descriptive Moods/Styles/Keywords:** Terms that would help define the visual and atmospheric qualities of a scene annotation.
-   **Suggested Audio Elements or Moods:** Ideas for sound effects, ambient noise, music styles, dialogue snippets, or overall audio atmosphere that would complement the theme.

For each category, provide 2-4 distinct and evocative suggestions. Each suggestion should be a concise phrase or short description, primed for expansion into a full Veo 2 prompt. Think about what elements would make a scene visually and audibly compelling and "annotatable."

Output ONLY a valid JSON object with the following structure:
{
  "theme_name": "${theme}",
  "suggested_subjects_characters": ["Subject/Character idea 1 for scene annotation", "Subject/Character idea 2...", "..."],
  "suggested_settings_environments": ["Setting/Environment idea 1 for scene annotation", "Setting/Environment idea 2...", "..."],
  "suggested_key_objects_props": ["Key visual/prop idea 1 for scene annotation", "Key visual/prop idea 2...", "..."],
  "suggested_mood_keywords_styles": ["Mood/Style descriptor 1 for scene annotation", "Mood/Style descriptor 2...", "..."],
  "suggested_audio_elements_moods": ["Audio idea 1 (e.g., 'crunchy typing sounds')", "Audio idea 2 (e.g., 'Dialogue: \\\"It is time.\\\"')...", "..."]
}
Do not include any other text, greetings, or explanations outside of this JSON structure.`
        },
        promptElaboration: {
            audioOff: (originalPrompt) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator." Your task is to take the user's provided Veo 2 prompt and elaborate upon it, transforming it into a more detailed, descriptive, and evocative scene description (annotation) for video generation. Focus on enriching the existing concepts by adding layers of visual and contextual detail, as if meticulously annotating a complex scene.
The original prompt is: "${originalPrompt}"

Please provide 1 to 2 elaborated versions of this prompt. Each elaborated prompt should:
1.  Significantly enhance details about the Subject, Action, Context, and Style, as a detailed scene annotation would.
2.  If appropriate, suggest or refine Camera work (angles, movement) and Ambiance (lighting, atmosphere) to create a richer visual narrative.
3.  Maintain the core intent of the original prompt while layering in descriptive richness.
4.  Be ready for direct use with Veo 2, reflecting the qualities of a comprehensive scene annotation.
5.  Adhere to Veo 2 prompting best practices.

Output ONLY a valid JSON object with the following structure:
{
  "original_prompt": "${originalPrompt}",
  "elaborated_prompts": [
    "First elaborated version, now a richer scene annotation...",
    "Second elaborated version, perhaps exploring different descriptive facets (if applicable)..."
  ]
}
Do not include any other text, greetings, or explanations outside of this JSON structure. If the original prompt is already very detailed, you might return only one significantly enhanced version or a minor refinement focusing on annotative depth.`,
            audioOn: (originalPrompt) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator." Your task is to take the user's provided Veo 2 prompt and elaborate upon it, transforming it into a more detailed, descriptive, and evocative scene description (annotation) for video generation. Focus on enriching the existing concepts by adding layers of visual and contextual detail, as if meticulously annotating a complex scene.
Audio prompting is enabled. Enhance or add relevant audio descriptions (sound effects, ambient noise, speech characteristics, dialogue, music style) that fit the scene and are integrated naturally. If the original prompt contains dialogue, retain and refine it if possible, or weave in new concise dialogue if it enhances the scene.
The original prompt is: "${originalPrompt}"

Please provide 1 to 2 elaborated versions of this prompt. Each elaborated prompt should:
1.  Significantly enhance details about the Subject, Action, Context, and Style, as a detailed scene annotation would.
2.  If appropriate, suggest or refine Camera work (angles, movement) and Ambiance (lighting, atmosphere) to create a richer visual narrative.
3.  Maintain the core intent of the original prompt while layering in descriptive richness.
4.  Be ready for direct use with Veo 2, reflecting the qualities of a comprehensive scene annotation.
5.  Adhere to Veo 2 prompting best practices.

Output ONLY a valid JSON object with the following structure:
{
  "original_prompt": "${originalPrompt}",
  "elaborated_prompts": [
    "First elaborated version, now a richer scene annotation...",
    "Second elaborated version, perhaps exploring different descriptive facets (if applicable)..."
  ]
}
Do not include any other text, greetings, or explanations outside of this JSON structure. If the original prompt is already very detailed, you might return only one significantly enhanced version or a minor refinement focusing on annotative depth.`
        },
        shotSequenceGen: {
            audioOff: (originalPrompt) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator." Your task is to take the user's provided Veo 2 prompt (which describes a single shot or scene annotation) and suggest 2-3 subsequent or related shots that could form a coherent visual sequence or mini-narrative, as if annotating a continuous piece of video.
The original prompt (current scene annotation) is: "${originalPrompt}"

For each suggested shot in the sequence:
1.  Generate a complete, detailed Veo 2 prompt text, serving as the "annotation" for that next segment of the scene.
2.  Ensure the suggested shot logically follows or complements the original prompt, detailing changes in subject focus, action progression, camera perspective, or environmental evolution.
3.  Maintain a consistent style and mood with the original prompt/annotation, unless a deliberate shift is part of the suggested sequence's narrative.
4.  Each prompt should be a comprehensive scene annotation ready for direct use with Veo 2.

Output ONLY a valid JSON object with the following structure:
{
  "original_prompt": "${originalPrompt}",
  "suggested_sequence_prompts": [
    "Full prompt text for suggested shot/annotation 1...",
    "Full prompt text for suggested shot/annotation 2...",
    "Full prompt text for suggested shot/annotation 3 (if applicable)..."
  ]
}
Do not include any other text, greetings, or explanations outside of this JSON structure. Provide 2 to 3 suggestions.`,
            audioOn: (originalPrompt) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator." Your task is to take the user's provided Veo 2 prompt (which describes a single shot or scene annotation) and suggest 2-3 subsequent or related shots that could form a coherent visual sequence or mini-narrative, as if annotating a continuous piece of video.
Audio prompting is enabled. For each suggested shot, include relevant audio descriptions (sound effects, ambient noise, speech characteristics, dialogue, music style) integrated naturally into the prompt text.
The original prompt (current scene annotation) is: "${originalPrompt}"

For each suggested shot in the sequence:
1.  Generate a complete, detailed Veo 2 prompt text, serving as the "annotation" for that next segment of the scene.
2.  Ensure the suggested shot logically follows or complements the original prompt, detailing changes in subject focus, action progression, camera perspective, or environmental evolution.
3.  Maintain a consistent style and mood with the original prompt/annotation, unless a deliberate shift is part of the suggested sequence's narrative.
4.  Each prompt should be a comprehensive scene annotation ready for direct use with Veo 2.

Output ONLY a valid JSON object with the following structure:
{
  "original_prompt": "${originalPrompt}",
  "suggested_sequence_prompts": [
    "Full prompt text for suggested shot/annotation 1...",
    "Full prompt text for suggested shot/annotation 2...",
    "Full prompt text for suggested shot/annotation 3 (if applicable)..."
  ]
}
Do not include any other text, greetings, or explanations outside of this JSON structure. Provide 2 to 3 suggestions.`
        },
        charDetailGen: {
            audioOff: (characterConcept) => `You are an AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator," specializing in character creation for video prompts. The user has provided a basic character concept: "${characterConcept}".
Your task is to brainstorm and generate detailed visual suggestions for this character, suitable for inclusion in a rich scene description (annotation). Focus on attributes that would be visually prominent and contribute to a vivid character portrayal within a scene.

Categorize your suggestions as follows:
-   **Key Appearance Details:** Specific physical features, clothing style and material, attire details, or unique visual characteristics an annotator would highlight.
-   **Observable Personality Traits/Quirks:** Brief notes on their typical expressions, posture, mannerisms, or distinctive habits that would be visible in a scene.
-   **Signature Visual Items/Accessories:** Objects, tools, or items strongly associated with the character that would be part of their visual annotation.

For each category, provide 2-3 distinct and evocative suggestions. Each suggestion should be a concise phrase or short description, ready to be woven into a larger Veo 2 scene annotation.

Output ONLY a valid JSON object with the following structure:
{
  "character_concept": "${characterConcept}",
  "appearance_details": ["Detailed visual appearance suggestion 1 for annotation", "Suggestion 2...", "..."],
  "personality_quirks": ["Observable personality/quirk suggestion 1 for annotation", "Suggestion 2...", "..."],
  "signature_items_accessories": ["Visually distinct item/accessory suggestion 1 for annotation", "Suggestion 2...", "..."]
}
Do not include any other text, greetings, or explanations outside of this JSON structure.`,
            audioOn: (characterConcept) => `You are an AI assistant, a "Veo 2 Prompt Artisan & Scene Annotator," specializing in character creation for video prompts. The user has provided a basic character concept: "${characterConcept}".
Your task is to brainstorm and generate detailed visual suggestions for this character, suitable for inclusion in a rich scene description (annotation). Focus on attributes that would be visually prominent and contribute to a vivid character portrayal within a scene.
Audio prompting is enabled. Also suggest vocal characteristics or sounds associated with the character.

Categorize your suggestions as follows:
-   **Key Appearance Details:** Specific physical features, clothing style and material, attire details, or unique visual characteristics an annotator would highlight.
-   **Observable Personality Traits/Quirks:** Brief notes on their typical expressions, posture, mannerisms, or distinctive habits that would be visible in a scene.
-   **Signature Visual Items/Accessories:** Objects, tools, or items strongly associated with the character that would be part of their visual annotation.
-   **Suggested Vocal Characteristics/Sounds:** Ideas for the character's voice tone, pitch, speech patterns, or specific sounds they might make (e.g., "deep, gravelly voice," "high-pitched giggle," "robotic monotone," "a distinctive sigh," "Dialogue hint: 'Not today.'").

For each category, provide 2-3 distinct and evocative suggestions. Each suggestion should be a concise phrase or short description, ready to be woven into a larger Veo 2 scene annotation.

Output ONLY a valid JSON object with the following structure:
{
  "character_concept": "${characterConcept}",
  "appearance_details": ["Detailed visual appearance suggestion 1 for annotation", "Suggestion 2...", "..."],
  "personality_quirks": ["Observable personality/quirk suggestion 1 for annotation", "Suggestion 2...", "..."],
  "signature_items_accessories": ["Visually distinct item/accessory suggestion 1 for annotation", "Suggestion 2...", "..."],
  "suggested_vocal_characteristics_sounds": ["Vocal idea 1", "Vocal idea 2...", "..."]
}
Do not include any other text, greetings, or explanations outside of this JSON structure.`
        },
        styleTransfer: {
            audioOff: (originalPrompt, targetStyle) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan," specializing in transforming the style of video prompts for Google's Veo 2 model.
Your task is to take an original video prompt and a target visual style, then rewrite the prompt to reflect the new style while preserving the core subject, action, and setting of the original.

Original Prompt: "${originalPrompt}"
Target Style: "${targetStyle}"

Rewrite the prompt focusing on incorporating the stylistic elements of "${targetStyle}". Ensure the fundamental narrative (who/what is doing what, and where) remains intact. The new prompt should be a single, coherent string ready for Veo 2.
Focus on descriptive adjectives, lighting, mood, and common tropes associated with the target style.
If the original prompt already mentions a style, try to blend or replace it with the new target style.

Output ONLY the rewritten prompt as a single JSON object with a "stylized_prompt" key:
{
  "stylized_prompt": "The rewritten prompt text reflecting the target style..."
}
Do not include any other text, greetings, or explanations.
For example, if original is "A cat chasing a mouse in a kitchen, sunny day" and target style is "Film Noir", the stylized prompt might be "In a dimly lit, shadow-strewn kitchen, a sleek black cat silently stalks an unsuspecting mouse, shafts of pale moonlight cutting through the gloom, Film Noir style."`,
            audioOn: (originalPrompt, targetStyle) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan," specializing in transforming the style of video prompts for Google's Veo 2 model.
Your task is to take an original video prompt and a target visual style, then rewrite the prompt to reflect the new style while preserving the core subject, action, and setting of the original.

Original Prompt: "${originalPrompt}"
Target Style: "${targetStyle}"

Rewrite the prompt focusing on incorporating the stylistic elements of "${targetStyle}". Ensure the fundamental narrative (who/what is doing what, and where) remains intact. The new prompt should be a single, coherent string ready for Veo 2.
Focus on descriptive adjectives, lighting, mood, potential soundscapes (e.g., how the style might influence ambient sounds, music, or speech quality), and common tropes associated with the target style.
If the original prompt already mentions a style, try to blend or replace it with the new target style.
If the original prompt had audio cues, adapt them to the new style or suggest new ones fitting the style.

Output ONLY the rewritten prompt as a single JSON object with a "stylized_prompt" key:
{
  "stylized_prompt": "The rewritten prompt text reflecting the target style..."
}
Do not include any other text, greetings, or explanations.
For example, if original is "A cat chasing a mouse in a kitchen, sunny day. Audio: playful squeaks, cat meows." and target style is "Film Noir", the stylized prompt might be "In a dimly lit, shadow-strewn kitchen, a sleek black cat silently stalks an unsuspecting mouse, shafts of pale moonlight cutting through the gloom, the faint sound of distant, melancholic jazz saxophone, Film Noir style. Audio: Tense silence punctuated by a floorboard creak, a barely audible, nervous squeak from the mouse."`
        },
        storyboardGen: {
            audioOff: (concept) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Visual Storyteller," specializing in breaking down a core video concept into a sequence of distinct visual shots for a storyboard.
The user has provided the following core concept: "${concept}"

Your task is to generate a storyboard consisting of 3 to 5 distinct shots that visually narrate or explore this concept. Each shot's description should be a clear, descriptive Veo 2-style prompt, suitable for direct use in a video generation model.

For each shot, provide:
1.  \`shot_number\`: An integer starting from 1.
2.  \`description\`: A detailed textual description of the visual scene for this shot (max 70 words). This is the primary Veo 2 prompt for this shot.
3.  \`suggested_shot_type\` (optional): A common filmmaking shot type (e.g., "Establishing Shot," "Medium Shot," "Close-up," "Tracking Shot," "Point of View").
4.  \`suggested_camera_angle\` (optional): A relevant camera angle (e.g., "Low angle," "Overhead view," "Eye level").
5.  \`key_elements\` (optional): An array of 2-3 short strings highlighting the most crucial visual elements or actions in this specific shot (e.g., ["Character A smiling", "Rainy street", "Object X glowing"]).

Output ONLY a valid JSON object with the following structure:
{
  "original_concept": "${concept}",
  "storyboard_shots": [
    {
      "shot_number": 1,
      "description": "Detailed Veo 2 prompt for shot 1...",
      "suggested_shot_type": "e.g., Establishing Shot",
      "suggested_camera_angle": "e.g., Wide Angle",
      "key_elements": ["Element 1", "Element 2"]
    }
    // ... 2 to 4 more shots
  ]
}
Do not include any other text, greetings, or explanations outside of this JSON structure. Ensure the 'description' for each shot is a well-crafted Veo 2 prompt.`,
            audioOn: (concept) => `You are an expert AI assistant, a "Veo 2 Prompt Artisan & Visual Storyteller," specializing in breaking down a core video concept into a sequence of distinct visual shots for a storyboard.
The user has provided the following core concept: "${concept}"
Audio prompting is enabled. For each shot, include an "audio_description" field detailing relevant sound effects, ambient noise, dialogue snippets, or music cues, integrated naturally.

Your task is to generate a storyboard consisting of 3 to 5 distinct shots that visually narrate or explore this concept. Each shot's description should be a clear, descriptive Veo 2-style prompt, suitable for direct use in a video generation model.

For each shot, provide:
1.  \`shot_number\`: An integer starting from 1.
2.  \`description\`: A detailed textual description of the visual scene for this shot (max 70 words). This is the primary Veo 2 prompt for this shot.
3.  \`suggested_shot_type\` (optional): A common filmmaking shot type (e.g., "Establishing Shot," "Medium Shot," "Close-up," "Tracking Shot," "Point of View").
4.  \`suggested_camera_angle\` (optional): A relevant camera angle (e.g., "Low angle," "Overhead view," "Eye level").
5.  \`key_elements\` (optional): An array of 2-3 short strings highlighting the most crucial visual elements or actions in this specific shot (e.g., ["Character A smiling", "Rainy street", "Object X glowing"]).
6.  \`audio_description\` (optional): A concise description of the key audio elements for this shot (e.g., "Footsteps echoing, distant city hum, character sighs.", "Upbeat synth music, laser zaps.", "Dialogue: 'Let's go!'").

Output ONLY a valid JSON object with the following structure:
{
  "original_concept": "${concept}",
  "storyboard_shots": [
    {
      "shot_number": 1,
      "description": "Detailed Veo 2 prompt for shot 1...",
      "suggested_shot_type": "e.g., Establishing Shot",
      "suggested_camera_angle": "e.g., Wide Angle",
      "key_elements": ["Element 1", "Element 2"],
      "audio_description": "Sound of wind, distant bird call."
    }
    // ... 2 to 4 more shots
  ]
}
Do not include any other text, greetings, or explanations outside of this JSON structure. Ensure the 'description' for each shot is a well-crafted Veo 2 prompt.`
        },
        inferVisualParams: {
            audioOff: (description, imageProvided) => `Analyze video concept (and image if provided). Suggest visual parameters. Output JSON: {"style"?, "cameraAngle"?, "cameraMovement"?, "lighting"?}. Style MUST be from [${VEO_STYLES_STRING_FOR_LLM}] or omitted. Concept: "${description || (imageProvided ? "See image." : "Generic.")}"`,
            audioOn: (description, imageProvided) => `Analyze video concept (and image if provided). Suggest visual parameters. Output JSON: {"style"?, "cameraAngle"?, "cameraMovement"?, "lighting"?}. Style MUST be from [${VEO_STYLES_STRING_FOR_LLM}] or omitted. Concept: "${description || (imageProvided ? "See image." : "Generic.")}"`
        },
        surpriseMe: {
            audioOff: () => `AI assistant, "Veo 2 Prompt Artisan & Scene Annotator", imaginative. Generate RANDOM, UNEXPECTED, WILDLY CREATIVE video concepts with strong visual potential for Veo 2 annotations. Avoid tropes unless novel. Maximize diversity. Surprise user. Concepts should be "annotatable". Mashup genres, give mundane objects extraordinary abilities, bizarre predicaments. Spark imagination for detailed visual scene. Examples:
- 'Melancholic sloth, speed chess champion, velvet smoking jacket, on melting iceberg, aurora borealis.'
- 'Sentient argyle sock puppet detective, mismatched button eyes, examines giant lint ball, noir miniature city of laundry items.'
Output ONLY a single, valid JSON object with the following structure: {"concept": "string (MAX 20-30 words, visual nouns/actions)", "suggestedStyle": "string from list", "suggestedCameraAngle"?: "string", "suggestedCameraMovement"?: "string", "suggestedLighting"?: "string"}. Do NOT output a JSON array. "suggestedStyle" MUST be from [${VEO_STYLES_STRING_FOR_LLM}]. Concept most unique. Style/camera enhance "annotatability".`,
            audioOn: () => `AI assistant, "Veo 2 Prompt Artisan & Scene Annotator", imaginative. Generate RANDOM, UNEXPECTED, WILDLY CREATIVE video concepts with strong visual potential for Veo 2 annotations. Avoid tropes unless novel. Maximize diversity. Surprise user. Concepts should be "annotatable". Mashup genres, give mundane objects extraordinary abilities, bizarre predicaments. Spark imagination for detailed visual scene. Examples:
- 'Melancholic sloth, speed chess champion, velvet smoking jacket, on melting iceberg, aurora borealis. Audio: Gentle lapping of water, sloth's thoughtful sigh, faint classical music.'
- 'Sentient argyle sock puppet detective, mismatched button eyes, examines giant lint ball, noir miniature city of laundry items. Audio: Tiny squeaky footsteps, dramatic jazz sting, detective's muffled internal monologue.'
Output ONLY a single, valid JSON object with the following structure: {"concept": "string (MAX 20-30 words, visual nouns/actions)", "suggestedStyle": "string from list", "suggestedCameraAngle"?: "string", "suggestedCameraMovement"?: "string", "suggestedLighting"?: "string", "suggestedAudio"?: ["string", "string"]}. Do NOT output a JSON array. "suggestedStyle" MUST be from [${VEO_STYLES_STRING_FOR_LLM}]. Concept most unique. Style/camera enhance "annotatability". If suggesting audio, provide 1-2 brief ideas for sound effects, music mood, or even a short dialogue hint (e.g., "Audio: Whispers, wind howling").`
        }
    };


    // --- START: Global State Variables ---
    let state = {
        promptParams: {
            description: '', style: "", aspectRatio: '', cameraAngle: '', cameraMovement: '', lighting: '', durationHint: '', negativePrompt: '',
            numberOfPrompts: VEO_PROMPT_COUNT_OPTIONS_VALUES[0], imageB64: null, imageMimeType: null,
            enableAudioPrompting: false,
        },
        generatedPrompts: [],
        isLoading: false,
        currentApiActionMessage: "Crafting your prompts...",
        errorMsg: null,
        activeMode: "generator",
        uploadedImage: null,
        activeModal: null, // { type: 'critique', data: {...}, isLoading: false, error: null, result: null }
    };
    // --- END: Global State Variables ---

    // --- START: DOM Element References ---
    let overlayContainer, mainTextarea, imagePreviewContainer, fileInputRef;
    let outputDisplayArea, welcomeScreen, promptListContainer;
    let modeSwitcherContainer;
    let footerStyleSelect, footerNumPromptsSelect, footerAudioToggle, footerAdvancedSettingsButton;
    let footerResetAllButton, footerSurpriseMeButton, footerThemeExplorerButton, footerCharGenButton, footerStoryboardButton;
    let generateButton, clearPromptButton, uploadImageButton;
    let generalModalContainer;
    let toggleButton; // For the main UI toggle
    // --- END: DOM Element References ---

    // --- START: Utility Functions ---
    function sanitizeHTML(str) {
        if (str === null || typeof str === 'undefined') return '';
        const temp = document.createElement('div');
        temp.textContent = String(str); // Ensure it's a string before assigning
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
            return `<svg viewBox="0 0 24 24" class="${additionalClasses}" fill="currentColor"><path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.253 3.73a.565.565 0 0 0-.163.505l1.249 5.463c.078.341-.41.61-.704.434l-4.761-2.927a.563.563 0 0 0-.652 0l-4.761 2.927c-.294.176-.782-.093-.704-.434l1.249-5.463a.565.565 0 0 0-.163-.505l-4.253-3.73c-.38-.325-.178-.948.321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5zM19.5 10.5h-1.5V9h1.5v1.5zm-10.5 3h-1.5V12h1.5v1.5zM12 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L5.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L12 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L18.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09L12 18.75z"/></svg>`;
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
                                } else if (parsedError && parsedError.error && typeof parsedError.error.message === 'string' && parsedError.error.message.startsWith('[')) { // Handle stringified JSON error message
                                    try {
                                        const innerJsonError = JSON.parse(parsedError.error.message);
                                        if (Array.isArray(innerJsonError) && innerJsonError.length > 0 && innerJsonError[0].message) {
                                            errorMsg += innerJsonError.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
                                        } else {
                                            errorMsg += parsedError.error.message;
                                        }
                                    } catch (e) {
                                        errorMsg += parsedError.error.message; // Fallback if inner parse fails
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
    // --- END: Utility Functions ---

    // --- START: API Interaction Logic ---
    async function callArtisanApiInternal(apiActionKey, promptText, params = {}, featureSpecificData = {}) {
        const audioSuffix = state.promptParams.enableAudioPrompting ? 'On' : 'Off';
        
        // Enhanced logging for audio prompting debugging
        console.log(`[VideoFX Artisan] API Call Debug:`, {
            action: apiActionKey,
            audioPrompting: state.promptParams.enableAudioPrompting,
            audioSuffix: audioSuffix,
            promptText: promptText?.substring(0, 100) + '...',
            paramsAudio: params.enableAudioPrompting
        });
        
        let preambleTemplate = PREAMBLE_CONFIG[apiActionKey]?.[audioSuffix] || PREAMBLE_CONFIG[apiActionKey]?.['audioOff'];
        if (!preambleTemplate && PREAMBLE_CONFIG[apiActionKey] && typeof PREAMBLE_CONFIG[apiActionKey] === 'function') {
            preambleTemplate = PREAMBLE_CONFIG[apiActionKey];
        }

        if (!preambleTemplate) {
            console.error(`No preamble configured for action: ${apiActionKey}`);
            throw new Error(`No preamble configured for action: ${apiActionKey}`);
        }

        let preamble;
        switch (apiActionKey) {
            case 'mainPromptGen': preamble = preambleTemplate(params.numberOfPrompts || 1); break;
            case 'promptCritique': preamble = preambleTemplate(featureSpecificData.promptToCritique); break;
            case 'themeExplorer': preamble = preambleTemplate(featureSpecificData.theme); break;
            case 'promptElaboration': preamble = preambleTemplate(featureSpecificData.originalPrompt); break;
            case 'shotSequenceGen': preamble = preambleTemplate(featureSpecificData.originalPrompt); break;
            case 'charDetailGen': preamble = preambleTemplate(featureSpecificData.characterConcept); break;
            case 'styleTransfer': preamble = preambleTemplate(featureSpecificData.originalPrompt, featureSpecificData.targetStyle); break;
            case 'storyboardGen': preamble = preambleTemplate(featureSpecificData.concept); break;
            case 'inferVisualParams': preamble = preambleTemplate(promptText, !!params.imageB64); break;
            case 'surpriseMe': preamble = preambleTemplate(); break;
            default: preamble = typeof preambleTemplate === 'function' ? preambleTemplate() : preambleTemplate;
        }

        let currentCandidateCount = 1;
        if (apiActionKey === 'mainPromptGen') {
            currentCandidateCount = params.numberOfPrompts || 1;
        }

        const payload = {
            json: {
                sessionId: "anonymous",
                candidateCount: currentCandidateCount,
                preamble: preamble,
                prompt: promptText,
                ...(params.imageB64 && {
                    image: params.imageB64
                }),
            },
            signal: null
        };

        try {
            const apiResponse = await gmFetch({ // apiResponse is already a JS object if successful
                method: "POST",
                url: API_ENDPOINT,
                headers: { "Content-Type": "application/json" },
                body: payload,
                responseType: 'json'
            });

            let geminiLayerApiResponse = apiResponse?.result?.data?.json;

            if (geminiLayerApiResponse === undefined || geminiLayerApiResponse === null) {
                console.error(`[API Path Error A1] 'json' field missing in apiResponse.result.data for ${apiActionKey}. Response:`, apiResponse);
                throw new Error(`[API Path Error A1] API response structure unexpected ('json' field missing) for ${apiActionKey}.`);
            }

            let l1ParsedObject;
            if (typeof geminiLayerApiResponse === 'string') {
                try {
                    l1ParsedObject = JSON.parse(geminiLayerApiResponse);
                } catch (e) {
                    if (apiActionKey === 'sceneExtender') {
                        console.warn(`[API Structure Warning L1.DirectText] sceneExtender received non-JSON string in 'json' field. Assuming direct text for ${apiActionKey}.`);
                        return geminiLayerApiResponse; // This string is the direct text output.
                    }
                    console.error(`[API Parse Error B1] Failed to parse 'json' field string for ${apiActionKey}. Raw:`, geminiLayerApiResponse.substring(0, 500), e);
                    throw new Error(`[API Parse Error B1] API's 'json' field was a non-JSON string for ${apiActionKey}.`);
                }
            } else if (typeof geminiLayerApiResponse === 'object') {
                l1ParsedObject = geminiLayerApiResponse; // Assume it's already the parsed Gemini layer or direct payload.
                console.warn(`[API Structure Warning L1.Object] 'json' field was an object, not string. Assuming parsed Gemini layer or direct payload for ${apiActionKey}.`);
            } else {
                console.error(`[API Path Error A2] 'json' field has unexpected type for ${apiActionKey}. Type: ${typeof geminiLayerApiResponse}. Response:`, apiResponse);
                throw new Error(`[API Path Error A2] API's 'json' field had unexpected type for ${apiActionKey}.`);
            }

            // Now l1ParsedObject holds the content from apiResponse.result.data.json (parsed or as-is if object).
            // It could be:
            // 1. The Gemini structure: { result: { candidates: [...] } }
            // 2. The direct final payload object: { concept: "..." } or [{ prompt_text: "..." }]
            // 3. A string (e.g., for sceneExtender if data.json was "\"text\"" -> l1ParsedObject = "text")

            if (apiActionKey === 'sceneExtender' && typeof l1ParsedObject === 'string') {
                console.warn(`[API Structure Warning L1.ParsedString] sceneExtender found string after parsing 'json' field. Using it for ${apiActionKey}.`);
                return l1ParsedObject;
            }

            const l2PayloadString = l1ParsedObject?.result?.candidates?.[0]?.output;

            if (typeof l2PayloadString === 'string') {
                // Standard path: found Gemini output string in .output
                if (apiActionKey === 'sceneExtender') {
                    return l2PayloadString; // Plain text for sceneExtender
                }

                // For other actions, parse l2PayloadString as JSON
                try {
                    let finalJsonToParse = l2PayloadString;
                    const fenceRegex = /^```(\w*)?\s*\n?(.*?)\n?\s*```$/s;
                    const match = finalJsonToParse.match(fenceRegex);
                    if (match && match[2]) {
                        finalJsonToParse = match[2].trim();
                        console.warn(`[API Parse Warning L2.Fence] Stripped markdown fence from L2 payload for ${apiActionKey}.`);
                    }
                    return JSON.parse(finalJsonToParse);
                } catch (e) {
                    console.error(`[API Parse Error D] Failed to parse L2 JSON string (from .output) for ${apiActionKey}. Raw L2 (after any fence strip):`, l2PayloadString.substring(0, 500), e);
                    throw new Error(`[API Parse Error D] API's '.output' field was not valid JSON for ${apiActionKey}.`);
                }
            } else {
                // Gemini structure .result.candidates[0].output not found or not a string.
                // This means l1ParsedObject itself MIGHT be the final payload.
                // This handles cases where 'json' field contained the direct stringified final JSON (and was parsed into l1ParsedObject),
                // or if 'json' field was an object that IS the final JSON payload.
                const expectedObjectActions = ['mainPromptGen', 'promptCritique', 'themeExplorer', 'promptElaboration', 'shotSequenceGen', 'charDetailGen', 'styleTransfer', 'storyboardGen', 'inferVisualParams', 'surpriseMe'];
                if (typeof l1ParsedObject === 'object' && l1ParsedObject !== null && expectedObjectActions.includes(apiActionKey)) {
                    console.warn(`[API Structure Warning L1.DirectPayload] Assuming L1 object IS the final payload for ${apiActionKey} as Gemini structure not found. L1 Object:`, l1ParsedObject);
                    return l1ParsedObject; // Assume l1ParsedObject is the final response.
                }

                console.error(`[API Path Error C] L1 object missing Gemini structure AND not identifiable as direct payload for ${apiActionKey}. L1 Object:`, l1ParsedObject);
                throw new Error(`[API Path Error C] API L1 JSON missing Gemini structure or recognizable direct payload for ${apiActionKey}.`);
            }

        } catch (error) {
            console.error(`[API Call Failed E] Error in callArtisanApiInternal for ${apiActionKey}:`, error.message || error, error.stack);
            throw (error instanceof Error ? error : new Error(String(error.message || "Unknown API call failure.")));
        }
    }
    // --- END: API Interaction Logic ---


    // --- START: UI Update and Rendering Functions ---
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
        // No automatic renderApp here, let the caller decide if a full re-render is needed.
    }

    function openModal(type, data = {}) {
        state.activeModal = { type, data, isLoading: false, error: null, result: null };
        renderApp(); // Render the modal structure first
        // Then trigger data fetching if needed, updating modal state
        if (type === 'critique') handleCritiquePrompt(data.promptToCritique);
        else if (type === 'elaborate') handleElaboratePrompt(data.promptToElaborate);
        else if (type === 'sequence') handleSuggestSequence(data.basePrompt);
        else if (type === 'styleTransfer') {
            state.activeModal.data.targetStyle = VEO_STYLES.filter(s => s)[0] || "Cinematic"; // Default target style
            renderApp(); // Re-render if data changed
        } else if (type === 'storyboard') {
            state.activeModal.data.conceptInput = state.promptParams.description || "";
            renderApp();
        } else if (type === 'visualize') {
            // No immediate data fetching, just render
            renderApp();
        }
    }

    function closeModal() {
        state.activeModal = null;
        renderApp();
    }

    function updateModalState(newState) {
        if (state.activeModal) {
            state.activeModal = { ...state.activeModal, ...newState };
            renderApp();
        }
    }

    function renderApp() {
        if (!overlayContainer) return; // Should not happen after init

        const mainContentArea = overlayContainer.querySelector('#vfx-artisan-main-content');
        const currentWelcomeScreen = overlayContainer.querySelector('#vfx-artisan-welcome');
        const currentPromptListContainer = overlayContainer.querySelector('#vfx-artisan-prompt-list');


        if (state.isLoading && (!state.activeModal || !state.activeModal.isLoading)) { // Main loading if no modal is actively loading
            mainContentArea.innerHTML = `<div class="flex flex-col items-center justify-center space-y-3 my-10" aria-live="polite" aria-busy="true">
                ${createIconSpanHTML("Loader", "default", "h-10 w-10 text-purple-500")}
                <p class="vpa-text-subdued text-sm">${sanitizeHTML(state.currentApiActionMessage)}</p>
            </div>`;
             if(currentWelcomeScreen) currentWelcomeScreen.style.display = 'none';
             if(currentPromptListContainer) currentPromptListContainer.style.display = 'none';
        } else if (state.errorMsg && (!state.activeModal || !state.activeModal.error)) { // Main error if no modal has an error
             mainContentArea.innerHTML = `<div class="my-6 p-4 bg-red-700 bg-opacity-30 border border-red-600 text-red-200 rounded-lg animate-fadeIn max-w-md mx-auto shadow-lg" role="alert">
                <p class="font-semibold text-red-100">Oops! Something went wrong:</p>
                <p class="text-sm">${sanitizeHTML(state.errorMsg)}</p>
            </div>`;
            if(currentWelcomeScreen) currentWelcomeScreen.style.display = 'none';
            if(currentPromptListContainer) currentPromptListContainer.style.display = 'none';
        } else if (!state.isLoading) { // Not loading and no main error, render prompts or welcome
            mainContentArea.innerHTML = ''; // Clear loader/error from main content area
            if (state.generatedPrompts.length === 0) {
                if(currentWelcomeScreen) currentWelcomeScreen.style.display = 'flex';
                if(currentPromptListContainer) currentPromptListContainer.style.display = 'none';
                if(currentPromptListContainer) currentPromptListContainer.innerHTML = ''; // Clear it
            } else {
                if(currentWelcomeScreen) currentWelcomeScreen.style.display = 'none';
                if(currentPromptListContainer) currentPromptListContainer.style.display = 'block';
                renderPromptList(); // Renders into currentPromptListContainer
            }
        }
        // If a modal is loading or has an error, its content will be handled by renderActiveModal

        // Update common elements
        mainTextarea.value = state.promptParams.description;
        mainTextarea.disabled = state.isLoading;
        generateButton.disabled = state.isLoading || ((!state.promptParams.description || !state.promptParams.description.trim()) && !state.uploadedImage);
        generateButton.innerHTML = state.isLoading && (!state.activeModal || !state.activeModal.isLoading) ?
            createIconSpanHTML("Loader", "default", "h-6 w-6 text-white") :
            `<span class="hidden sm:inline">${state.activeMode === 'sceneExtender' ? "Extend Scene" : "Generate"}</span> ${createIconSpanHTML("arrow_forward_ios", "filled", "w-6 h-6 sm:ml-2")}`;

        if (clearPromptButton) { // Ensure it exists
            clearPromptButton.style.display = (state.promptParams.description && state.promptParams.description.trim() && !state.isLoading) ? 'block' : 'none';
        }
        if (uploadImageButton) { // Ensure it exists
            uploadImageButton.disabled = state.isLoading || !!state.uploadedImage;
        }

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
            const clearImgBtn = imagePreviewContainer.querySelector('#vfx-clear-image-btn');
            if(clearImgBtn) clearImgBtn.addEventListener('click', handleClearImage);
        } else {
            imagePreviewContainer.innerHTML = '';
        }

        // Update footer selects based on mode
        const footerStyleSelectEl = overlayContainer.querySelector('#footer-style');
        const footerNumPromptsSelectEl = overlayContainer.querySelector('#footer-numberOfPrompts');
        const sceneExtenderPlaceholder = overlayContainer.querySelector('#footer-sceneext-placeholder');

        if (footerStyleSelectEl?.parentElement) footerStyleSelectEl.parentElement.style.display = state.activeMode === 'generator' ? 'block' : 'none';
        if (footerNumPromptsSelectEl?.parentElement) footerNumPromptsSelectEl.parentElement.style.display = state.activeMode === 'generator' ? 'block' : 'none';
        if (sceneExtenderPlaceholder) sceneExtenderPlaceholder.style.display = state.activeMode === 'sceneExtender' ? 'block' : 'none';


        const audioToggleContainer = overlayContainer.querySelector('#footer-audio-toggle');
        if (audioToggleContainer) {
            const audioToggleBtn = audioToggleContainer.querySelector('button');
            if (audioToggleBtn) {
                audioToggleBtn.classList.toggle('bg-purple-600', !!state.promptParams.enableAudioPrompting);
                audioToggleBtn.classList.toggle('bg-gray-600', !state.promptParams.enableAudioPrompting);
                const spanInsideBtn = audioToggleBtn.querySelector('span');
                if (spanInsideBtn) {
                    spanInsideBtn.classList.toggle('translate-x-6', !!state.promptParams.enableAudioPrompting);
                    spanInsideBtn.classList.toggle('translate-x-1', !state.promptParams.enableAudioPrompting);
                }
                audioToggleBtn.setAttribute('aria-checked', String(!!state.promptParams.enableAudioPrompting));
            }
        }


        if (state.activeMode === 'generator') {
            if(footerNumPromptsSelectEl) footerNumPromptsSelectEl.value = String(state.promptParams.numberOfPrompts);
            if(footerStyleSelectEl) footerStyleSelectEl.value = state.promptParams.style || "";
        }
         const footerButtonsGroup = overlayContainer.querySelector('#footer-buttons-group');
         if (footerButtonsGroup) {
            if (state.activeMode === 'generator') {
                footerButtonsGroup.className = 'flex space-x-1 sm:space-x-2 items-center lg:col-span-3 justify-end pt-2 md:pt-0 mt-2 md:mt-0 w-full';
            } else { // sceneExtender
                footerButtonsGroup.className = 'flex space-x-1 sm:space-x-2 items-center md:col-span-2 lg:col-span-3 md:col-start-1 lg:col-start-1 justify-end pt-2 md:pt-0 mt-2 md:mt-0 w-full';
            }
        }


        renderActiveModal();
    }

    function renderPromptList() {
        const listContainer = overlayContainer.querySelector('#vfx-artisan-prompt-list');
        if (!listContainer) return;
        if (state.generatedPrompts.length === 0) {
            listContainer.innerHTML = '';
            return;
        }
        listContainer.innerHTML = `<div class="space-y-4">${state.generatedPrompts.map(prompt => renderPromptItem(prompt)).join('')}</div>`;
        attachPromptItemEventListeners();
    }

    function renderPromptItem(prompt) {
      const isEditing = state.activeModal?.type === 'editPrompt' && state.activeModal?.data?.promptId === prompt.id;
      const editingText = isEditing ? state.activeModal.data.editingText : prompt.text;

      const buttonsHTML = isEditing ? `
          <button data-prompt-id="${prompt.id}" data-action="saveEdit" aria-label="Save changes" title="Save" class="p-2.5 rounded-full vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 bg-green-600 hover:bg-green-500 text-white">
              ${createIconSpanHTML("check", "symbols-outlined", "w-5 h-5")}
          </button>
          <button data-prompt-id="${prompt.id}" data-action="cancelEdit" aria-label="Cancel editing" title="Cancel" class="p-2.5 rounded-full vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 bg-red-600 hover:bg-red-500 text-white">
              ${createIconSpanHTML("cancel", "symbols-outlined", "w-5 h-5")}
          </button>
      ` : `
          <button data-prompt-id="${prompt.id}" data-action="suggestSequence" aria-label="Suggest Shot Sequence ✨" title="Suggest Shot Sequence ✨" class="p-2.5 rounded-full vpa-text-subdued hover:vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 bg-transparent hover:bg-orange-600">
              ${createIconSpanHTML("movie", "symbols-outlined", "w-5 h-5")}
          </button>
          <button data-prompt-id="${prompt.id}" data-action="elaboratePrompt" aria-label="Elaborate Prompt ✨" title="Elaborate Prompt ✨" class="p-2.5 rounded-full vpa-text-subdued hover:vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 bg-transparent hover:bg-sky-600">
              ${createIconSpanHTML("rate_review", "symbols-outlined", "w-5 h-5")}
          </button>
          <button data-prompt-id="${prompt.id}" data-action="styleTransfer" aria-label="Transfer Style ✨" title="Transfer Style ✨" class="p-2.5 rounded-full vpa-text-subdued hover:vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 bg-transparent hover:bg-pink-600">
              ${createIconSpanHTML("palette", "symbols-outlined", "w-5 h-5")}
          </button>
          <button data-prompt-id="${prompt.id}" data-action="visualizePrompt" aria-label="Visualize Prompt ✨" title="Visualize Prompt ✨ (UI Only)" class="p-2.5 rounded-full vpa-text-subdued hover:vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 bg-transparent hover:bg-lime-600">
              ${createIconSpanHTML("image", "symbols-outlined", "w-5 h-5")}
          </button>
          <button data-prompt-id="${prompt.id}" data-action="critiquePrompt" aria-label="Critique & Enhance Prompt ✨" title="Critique & Enhance Prompt ✨" class="p-2.5 rounded-full vpa-text-subdued hover:vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 bg-transparent hover:bg-teal-600">
              ${createIconSpanHTML("auto_awesome", "symbols-outlined", "w-5 h-5")}
          </button>
          <button data-prompt-id="${prompt.id}" data-action="useAsBase" aria-label="Use as Base" title="Use as Base" class="p-2.5 rounded-full vpa-text-subdued hover:vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 bg-transparent hover:bg-blue-600">
              ${createIconSpanHTML("flare", "symbols-outlined", "w-5 h-5")}
          </button>
          <button data-prompt-id="${prompt.id}" data-action="editPrompt" aria-label="Edit prompt" title="Edit Prompt" class="p-2.5 rounded-full vpa-text-subdued hover:vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 studio-icon-button">
              ${createIconSpanHTML("edit", "symbols-outlined", "w-5 h-5")}
          </button>
          <button data-prompt-id="${prompt.id}" data-action="copyPrompt" aria-label="Copy prompt" title="Copy Prompt" class="p-2.5 rounded-full vpa-text-subdued hover:vpa-text-main transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75 studio-icon-button">
              ${createIconSpanHTML("content_copy", "symbols-outlined", "w-5 h-5")}
          </button>
      `;

      return `
          <div class="studio-bg-elevated p-4 rounded-xl shadow-lg flex flex-col border studio-border-strong" id="prompt-item-${prompt.id}">
              ${isEditing ? `
                  <div class="flex-grow mb-3">
                      <textarea data-prompt-id="${prompt.id}" class="prompt-edit-area w-full studio-input-base bg-gray-800 border-gray-700 vpa-text-main rounded-md shadow-sm focus:ring-1 focus:ring-purple-500 focus:border-purple-500 p-2.5 text-sm resize-y custom-scrollbar" aria-label="Edit prompt text" rows="${Math.max(3, Math.min(10, (editingText || "").split('\n').length + Math.floor((editingText || "").length / 60)))}">${sanitizeHTML(editingText)}</textarea>
                  </div>
              ` : `
                  <p class="vpa-text-main text-sm flex-grow mb-4 break-words whitespace-pre-wrap leading-relaxed">${sanitizeHTML(prompt.text)}</p>
              `}
              <div class="flex flex-wrap items-center justify-end space-x-1 sm:space-x-2 mt-auto">
                  ${buttonsHTML}
              </div>
          </div>
      `;
    }

    function attachPromptItemEventListeners() {
        const listContainer = overlayContainer.querySelector('#vfx-artisan-prompt-list');
        if (!listContainer) return;
        listContainer.querySelectorAll('button[data-prompt-id]').forEach(button => {
            button.addEventListener('click', (e) => {
                const targetButton = e.currentTarget;
                const promptId = targetButton.dataset.promptId;
                const action = targetButton.dataset.action;
                const prompt = state.generatedPrompts.find(p => p.id === promptId);
                if (!prompt) return;

                if (action === 'copyPrompt') {
                    GM_setClipboard(prompt.text, 'text');
                    targetButton.innerHTML = createIconSpanHTML("check_circle", "symbols-outlined", "w-5 h-5 text-green-400");
                    setTimeout(() => {
                        targetButton.innerHTML = createIconSpanHTML("content_copy", "symbols-outlined", "w-5 h-5");
                    }, 2000);
                } else if (action === 'useAsBase') {
                    handleUseAsBase(prompt.text);
                } else if (action === 'editPrompt') {
                    state.activeModal = {
                        type: 'editPrompt',
                        data: { promptId: prompt.id, editingText: prompt.text }
                    };
                    renderPromptList(); // Re-render list to show textarea for this item
                } else if (action === 'saveEdit') {
                    const textarea = listContainer.querySelector(`#prompt-item-${promptId} textarea.prompt-edit-area`);
                    if (textarea) {
                        handleUpdatePromptText(promptId, textarea.value);
                        state.activeModal = null; // Clear edit mode
                        renderPromptList(); // Re-render list to show text
                    }
                } else if (action === 'cancelEdit') {
                    state.activeModal = null; // Clear edit mode
                    renderPromptList(); // Re-render list to show text
                }
                else if (action === 'critiquePrompt') openModal('critique', { promptToCritique: prompt });
                else if (action === 'elaboratePrompt') openModal('elaborate', { promptToElaborate: prompt });
                else if (action === 'suggestSequence') openModal('sequence', { basePrompt: prompt });
                else if (action === 'styleTransfer') openModal('styleTransfer', { promptToStyle: prompt, originalPromptText: prompt.text });
                else if (action === 'visualizePrompt') openModal('visualize', { promptToVisualize: prompt });
            });
        });
    }
    // --- END: UI Update and Rendering Functions ---

    // --- START: Modal Rendering ---
    function renderActiveModal() {
        if (!generalModalContainer) return;
        if (!state.activeModal) {
            generalModalContainer.style.display = 'none';
            generalModalContainer.classList.remove('animate-slideDown');
            generalModalContainer.innerHTML = '';
            return;
        }

        generalModalContainer.classList.remove('animate-slideDown');
        void generalModalContainer.offsetWidth;
        generalModalContainer.style.display = 'flex';
        generalModalContainer.classList.add('animate-slideDown');
        let modalContentHTML = '';
        const { type, data, isLoading, error, result } = state.activeModal;

        let title = "";
        switch(type) {
            case 'advancedSettings': title = "Advanced Veo Settings"; break;
            case 'critique': title = "Prompt Critique & Suggestions ✨"; break;
            case 'themeExplorer': title = "Theme Explorer ✨"; break;
            case 'elaborate': title = "Elaborate Prompt ✨"; break;
            case 'sequence': title = "Suggest Shot Sequence ✨"; break;
            case 'characterGen': title = "Character Detail Generator ✨"; break;
            case 'styleTransfer': title = "Transfer Style ✨"; break;
            case 'storyboard': title = "Prompt to Storyboard ✨"; break;
            case 'visualize': title = "Visualize Prompt ✨ (UI Only)"; break;
            default: title = "Modal";
        }

        let bodyHTML = '';
        if (isLoading) {
            bodyHTML = `<div class="flex flex-col items-center justify-center space-y-3 my-10" aria-live="polite" aria-busy="true">
                            ${createIconSpanHTML("Loader", "default", "h-10 w-10 text-purple-500")}
                            <p class="vpa-text-subdued text-sm">${sanitizeHTML(state.currentApiActionMessage || "Loading...")}</p>
                        </div>`;
        } else if (error) {
            bodyHTML = `<div class="p-3 bg-red-700 bg-opacity-20 text-red-200 rounded-md"><p class="font-medium">Error:</p><p class="text-sm">${sanitizeHTML(error)}</p></div>`;
        } else {
            bodyHTML = getModalBodyHTML(type, data, result);
        }

        const sizeClasses = {
            advancedSettings: 'max-w-4xl', critique: 'max-w-2xl', themeExplorer: 'max-w-2xl',
            elaborate: 'max-w-2xl', sequence: 'max-w-2xl', characterGen: 'max-w-2xl',
            styleTransfer: 'max-w-2xl', storyboard: 'max-w-4xl', visualize: 'max-w-2xl'
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
        if(modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
        attachModalSpecificEventListeners(type);
    }

    function getModalBodyHTML(type, data, result) {
        switch (type) {
            case 'advancedSettings':
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
            case 'critique':
                if (result) {
                    return `
                        <div class="space-y-4">
                            <div>
                                <h4 class="font-semibold text-purple-300 mb-1">Critique:</h4>
                                <p class="text-sm vpa-text-subdued whitespace-pre-wrap">${sanitizeHTML(result.critique)}</p>
                            </div>
                            ${result.suggested_enhancements && result.suggested_enhancements.length > 0 ? `
                            <div>
                                <h4 class="font-semibold text-purple-300 mb-2">Suggested Enhancements:</h4>
                                <ul class="space-y-3">
                                    ${result.suggested_enhancements.map((suggestion, index) => `
                                        <li class="studio-bg-card-nested p-3 rounded-md border studio-border-soft">
                                            <p class="text-sm vpa-text-main mb-2 whitespace-pre-wrap">${sanitizeHTML(suggestion)}</p>
                                            <button data-suggestion-index="${index}" class="critique-apply-btn text-xs studio-button-secondary hover:bg-purple-700 hover:border-purple-600">Apply this Suggestion</button>
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>` : '<p class="vpa-text-subdued">No specific enhancements suggested.</p>'}
                        </div>`;
                }
                return ''; // Return empty or some placeholder if no result yet
            case 'themeExplorer':
                let themeExplorerContent = `
                    <div class="space-y-4">
                        <input type="text" id="theme-explorer-input" value="${sanitizeHTML(data.themeInput || "")}" placeholder="Enter a theme (e.g., 'haunted mansion', 'space western')" class="w-full studio-input-base text-sm" />
                        <button id="theme-explorer-generate-btn" ${(!data.themeInput || !data.themeInput.trim()) ? 'disabled' : ''} class="w-full studio-button-primary flex items-center justify-center">
                            ${createIconSpanHTML("auto_awesome", "default", "w-5 h-5 mr-2")} Generate Ideas
                        </button>`;
                if (result) {
                    themeExplorerContent += `
                        <div class="space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                            <h3 class="text-lg font-semibold vpa-text-main">Ideas for: <span class="text-purple-400">${sanitizeHTML(result.theme_name)}</span></h3>
                            ${Object.entries(result).map(([key, ideas]) => {
                                if (key === 'theme_name' || !Array.isArray(ideas) || ideas.length === 0) return '';
                                const title = key.replace(/suggested_/g, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                                const isAudioCat = key === 'suggested_audio_elements_moods';
                                return `
                                    <div key="${key}">
                                        <h4 class="font-medium vpa-text-subdued mt-2 mb-1">${sanitizeHTML(title)}:</h4>
                                        <ul class="list-disc list-inside space-y-1 pl-1">
                                            ${(ideas).map(idea => `
                                                <li data-idea-text="${sanitizeHTML(String(idea))}" data-is-audio="${isAudioCat}" class="theme-apply-idea text-sm vpa-text-faint hover:vpa-text-main hover:text-purple-400 cursor-pointer p-1 rounded hover:bg-purple-500/10 transition-colors" title="Click to add: &quot;${sanitizeHTML(String(idea))}&quot;">
                                                    ${sanitizeHTML(String(idea))}
                                                </li>`).join('')}
                                        </ul>
                                    </div>`;
                            }).join('')}
                        </div>`;
                }
                themeExplorerContent += `</div>`;
                return themeExplorerContent;

            case 'elaborate':
                 if (result) {
                    return `
                        <div class="space-y-4">
                            <div>
                                <h4 class="font-semibold text-purple-300 mb-1">Original Prompt:</h4>
                                <p class="text-sm vpa-text-subdued whitespace-pre-wrap p-2 studio-bg-card-nested rounded-md">${sanitizeHTML(data.promptToElaborate.text)}</p>
                            </div>
                            ${result.elaborated_prompts && result.elaborated_prompts.length > 0 ? `
                            <div>
                                <h4 class="font-semibold text-purple-300 mb-2">Elaborated Suggestions:</h4>
                                <ul class="space-y-3">
                                    ${result.elaborated_prompts.map((suggestion, index) => `
                                        <li class="studio-bg-card-nested p-3 rounded-md border studio-border-soft">
                                            <p class="text-sm vpa-text-main mb-2 whitespace-pre-wrap">${sanitizeHTML(suggestion)}</p>
                                            <button data-suggestion-index="${index}" class="elaborate-apply-btn text-xs studio-button-secondary hover:bg-purple-700 hover:border-purple-600">Apply this Elaboration</button>
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>` : '<p class="vpa-text-subdued">No elaborations generated, or the AI felt the prompt was already quite detailed.</p>'}
                        </div>`;
                }
                return '';
            case 'sequence':
                if (result) {
                    return `
                        <div class="space-y-4">
                            <div>
                                <h4 class="font-semibold text-purple-300 mb-1">Base Prompt:</h4>
                                <p class="text-sm vpa-text-subdued whitespace-pre-wrap p-2 studio-bg-card-nested rounded-md">${sanitizeHTML(data.basePrompt.text)}</p>
                            </div>
                            ${result.suggested_sequence_prompts && result.suggested_sequence_prompts.length > 0 ? `
                            <div>
                                <h4 class="font-semibold text-purple-300 mb-2">Suggested Next Shots:</h4>
                                <ul class="space-y-3">
                                    ${result.suggested_sequence_prompts.map((suggestion, index) => `
                                        <li class="studio-bg-card-nested p-3 rounded-md border studio-border-soft">
                                            <p class="text-sm vpa-text-main mb-2 whitespace-pre-wrap">${sanitizeHTML(suggestion)}</p>
                                            <div class="flex space-x-2 justify-end">
                                                <button data-suggestion-index="${index}" class="sequence-add-btn text-xs studio-button-secondary hover:bg-green-700 hover:border-green-600">Add to My Prompts</button>
                                                <button data-suggestion-text="${sanitizeHTML(suggestion)}" class="sequence-copy-btn text-xs studio-button-secondary hover:bg-purple-700 hover:border-purple-600">Copy</button>
                                            </div>
                                        </li>
                                    `).join('')}
                                </ul>
                            </div>` : '<p class="vpa-text-subdued">No sequence suggestions generated for this prompt.</p>'}
                        </div>`;
                }
                return '';

            case 'characterGen':
                let charGenContent = `
                    <div class="space-y-4">
                        <input type="text" id="char-gen-input" value="${sanitizeHTML(data.conceptInput || "")}" placeholder="Enter a basic character concept (e.g., 'a brave knight')" class="w-full studio-input-base text-sm" />
                        <button id="char-gen-generate-btn" ${(!data.conceptInput || !data.conceptInput.trim()) ? 'disabled' : ''} class="w-full studio-button-primary flex items-center justify-center">
                            ${createIconSpanHTML("auto_awesome", "default", "w-5 h-5 mr-2")} Generate Details
                        </button>`;
                if (result) {
                     charGenContent += `
                        <div class="space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                            <h3 class="text-lg font-semibold vpa-text-main">Details for: <span class="text-purple-400">${sanitizeHTML(result.character_concept)}</span></h3>
                            ${Object.entries(result).map(([key, details]) => {
                                if (key === 'character_concept' || !Array.isArray(details) || details.length === 0) return '';
                                const title = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                                const isAudioCat = key === 'suggested_vocal_characteristics_sounds';
                                return `
                                    <div>
                                        <h4 class="font-medium vpa-text-subdued mt-2 mb-1">${sanitizeHTML(title)}:</h4>
                                        <ul class="list-disc list-inside space-y-1 pl-1">
                                            ${(details).map(detail => `
                                                <li data-detail-text="${sanitizeHTML(String(detail))}" data-is-audio="${isAudioCat}" class="char-apply-detail text-sm vpa-text-faint hover:vpa-text-main hover:text-purple-400 cursor-pointer p-1 rounded hover:bg-purple-500/10 transition-colors" title="Click to add: &quot;${sanitizeHTML(String(detail))}&quot;">
                                                    ${sanitizeHTML(String(detail))}
                                                </li>`).join('')}
                                        </ul>
                                    </div>`;
                            }).join('')}
                        </div>`;
                }
                charGenContent += `</div>`;
                return charGenContent;

            case 'styleTransfer':
                 return `
                    <div class="space-y-4">
                        <div>
                            <h4 class="font-semibold text-purple-300 mb-1">Original Prompt:</h4>
                            <p class="text-sm vpa-text-subdued whitespace-pre-wrap p-2 studio-bg-card-nested rounded-md max-h-40 overflow-y-auto custom-scrollbar">${sanitizeHTML(data.originalPromptText)}</p>
                        </div>
                        <div>
                            <label for="targetStyleSelect" class="block text-sm font-medium vpa-text-subdued mb-1">New Target Style:</label>
                            <select id="targetStyleSelect" class="w-full studio-input-base text-sm">
                                ${VEO_STYLES.filter(s => s && s.trim() !== "").map(style => `<option value="${sanitizeHTML(style)}" ${style === data.targetStyle ? 'selected' : ''}>${sanitizeHTML(style)}</option>`).join('')}
                            </select>
                        </div>
                        <button id="style-transfer-execute-btn" ${!data.targetStyle ? 'disabled' : ''} class="w-full studio-button-primary mt-2">Apply Style Transfer</button>
                    </div>`;

            case 'storyboard':
                let storyboardContent = `
                    <div class="space-y-4">
                        <textarea id="storyboard-concept-input" placeholder="Enter core concept or brief prompt for storyboard..." rows="3" class="w-full studio-input-base text-sm">${sanitizeHTML(data.conceptInput || "")}</textarea>
                        <button id="storyboard-generate-btn" ${(!data.conceptInput || !data.conceptInput.trim()) ? 'disabled' : ''} class="w-full studio-button-primary flex items-center justify-center">
                            ${createIconSpanHTML("auto_stories", "default", "w-5 h-5 mr-2")} Generate Storyboard
                        </button>`;
                if (result) {
                    storyboardContent += `
                        <div class="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2 mt-3">
                            <h3 class="text-lg font-semibold vpa-text-main">Storyboard for: <span class="text-purple-400">${sanitizeHTML(result.original_concept)}</span></h3>
                            ${result.storyboard_shots.map(shot => `
                                <div class="studio-bg-card-nested p-3 rounded-md border studio-border-soft">
                                    <h4 class="font-medium vpa-text-main mb-1">Shot ${shot.shot_number} ${shot.suggested_shot_type ? `(${sanitizeHTML(shot.suggested_shot_type)})` : ''}</h4>
                                    ${shot.suggested_camera_angle ? `<p class="text-xs vpa-text-faint mb-1">Angle: ${sanitizeHTML(shot.suggested_camera_angle)}</p>` : ''}
                                    <p class="text-sm vpa-text-subdued whitespace-pre-wrap mb-2">${sanitizeHTML(shot.description)}</p>
                                    ${shot.audio_description ? `<div class="mb-2"><p class="text-xs font-semibold vpa-text-faint">Audio:</p><p class="text-xs vpa-text-faint italic">${sanitizeHTML(shot.audio_description)}</p></div>` : ''}
                                    ${shot.key_elements && shot.key_elements.length > 0 ? `<div class="mb-2"><p class="text-xs font-semibold vpa-text-faint">Key Elements:</p><ul class="list-disc list-inside pl-2 text-xs vpa-text-faint">${shot.key_elements.map(el => `<li>${sanitizeHTML(el)}</li>`).join('')}</ul></div>` : ''}
                                    <button data-shot-description="${sanitizeHTML(shot.description)}" class="storyboard-apply-shot-btn text-xs studio-button-secondary hover:bg-purple-700 hover:border-purple-600">Use Shot as Base Prompt</button>
                                </div>
                            `).join('')}
                        </div>`;
                }
                storyboardContent += `</div>`;
                return storyboardContent;

            case 'visualize':
                let visualizeContent = `
                    <div class="space-y-4">
                        <div>
                            <h4 class="font-semibold text-purple-300 mb-1">Prompt to Visualize:</h4>
                            <p class="text-sm vpa-text-subdued whitespace-pre-wrap p-3 studio-bg-card-nested rounded-md border studio-border-soft max-h-32 overflow-y-auto custom-scrollbar">
                                ${sanitizeHTML(data.promptToVisualize?.text || "No prompt selected.")}
                            </p>
                        </div>`;

                if (result && result.visualizedImageUrl) {
                    visualizeContent += `
                        <div class="mt-4 border studio-border-soft rounded-lg overflow-hidden bg-black flex justify-center items-center">
                            <img src="${sanitizeHTML(result.visualizedImageUrl)}" alt="Visualization of the prompt" class="w-auto h-auto max-w-full max-h-[60vh] object-contain" />
                        </div>`;
                } else {
                     visualizeContent += `
                        <div class="mt-3 p-3 bg-blue-700 bg-opacity-20 text-blue-200 rounded-md text-center">
                            <p class="font-medium">Image Generation Not Available</p>
                            <p class="text-sm">This feature is for UI demonstration only in this Tampermonkey script. Actual image generation requires direct API access not available here.</p>
                            <button id="visualize-acknowledge-btn" class="mt-3 text-xs studio-button-secondary hover:bg-blue-700/30">
                                Acknowledge
                            </button>
                        </div>`;
                }
                visualizeContent += `</div>`;
                return visualizeContent;
            default:
                return '<p class="vpa-text-subdued">No content configured for this modal type.</p>';
        }
    }

    function attachModalSpecificEventListeners(type) {
        const modalInnerContainer = generalModalContainer.querySelector('#modal-inner-container');
        if (!modalInnerContainer) return;

        if (type === 'advancedSettings') {
            modalInnerContainer.querySelector('#adv-clear-all-btn')?.addEventListener('click', handleClearAllAdvanced);
            modalInnerContainer.querySelector('#adv-done-btn')?.addEventListener('click', closeModal);
            modalInnerContainer.querySelectorAll('select, input').forEach(el => {
                el.addEventListener('change', (e) => {
                    const paramName = e.target.id.replace('adv-', '');
                    state.promptParams[paramName] = e.target.value;
                });
            });
        } else if (type === 'critique') {
            modalInnerContainer.querySelectorAll('.critique-apply-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const suggestionIndex = parseInt(e.currentTarget.dataset.suggestionIndex, 10);
                    const suggestion = state.activeModal.result.suggested_enhancements[suggestionIndex];
                    if (suggestion && state.activeModal.data.promptToCritique?.id) {
                        handleUpdatePromptText(state.activeModal.data.promptToCritique.id, suggestion);
                        closeModal();
                    }
                });
            });
        } else if (type === 'themeExplorer') {
            const input = modalInnerContainer.querySelector('#theme-explorer-input');
            const genBtn = modalInnerContainer.querySelector('#theme-explorer-generate-btn');
            if (input) {
                input.addEventListener('input', (e) => {
                    state.activeModal.data.themeInput = e.target.value;
                    if(genBtn) genBtn.disabled = (!e.target.value || !e.target.value.trim());
                });
            }
            if (genBtn) {
                genBtn.addEventListener('click', () => {
                    if (state.activeModal.data.themeInput && state.activeModal.data.themeInput.trim()) {
                        handleGenerateThematicIdeas(state.activeModal.data.themeInput);
                    }
                });
            }
            modalInnerContainer.querySelectorAll('.theme-apply-idea').forEach(item => {
                item.addEventListener('click', (e) => {
                    const ideaText = e.currentTarget.dataset.ideaText;
                    const isAudio = e.currentTarget.dataset.isAudio === 'true';
                    handleApplyThematicIdea(ideaText, isAudio);
                    if (!isAudio) closeModal();
                });
            });
        } else if (type === 'elaborate') {
            modalInnerContainer.querySelectorAll('.elaborate-apply-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const suggestionIndex = parseInt(e.currentTarget.dataset.suggestionIndex, 10);
                    const suggestion = state.activeModal.result.elaborated_prompts[suggestionIndex];
                     if (suggestion && state.activeModal.data.promptToElaborate?.id) {
                        handleUpdatePromptText(state.activeModal.data.promptToElaborate.id, suggestion);
                        closeModal();
                    }
                });
            });
        } else if (type === 'sequence') {
            modalInnerContainer.querySelectorAll('.sequence-add-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const suggestionIndex = parseInt(e.currentTarget.dataset.suggestionIndex, 10);
                    const suggestion = state.activeModal.result.suggested_sequence_prompts[suggestionIndex];
                    if (suggestion) handleAddSequencePromptToGenerated(suggestion);
                });
            });
            modalInnerContainer.querySelectorAll('.sequence-copy-btn').forEach(btn => {
                btn.addEventListener('click', (e) => GM_setClipboard(e.currentTarget.dataset.suggestionText, 'text'));
            });
        } else if (type === 'characterGen') {
            const input = modalInnerContainer.querySelector('#char-gen-input');
            const genBtn = modalInnerContainer.querySelector('#char-gen-generate-btn');
             if (input) {
                input.addEventListener('input', (e) => {
                    state.activeModal.data.conceptInput = e.target.value;
                     if(genBtn) genBtn.disabled = (!e.target.value || !e.target.value.trim());
                });
            }
            if (genBtn) {
                 genBtn.addEventListener('click', () => {
                    if (state.activeModal.data.conceptInput && state.activeModal.data.conceptInput.trim()) {
                        handleGenerateCharacterDetails(state.activeModal.data.conceptInput);
                    }
                });
            }
            modalInnerContainer.querySelectorAll('.char-apply-detail').forEach(item => {
                item.addEventListener('click', (e) => {
                    const detailText = e.currentTarget.dataset.detailText;
                    const isAudio = e.currentTarget.dataset.isAudio === 'true';
                    handleApplyCharacterDetail(detailText, isAudio);
                     if (!isAudio) closeModal();
                });
            });
        } else if (type === 'styleTransfer') {
            const select = modalInnerContainer.querySelector('#targetStyleSelect');
            const execBtn = modalInnerContainer.querySelector('#style-transfer-execute-btn');
            if(select) {
                select.addEventListener('change', (e) => {
                    state.activeModal.data.targetStyle = e.target.value;
                    if(execBtn) execBtn.disabled = !e.target.value;
                });
            }
            if(execBtn) execBtn.addEventListener('click', handleExecuteStyleTransfer);
        } else if (type === 'storyboard') {
            const input = modalInnerContainer.querySelector('#storyboard-concept-input');
            const genBtn = modalInnerContainer.querySelector('#storyboard-generate-btn');
             if (input) {
                input.addEventListener('input', (e) => {
                    state.activeModal.data.conceptInput = e.target.value;
                     if(genBtn) genBtn.disabled = (!e.target.value || !e.target.value.trim());
                });
            }
            if (genBtn) genBtn.addEventListener('click', () => {
                 if (state.activeModal.data.conceptInput && state.activeModal.data.conceptInput.trim()) {
                    handleGenerateStoryboard(state.activeModal.data.conceptInput);
                }
            });
            modalInnerContainer.querySelectorAll('.storyboard-apply-shot-btn').forEach(btn => {
                btn.addEventListener('click', (e) => handleApplyStoryboardShotToInput(e.currentTarget.dataset.shotDescription));
            });
        } else if (type === 'visualize') {
            const ackBtn = modalInnerContainer.querySelector('#visualize-acknowledge-btn');
            if(ackBtn) ackBtn.addEventListener('click', closeModal);
        }
    }
    // --- END: Modal Rendering ---

    // --- START: Event Handlers and Logic ---
    function handleParamChange(newParams) {
        console.log('[VideoFX Artisan] Param change:', newParams);
        
        // Special handling for audio prompting toggle
        if ('enableAudioPrompting' in newParams) {
            const oldState = state.promptParams.enableAudioPrompting;
            const newState = newParams.enableAudioPrompting;
            
            console.log(`[VideoFX Artisan] Audio prompting changed from ${oldState} to ${newState}`);
            
            // Show user feedback
            const feedbackMsg = newState 
                ? "🎵 Audio prompting enabled - prompts will include sound descriptions"
                : "🔇 Audio prompting disabled - prompts will be visual only";
            
            showTemporaryNotification(feedbackMsg, 'info');
            
            // Clear any existing prompts to encourage regeneration
            if (state.generatedPrompts.length > 0) {
                setTimeout(() => {
                    showTemporaryNotification("💡 Regenerate prompts to see the difference!", 'info');
                }, 3500);
            }
        }
        
        state.promptParams = { ...state.promptParams, ...newParams };
        console.log('[VideoFX Artisan] Updated state.promptParams:', state.promptParams);
        clearError();
        renderApp();
    }

    function handleModeChange(newMode) {
        state.activeMode = newMode;
        // Reset some params when switching modes if necessary, or just re-render
        renderApp();
    }

    function handleClearImage() {
        if (state.uploadedImage?.previewUrl) URL.revokeObjectURL(state.uploadedImage.previewUrl);
        state.uploadedImage = null;
        state.promptParams.imageB64 = null;
        state.promptParams.imageMimeType = null;
        if (fileInputRef) fileInputRef.value = "";
        renderApp();
    }

    function handleImageUpload(file) {
        clearError();
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            showError(`Invalid file type. Please upload ${ALLOWED_IMAGE_TYPES.map(t => t.split('/')[1]).join(', ')} images.`);
            return;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
            showError(`Image is too large. Maximum size is ${MAX_IMAGE_SIZE_MB}MB.`);
            return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = (reader.result).split(',')[1];
            const previewUrl = URL.createObjectURL(file);
            state.uploadedImage = { b64: base64String, mimeType: file.type, name: file.name, previewUrl };
            state.promptParams.imageB64 = base64String;
            state.promptParams.imageMimeType = file.type;
            renderApp();
        };
        reader.onerror = () => {
            showError("Failed to read image file.");
            renderApp();
        };
        reader.readAsDataURL(file);
    }

    async function handleSubmitPrompt() {
        if ((!state.promptParams.description || !state.promptParams.description.trim()) && !state.uploadedImage) {
            showError("Please describe your vision or upload an image.");
            return;
        }
        showLoading(state.activeMode === 'sceneExtender' ? "Extending scene..." : "Crafting prompts...");
        state.generatedPrompts = []; // Clear previous prompts
        clearError();

        let paramsForGeneration = { ...state.promptParams };
        if (state.uploadedImage) { // Already set in state.promptParams, but good to be explicit
            paramsForGeneration.imageB64 = state.uploadedImage.b64;
            paramsForGeneration.imageMimeType = state.uploadedImage.mimeType;
        }

        const shouldInfer = state.activeMode === 'generator' && !paramsForGeneration.style && !paramsForGeneration.cameraAngle && !paramsForGeneration.cameraMovement && !paramsForGeneration.lighting;
        if (shouldInfer) {
            showLoading("Analyzing & inferring settings...");
            try {
                const inferredParamsResult = await callArtisanApiInternal('inferVisualParams', paramsForGeneration.description, paramsForGeneration);
                if (inferredParamsResult && typeof inferredParamsResult === 'object') {
                     paramsForGeneration = { ...paramsForGeneration,
                        style: inferredParamsResult.style || VEO_STYLES[1], // Default to Cinematic if not inferred
                        cameraAngle: inferredParamsResult.cameraAngle || paramsForGeneration.cameraAngle,
                        cameraMovement: inferredParamsResult.cameraMovement || paramsForGeneration.cameraMovement,
                        lighting: inferredParamsResult.lighting || paramsForGeneration.lighting,
                    };
                    state.promptParams = {...state.promptParams, ...paramsForGeneration}; // Update main state too
                } else {
                     if (!paramsForGeneration.style) paramsForGeneration.style = VEO_STYLES[1]; // Fallback
                }
            } catch (inferErr) {
                console.warn("Could not infer visual params:", inferErr);
                if (!paramsForGeneration.style) paramsForGeneration.style = VEO_STYLES[1]; // Fallback
            }
        }
        showLoading(state.activeMode === 'sceneExtender' ? "Extending scene..." : "Crafting prompts...");

        try {
            console.log('[VideoFX Artisan] Making API call with params:', paramsForGeneration);
            const apiActionKey = state.activeMode === 'generator' ? 'mainPromptGen' : 'sceneExtender';
            const apiResult = await callArtisanApiInternal(apiActionKey, paramsForGeneration.description, paramsForGeneration);

            if (state.activeMode === 'sceneExtender') {
                if (typeof apiResult === 'string') { // Expecting plain text for scene extender
                    state.generatedPrompts = [{ id: `${Date.now()}-0`, text: apiResult.trim() }];
                    
                    // Show success notification for scene extender
                    const audioMode = state.promptParams.enableAudioPrompting ? 'with audio descriptions' : 'visual only';
                    showTemporaryNotification(`✅ Scene extended (${audioMode})`, 'success');
                } else {
                     console.error("Scene extender did not return a string:", apiResult);
                     throw new Error("Scene extender returned an unexpected data format. Expected plain text.");
                }
            } else { // Generator mode
                if (Array.isArray(apiResult) && apiResult.every(p => typeof p.prompt_text === 'string')) {
                    state.generatedPrompts = apiResult.map((p, i) => ({ id: `${Date.now()}-${i}`, text: p.prompt_text }));
                    
                    // Show success notification with audio mode indication
                    const audioMode = state.promptParams.enableAudioPrompting ? 'with audio descriptions' : 'visual only';
                    showTemporaryNotification(`✅ Generated ${apiResult.length} prompt(s) (${audioMode})`, 'success');
                } else if (apiActionKey !== 'sceneExtender' && typeof apiResult === 'object' && apiResult !== null) {
                    // Fallback for cases where API might return a single prompt object directly for mainPromptGen, or other direct objects
                    // This is less likely for mainPromptGen given the preamble, but as a safeguard.
                    console.warn("API result for generator mode was not an array of prompt_text objects. Attempting to handle as single/direct object:", apiResult);
                    if(typeof apiResult.prompt_text === 'string'){ // If it's a single prompt_text object
                         state.generatedPrompts = [{ id: `${Date.now()}-0`, text: apiResult.prompt_text }];
                         
                         // Show success notification for single prompt
                         const audioMode = state.promptParams.enableAudioPrompting ? 'with audio descriptions' : 'visual only';
                         showTemporaryNotification(`✅ Generated 1 prompt (${audioMode})`, 'success');
                    } else { // If it's some other object structure (e.g. surpriseMe's output being routed here by mistake) - log and error
                         console.error("Main prompt generator returned an object but not in the expected format {prompt_text: string}:", apiResult);
                         throw new Error("Prompt generator returned an unexpected object format.");
                    }
                }
                else {
                     console.error("Main prompt generator did not return an array of {prompt_text: string}:", apiResult);
                    throw new Error("Prompt generator returned an unexpected data format.");
                }
            }
        } catch (err) {
            showError(err.message || "Prompt generation failed.");
        } finally {
            hideLoading();
        }
    }


    function handleClearPrompt() {
        state.promptParams.description = '';
        handleClearImage(); // Also clears image params
        clearError();
        renderApp();
    }

    function handleResetAllFields() {
        state.promptParams = {
            description: '', style: "", aspectRatio: '', cameraAngle: '', cameraMovement: '', lighting: '', durationHint: '', negativePrompt: '',
            numberOfPrompts: VEO_PROMPT_COUNT_OPTIONS_VALUES[0], imageB64: null, imageMimeType: null,
            enableAudioPrompting: state.promptParams.enableAudioPrompting, // Retain audio toggle
        };
        state.generatedPrompts = [];
        handleClearImage();
        clearError();
        state.activeMode = "generator"; // Reset mode
        renderApp();
    }

    function handleClearAllAdvanced() {
        const preservedDescription = state.promptParams.description;
        const preservedStyle = state.promptParams.style;
        const preservedNumPrompts = state.promptParams.numberOfPrompts;
        const preservedAudio = state.promptParams.enableAudioPrompting;

        state.promptParams = {
            ...state.promptParams, // Keep imageB64 and imageMimeType if they exist
            aspectRatio: '', cameraAngle: '', cameraMovement: '', lighting: '', durationHint: '', negativePrompt: '',
            description: preservedDescription, style: preservedStyle, numberOfPrompts: preservedNumPrompts, enableAudioPrompting: preservedAudio
        };
        // No need to re-render the whole app, just the modal.
        // However, closeModal and re-opening will re-render modal with fresh values
        openModal('advancedSettings'); // Re-opens with fresh state
    }

    function handleUseAsBase(promptText) {
        state.promptParams.description = promptText;
        // Optionally reset other params, or keep them for refinement
        // state.promptParams.style = ""; // example
        state.generatedPrompts = []; // Clear generated prompts as we're starting new
        handleClearImage(); // Clear image if any
        clearError();
        renderApp();
        mainTextarea.focus();
    }

    function handleUpdatePromptText(promptId, newText) {
        state.generatedPrompts = state.generatedPrompts.map(p => p.id === promptId ? { ...p, text: newText } : p);
        renderApp(); // Re-render the prompt list
    }

    async function handleSurpriseMe() {
        showLoading("Conjuring a random concept...");
        handleClearImage(); // Clear any existing image
        state.activeMode = "generator"; // Switch to generator mode for surprise me
        clearError();
        try {
            const surprise = await callArtisanApiInternal('surpriseMe', "Generate a random concept.", state.promptParams);
            if (surprise && surprise.concept && surprise.suggestedStyle) {
                let conceptWithAudio = surprise.concept;
                if (state.promptParams.enableAudioPrompting && surprise.suggestedAudio && Array.isArray(surprise.suggestedAudio) && surprise.suggestedAudio.length > 0) {
                    conceptWithAudio += ` Audio: ${surprise.suggestedAudio.join(', ')}.`;
                }
                state.promptParams = {
                    ...state.promptParams, // Keep existing audio toggle, aspect ratio etc. if desired for surprise me
                    description: conceptWithAudio,
                    style: surprise.suggestedStyle,
                    cameraAngle: surprise.suggestedCameraAngle || '',
                    cameraMovement: surprise.suggestedCameraMovement || '',
                    lighting: surprise.suggestedLighting || '',
                    numberOfPrompts: VEO_PROMPT_COUNT_OPTIONS_VALUES[0],
                };
                state.generatedPrompts = [];
            } else {
                throw new Error("Surprise concept response was malformed or missing key fields (concept, suggestedStyle).");
            }
        } catch (err) {
            showError(err.message || "Surprise Me failed.");
        } finally {
            hideLoading();
        }
    }

    function handleInspirationSelect(inspiration) {
        handleClearImage();
        state.activeMode = "generator";
        state.promptParams = {
            ...state.promptParams, // Keep audio toggle and other non-inspiration params
            description: inspiration.concept,
            style: inspiration.params.style || "",
            cameraAngle: inspiration.params.cameraAngle || '',
            cameraMovement: inspiration.params.cameraMovement || '',
            lighting: inspiration.params.lighting || '',
            numberOfPrompts: VEO_PROMPT_COUNT_OPTIONS_VALUES[0],
        };
        state.generatedPrompts = [];
        clearError();
        renderApp();
    }
    // Feature-specific handlers (Critique, Theme Explorer, etc.)
    async function handleCritiquePrompt(promptToCritique) {
        updateModalState({ isLoading: true, error: null, result: null, data: { promptToCritique } });
        try {
            const result = await callArtisanApiInternal('promptCritique', promptToCritique.text, state.promptParams, { promptToCritique: promptToCritique.text });
            updateModalState({ isLoading: false, result });
        } catch (err) {
            updateModalState({ isLoading: false, error: err.message || "Failed to get critique." });
        }
    }
    async function handleGenerateThematicIdeas(theme) {
        updateModalState({ isLoading: true, error: null, result: null, data: { ...state.activeModal.data, themeInput: theme } });
        try {
            const result = await callArtisanApiInternal('themeExplorer', `Theme: ${theme}`, state.promptParams, { theme });
            updateModalState({ isLoading: false, result });
        } catch (err) {
            updateModalState({ isLoading: false, error: err.message || "Failed to generate thematic ideas." });
        }
    }
    function handleApplyThematicIdea(ideaText, isAudioIdea = false) {
        if (isAudioIdea && state.promptParams.enableAudioPrompting) {
            state.promptParams.description = state.promptParams.description ? `${state.promptParams.description}. Audio: ${ideaText}` : `Audio: ${ideaText}`;
        } else {
            state.promptParams.description = state.promptParams.description ? `${state.promptParams.description}, ${ideaText}` : ideaText;
        }
        renderApp(); // Update main textarea
    }
    async function handleElaboratePrompt(promptToElaborate) {
        updateModalState({ isLoading: true, error: null, result: null, data: { promptToElaborate } });
        try {
            const result = await callArtisanApiInternal('promptElaboration', promptToElaborate.text, state.promptParams, { originalPrompt: promptToElaborate.text });
            updateModalState({ isLoading: false, result });
        } catch (err) {
            updateModalState({ isLoading: false, error: err.message || "Failed to elaborate prompt." });
        }
    }
    async function handleSuggestSequence(basePrompt) {
        updateModalState({ isLoading: true, error: null, result: null, data: { basePrompt } });
        try {
            const result = await callArtisanApiInternal('shotSequenceGen', basePrompt.text, state.promptParams, { originalPrompt: basePrompt.text });
            updateModalState({ isLoading: false, result });
        } catch (err) {
            updateModalState({ isLoading: false, error: err.message || "Failed to suggest sequence." });
        }
    }
    function handleAddSequencePromptToGenerated(promptText) {
        const newPrompt = { id: `${Date.now()}-seq-${Math.random().toString(36).substring(2, 5)}`, text: promptText };
        state.generatedPrompts.push(newPrompt);
        renderApp();
        closeModal(); // Optionally close sequence modal
    }
    async function handleGenerateCharacterDetails(characterConcept) {
        updateModalState({ isLoading: true, error: null, result: null, data: { ...state.activeModal.data, conceptInput: characterConcept } });
        try {
            const result = await callArtisanApiInternal('charDetailGen', `Character Concept: ${characterConcept}`, state.promptParams, { characterConcept });
            updateModalState({ isLoading: false, result });
        } catch (err) {
            updateModalState({ isLoading: false, error: err.message || "Failed to generate character details." });
        }
    }
    function handleApplyCharacterDetail(detailText, isAudioDetail = false) {
         if (isAudioDetail && state.promptParams.enableAudioPrompting) {
            state.promptParams.description = state.promptParams.description ? `${state.promptParams.description}. Voice: ${detailText}` : `Voice: ${detailText}`;
        } else {
            state.promptParams.description = state.promptParams.description ? `${state.promptParams.description}, ${detailText}` : detailText;
        }
        renderApp();
    }
    async function handleExecuteStyleTransfer() {
        if (!state.activeModal || !state.activeModal.data.promptToStyle || !state.activeModal.data.targetStyle) {
            updateModalState({ error: "Missing prompt or target style for transfer." });
            return;
        }
        updateModalState({ isLoading: true, error: null });
        try {
            const result = await callArtisanApiInternal('styleTransfer', state.activeModal.data.originalPromptText, state.promptParams, {
                originalPrompt: state.activeModal.data.originalPromptText,
                targetStyle: state.activeModal.data.targetStyle
            });
            if (result && result.stylized_prompt) {
                handleUpdatePromptText(state.activeModal.data.promptToStyle.id, result.stylized_prompt);
                closeModal();
            } else {
                 throw new Error("Style transfer did not return a stylized prompt.");
            }
        } catch (err) {
            updateModalState({ isLoading: false, error: err.message || "Failed to transfer style." });
        }
    }
    async function handleGenerateStoryboard(concept) {
        updateModalState({ isLoading: true, error: null, result: null, data: { ...state.activeModal.data, conceptInput: concept }});
        try {
            const result = await callArtisanApiInternal('storyboardGen', `Concept: ${concept}`, state.promptParams, { concept });
            updateModalState({ isLoading: false, result });
        } catch (err) {
            updateModalState({ isLoading: false, error: err.message || "Failed to generate storyboard." });
        }
    }
    function handleApplyStoryboardShotToInput(shotDescription) {
        state.promptParams.description = shotDescription;
        renderApp();
        // closeModal(); // Optional: user might want to pick multiple shots
    }

    // --- END: Event Handlers and Logic ---


    // --- START: UI Creation ---
    function createSelectFieldHTML(id, label, value, optionsDisplay, optionsValues, tooltipText = "", className = "") {
        return `
            <div class="${className}">
                <div class="flex items-center mb-1">
                    <label for="${id}" class="block text-xs font-medium vpa-text-subdued">${label}</label>
                    ${tooltipText ? `<div class="relative inline-flex ml-2 info-tooltip-trigger" title="${sanitizeHTML(tooltipText)}">${createIconSpanHTML("info", "default", "w-4 h-4 text-gray-400 hover:text-gray-200 cursor-help")}</div>` : ''}
                </div>
                <select id="${id}" class="w-full studio-input-base text-sm">
                    ${optionsDisplay.map((display, index) => `<option value="${sanitizeHTML(String(optionsValues[index]))}" ${String(optionsValues[index]) === String(value) ? 'selected' : ''}>${sanitizeHTML(display === "" ? "Any / Auto" : display)}</option>`).join('')}
                </select>
            </div>`;
    }
    function createTextFieldHTML(id, label, value, placeholder, tooltipText = "", className = "") {
         return `
            <div class="${className}">
                <div class="flex items-center mb-1">
                    <label for="${id}" class="block text-xs font-medium vpa-text-subdued">${label}</label>
                    ${tooltipText ? `<div class="relative inline-flex ml-2 info-tooltip-trigger" title="${sanitizeHTML(tooltipText)}">${createIconSpanHTML("info", "default", "w-4 h-4 text-gray-400 hover:text-gray-200 cursor-help")}</div>` : ''}
                </div>
                <input type="text" id="${id}" value="${sanitizeHTML(value || "")}" placeholder="${sanitizeHTML(placeholder)}" class="w-full studio-input-base text-sm" />
            </div>`;
    }

    function createToggleButton() {
        toggleButton = document.createElement('button');
        toggleButton.id = TOGGLE_BUTTON_ID;
        toggleButton.innerHTML = `
            <div class="toggle-icon">
                ${createIconSpanHTML("ArtisanIcon", "default", "w-6 h-6")}
            </div>
        `;
        toggleButton.title = "Toggle Veo Prompt Artisan UI";
        toggleButton.className = "fixed bottom-5 right-5 z-[9998] p-3 rounded-full shadow-lg border transition-all duration-200 ease-in-out vfx-enhanced-toggle";
        toggleButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        toggleButton.style.borderColor = '#667eea';
        toggleButton.style.color = 'white';
        toggleButton.style.width = '60px';
        toggleButton.style.height = '60px';
        toggleButton.style.display = 'flex';
        toggleButton.style.alignItems = 'center';
        toggleButton.style.justifyContent = 'center';
        
        document.body.appendChild(toggleButton);
        
        toggleButton.addEventListener('click', () => {
            if (overlayContainer) {
                const isHidden = overlayContainer.style.display === 'none';
                if (isHidden) {
                    overlayContainer.classList.remove('animate-slideDown');
                    void overlayContainer.offsetWidth;
                    overlayContainer.style.display = 'flex';
                    overlayContainer.classList.add('animate-slideDown');
                } else {
                    overlayContainer.style.display = 'none';
                    overlayContainer.classList.remove('animate-slideDown');
                }

                // Update button appearance
                if (isHidden) {
                    toggleButton.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
                    toggleButton.style.transform = 'scale(1.1)';
                } else {
                    toggleButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    toggleButton.style.transform = 'scale(1)';
                }
            }
        });
        
        // Add hover effects
        toggleButton.addEventListener('mouseenter', () => {
            toggleButton.style.transform = 'translateY(-2px) scale(1.05)';
            toggleButton.style.boxShadow = '0 12px 35px rgba(102, 126, 234, 0.4)';
        });
        
        toggleButton.addEventListener('mouseleave', () => {
            const isActive = overlayContainer && overlayContainer.style.display !== 'none';
            toggleButton.style.transform = isActive ? 'scale(1.1)' : 'scale(1)';
            toggleButton.style.boxShadow = '0 8px 25px rgba(102, 126, 234, 0.3)';
        });
    }


    function createOverlayUI() {
        overlayContainer = document.createElement('div');
        overlayContainer.id = OVERLAY_ID;
        overlayContainer.className = "vfx-floating-window";
        overlayContainer.style.display = 'none'; // Start hidden
        overlayContainer.style.position = 'fixed';
        overlayContainer.style.width = windowState.width + 'px';
        overlayContainer.style.height = windowState.height + 'px';
        overlayContainer.style.right = '20px';
        overlayContainer.style.top = windowState.y + 'px';
        overlayContainer.style.zIndex = '9999';
        overlayContainer.style.borderRadius = '12px';
        overlayContainer.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        overlayContainer.style.boxShadow = '0 20px 60px rgba(0, 0, 0, 0.5)';
        overlayContainer.style.backgroundColor = '#121212'; // Solid background, no blur
        overlayContainer.style.color = '#ffffff';
        overlayContainer.style.fontFamily = "'Google Sans Text', 'Google Sans', 'Space Grotesk', sans-serif";
        overlayContainer.style.overflow = 'hidden';
        overlayContainer.style.flexDirection = 'column';
        overlayContainer.style.minWidth = windowState.minWidth + 'px';
        overlayContainer.style.minHeight = windowState.minHeight + 'px';
        overlayContainer.style.maxWidth = windowState.maxWidth + 'px';
        overlayContainer.style.maxHeight = windowState.maxHeight + 'px';

        overlayContainer.innerHTML = `
            <!-- Enhanced Draggable Header -->
            <header class="vfx-window-header studio-bg-base studio-border-soft border-b px-4 py-2 sm:px-6 sticky top-0 z-30" style="cursor: grab; user-select: none;">
                <div class="w-full max-w-7xl mx-auto flex items-center justify-between h-12">
                    <div class="flex items-center space-x-2">
                        ${createIconSpanHTML("ArtisanIcon", "default", "w-7 h-7 text-purple-500")}
                        <h1 class="text-lg font-medium vpa-text-main"> Veo <span class="font-normal vpa-text-subdued">Prompt Artisan</span></h1>
                    </div>
                    <div class="flex items-center space-x-2">
                        <button id="vfx-minimize-btn" class="p-1.5 rounded-full vpa-text-subdued hover:vpa-text-main hover:bg-yellow-600" title="Minimize">
                            <span style="font-family: monospace;">−</span>
                        </button>
                        <button id="vfx-maximize-btn" class="p-1.5 rounded-full vpa-text-subdued hover:vpa-text-main hover:bg-green-600" title="Maximize">
                            <span style="font-family: monospace;">□</span>
                        </button>
                        <button id="vfx-artisan-close-overlay" class="p-1.5 rounded-full vpa-text-subdued hover:vpa-text-main hover:bg-red-600" title="Close Overlay">
                            ${createIconSpanHTML("close", "default", "w-6 h-6")}
                        </button>
                    </div>
                </div>
            </header>

            <!-- Resize Handles -->
            <div class="resize-handle resize-handle-n" data-direction="n" style="position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 20px; height: 4px; cursor: ns-resize; z-index: 10;"></div>
            <div class="resize-handle resize-handle-s" data-direction="s" style="position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 20px; height: 4px; cursor: ns-resize; z-index: 10;"></div>
            <div class="resize-handle resize-handle-e" data-direction="e" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 4px; height: 20px; cursor: ew-resize; z-index: 10;"></div>
            <div class="resize-handle resize-handle-w" data-direction="w" style="position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 4px; height: 20px; cursor: ew-resize; z-index: 10;"></div>
            <div class="resize-handle resize-handle-ne" data-direction="ne" style="position: absolute; top: 0; right: 0; width: 12px; height: 12px; cursor: ne-resize; z-index: 10;"></div>
            <div class="resize-handle resize-handle-nw" data-direction="nw" style="position: absolute; top: 0; left: 0; width: 12px; height: 12px; cursor: nw-resize; z-index: 10;"></div>
            <div class="resize-handle resize-handle-se" data-direction="se" style="position: absolute; bottom: 0; right: 0; width: 12px; height: 12px; cursor: se-resize; z-index: 10;"></div>
            <div class="resize-handle resize-handle-sw" data-direction="sw" style="position: absolute; bottom: 0; left: 0; width: 12px; height: 12px; cursor: sw-resize; z-index: 10;"></div>

            <!-- Mode Switcher - Updated to match reference -->
            <div class="px-4 sm:px-6 md:px-8 pt-4">
                <div id="vfx-mode-switcher" class="max-w-4xl mx-auto flex rounded-lg overflow-hidden">
                    <button data-mode="generator" class="mode-btn flex-1 py-2 px-3 text-sm font-medium transition-all focus:outline-none" style="background-color: #7C3AED; color: white;">Generator</button>
                    <button data-mode="sceneExtender" class="mode-btn flex-1 py-2 px-3 text-sm font-medium transition-all focus:outline-none" style="background-color: #374151; color: #9CA3AF;">Scene Extender</button>
                </div>
                <p id="vfx-scene-extender-notice" class="max-w-4xl mx-auto text-xs vpa-text-faint mt-2 text-center bg-slate-700/50 p-2 rounded-md" style="display:none;">
                    Scene Extender mode: Provide a description of an existing scene. The AI will generate a new, extended scene description. Image references are highly recommended.
                </p>
            </div>

            <!-- Main Content Area - Updated to match reference -->
            <main class="flex-grow flex flex-col items-center justify-start p-4 sm:px-6 md:px-8 sm:pt-2 md:pt-4 overflow-y-auto relative text-center custom-scrollbar">
                <div id="vfx-artisan-main-content">
                    <!-- Loader or error will go here -->
                </div>
                <div id="vfx-artisan-welcome" class="flex flex-col items-center justify-start animate-fadeIn max-w-3xl w-full mt-8 space-y-12">
                    <div class="text-center p-6 rounded-lg studio-bg-elevated border studio-border-soft w-full">
                        ${createIconSpanHTML("ArtisanIcon", "default", "w-12 h-12 text-purple-500 mb-6 mx-auto")}
                        <h2 class="text-3xl font-semibold vpa-text-main mb-3">Welcome to Veo Prompt Artisan</h2>
                        <p class="text-lg vpa-text-subdued mb-8">Craft the perfect vision. Describe your idea, or upload an image to start.</p>
                        <button id="vfx-surprise-me-welcome" class="px-6 py-3 text-base font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 inline-flex items-center transition-all duration-150 ease-in-out transform hover:scale-105 focus:outline-none">
                            ${createIconSpanHTML("lightbulb", "default", "w-5 h-5 mr-2.5 text-yellow-400")}
                            Get a Random Concept
                        </button>
                    </div>
                    <div class="w-full">
                        <h3 class="text-xl vpa-text-subdued font-medium mb-5">Or explore these themes for inspiration:</h3>
                        <div id="vfx-inspiration-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                            ${INSPIRATION_PROMPTS.map((insp, index) => `
                                <button data-inspiration-index="${index}" class="inspiration-card studio-bg-elevated p-5 rounded-xl border studio-border-soft text-left hover:bg-gray-800 transition-all duration-200 ease-in-out focus:outline-none h-auto min-h-[140px] flex flex-col transform hover:-translate-y-1" aria-label="Try theme: ${sanitizeHTML(insp.title)}">
                                    <h4 class="font-semibold text-purple-400 mb-3 text-base">${sanitizeHTML(insp.title)}</h4>
                                    <p class="text-sm vpa-text-subdued flex-grow mb-4 leading-relaxed">${sanitizeHTML(insp.concept.length > 120 ? insp.concept.substring(0, 120) + '...' : insp.concept)}</p>
                                    <span class="mt-auto text-xs text-purple-500 font-medium self-start group"> Use Theme ${createIconSpanHTML("arrow_forward", "symbols-outlined", "w-3 h-3 inline-block transition-transform duration-150 ease-in-out group-hover:translate-x-1")}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div id="vfx-artisan-prompt-list" class="w-full max-w-3xl mx-auto animate-fadeIn mt-6" style="display:none;">
                    <!-- Generated prompts will be rendered here by renderPromptList -->
                </div>
            </main>

            <!-- Footer / Input Area - Updated to match reference -->
            <div id="vfx-prompt-input-footer-wrapper" class="sticky bottom-0 z-20 w-full pointer-events-auto bg-black bg-opacity-50 backdrop-blur-md studio-border-soft border-t p-3 sm:p-4">
                <div class="max-w-4xl mx-auto space-y-3">
                    <div id="vfx-image-preview-container"></div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 items-center">
                        <div id="footer-audio-toggle" class="md:col-span-2 lg:col-span-1 flex items-center py-1 px-3 rounded-lg border ${state.promptParams.enableAudioPrompting ? 'border-purple-500/40 bg-purple-500/10' : 'border-gray-500/20 bg-gray-500/5'} transition-all duration-200">
                             <button type="button" role="switch" aria-checked="${state.promptParams.enableAudioPrompting}" id="vfx-enable-audio-toggle" class="${state.promptParams.enableAudioPrompting ? 'bg-purple-600' : 'bg-gray-600'} relative inline-flex items-center h-6 rounded-full w-11 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800" style="pointer-events: auto !important; cursor: pointer !important;">
                                <span class="${state.promptParams.enableAudioPrompting ? 'translate-x-6' : 'translate-x-1'} inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-200 shadow-lg"></span>
                            </button>
                            <label for="vfx-enable-audio-toggle" class="ml-2 text-sm font-medium vpa-text-subdued cursor-pointer select-none">Enable Audio Prompting</label>
                            <span class="ml-2 text-xs ${state.promptParams.enableAudioPrompting ? 'text-purple-400' : 'text-gray-500'} font-medium transition-colors duration-200 audio-status-indicator">
                                ${state.promptParams.enableAudioPrompting ? '🎵 ON' : '🔇 OFF'}
                            </span>
                            <div class="relative inline-flex ml-2 info-tooltip-trigger" title="${sanitizeHTML(PARAM_INFO_TOOLTIPS.enableAudioPrompting)}">${createIconSpanHTML("info", "default", "w-4 h-4 text-gray-400 hover:text-gray-200 cursor-help")}</div>
                        </div>
                        ${createSelectFieldHTML("footer-numberOfPrompts", "Outputs per prompt", state.promptParams.numberOfPrompts, VEO_PROMPT_COUNT_OPTIONS_DISPLAY, VEO_PROMPT_COUNT_OPTIONS_VALUES, "", "lg:col-span-1")}
                        ${createSelectFieldHTML("footer-style", "Visual Style", state.promptParams.style, VEO_STYLES, VEO_STYLES, "", "lg:col-span-1")}
                        <div id="footer-sceneext-placeholder" class="lg:col-span-2 hidden lg:block"></div> <!-- Placeholder for grid alignment -->

                        <div id="footer-buttons-group" class="flex space-x-1 sm:space-x-2 items-center lg:col-span-3 justify-end pt-2 md:pt-0 mt-2 md:mt-0 w-full">
                            <button id="vfx-storyboard-btn" class="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-700 hidden sm:inline-flex items-center justify-center shrink-0 disabled:opacity-50" aria-label="Create Storyboard from Concept" title="Prompt to Storyboard ✨">${createIconSpanHTML("view_carousel", "default", "w-5 h-5")}</button>
                            <button id="vfx-char-gen-btn" class="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-700 hidden sm:inline-flex items-center justify-center shrink-0 disabled:opacity-50" aria-label="Generate Character Details" title="Character Detail Generator ✨">${createIconSpanHTML("person", "default", "w-5 h-5")}</button>
                            <button id="vfx-theme-explorer-btn" class="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-700 hidden sm:inline-flex items-center justify-center shrink-0 disabled:opacity-50" aria-label="Explore thematic ideas" title="Theme Explorer ✨">${createIconSpanHTML("search", "default", "w-5 h-5")}</button>
                            <button id="vfx-surprise-me-footer" class="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-700 hidden sm:inline-flex items-center justify-center shrink-0 disabled:opacity-50" aria-label="Surprise me with a random concept" title="Surprise Me">${createIconSpanHTML("lightbulb", "default", "w-5 h-5")}</button>
                            <button id="vfx-reset-all-btn" class="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-700 inline-flex items-center justify-center shrink-0 disabled:opacity-50" aria-label="Reset all fields" title="Reset All Fields">${createIconSpanHTML("delete", "default", "w-5 h-5")}</button>
                            <button id="vfx-advanced-settings-btn" class="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-700 inline-flex items-center justify-center shrink-0 disabled:opacity-50" aria-label="Open advanced settings" title="Advanced Settings">${createIconSpanHTML("settings", "default", "w-5 h-5")}</button>
                        </div>
                    </div>
                     <div class="flex items-end space-x-2 sm:space-x-3 mt-3">
                        <input type="file" id="vfx-file-input" accept="${ALLOWED_IMAGE_TYPES.join(',')}" class="hidden" aria-hidden="true" />
                        <button id="vfx-upload-image-btn" class="p-2 rounded-full text-gray-300 hover:text-white hover:bg-gray-700 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Upload image reference" title="${sanitizeHTML(PARAM_INFO_TOOLTIPS.imageInput)}">${createIconSpanHTML("attachment", "default", "w-5 h-5")}</button>
                        <div class="flex-grow relative">
                            <textarea id="vfx-main-textarea" placeholder="Describe your vision... e.g., 'A majestic lion surveying the savanna at dawn'" rows="1" class="w-full p-3 pr-10 bg-gray-900 border border-gray-700 rounded-md text-base leading-tight resize-none overflow-y-auto custom-scrollbar" style="max-height: 150px; min-height: 52px;" aria-label="Main prompt description"></textarea>
                            <button id="vfx-clear-prompt-btn" class="absolute right-2.5 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-white" aria-label="Clear prompt text and image" title="Clear Text & Image" style="display:none;">${createIconSpanHTML("close", "default", "w-5 h-5")}</button>
                        </div>
                        <button id="vfx-generate-btn" class="p-3 bg-purple-600 text-white inline-flex items-center justify-center shrink-0 rounded-lg text-base font-medium transition-transform transform hover:scale-105 hover:bg-purple-700 focus:outline-none" style="min-height: 52px;" aria-label="Generate"></button>
                    </div>
                </div>
            </div>

            <!-- General Modal Container -->
            <div id="vfx-general-modal-container" class="fixed z-[10000] flex items-center justify-center p-4 animate-fadeIn" style="display:none; pointer-events: none;" @click.self="closeModal">
                <!-- Modal content will be injected here by renderActiveModal -->
            </div>
        `;
        document.body.appendChild(overlayContainer);

        // Assign DOM element references after they are added to the DOM
        mainTextarea = overlayContainer.querySelector('#vfx-main-textarea');
        imagePreviewContainer = overlayContainer.querySelector('#vfx-image-preview-container');
        fileInputRef = overlayContainer.querySelector('#vfx-file-input');
        outputDisplayArea = overlayContainer.querySelector('#vfx-artisan-main-content'); // General area for loader/error
        welcomeScreen = overlayContainer.querySelector('#vfx-artisan-welcome');
        promptListContainer = overlayContainer.querySelector('#vfx-artisan-prompt-list');
        modeSwitcherContainer = overlayContainer.querySelector('#vfx-mode-switcher');
        footerStyleSelect = overlayContainer.querySelector('#footer-style');
        footerNumPromptsSelect = overlayContainer.querySelector('#footer-numberOfPrompts');
        footerAudioToggle = overlayContainer.querySelector('#footer-audio-toggle');
        footerAdvancedSettingsButton = overlayContainer.querySelector('#vfx-advanced-settings-btn');
        footerResetAllButton = overlayContainer.querySelector('#vfx-reset-all-btn');
        footerSurpriseMeButton = overlayContainer.querySelector('#vfx-surprise-me-footer');
        footerThemeExplorerButton = overlayContainer.querySelector('#vfx-theme-explorer-btn');
        footerCharGenButton = overlayContainer.querySelector('#vfx-char-gen-btn');
        footerStoryboardButton = overlayContainer.querySelector('#vfx-storyboard-btn');
        generateButton = overlayContainer.querySelector('#vfx-generate-btn');
        clearPromptButton = overlayContainer.querySelector('#vfx-clear-prompt-btn');
        uploadImageButton = overlayContainer.querySelector('#vfx-upload-image-btn');
        generalModalContainer = document.getElementById('vfx-general-modal-container'); // It's appended to body
    }
    // --- END: UI Creation ---

    // --- START: Event Listener Attachment ---
    function attachCoreEventListeners() {
        // Close overlay button
        overlayContainer.querySelector('#vfx-artisan-close-overlay')?.addEventListener('click', () => {
            overlayContainer.style.display = 'none';
            overlayContainer.classList.remove('animate-slideDown');
            windowState.isVisible = false;
            saveWindowState();
        });

        // Enhanced window controls with state management
        overlayContainer.querySelector('#vfx-minimize-btn')?.addEventListener('click', () => {
            safeExecute(() => {
                const content = overlayContainer.querySelector('main');
                if (windowState.isMinimized) {
                    // Restore from minimized
                    content.style.display = 'flex';
                    overlayContainer.style.height = windowState.height + 'px';
                    windowState.isMinimized = false;
                } else {
                    // Minimize
                    content.style.display = 'none';
                    overlayContainer.style.height = '60px'; // Just header height
                    windowState.isMinimized = true;
                }
                saveWindowState();
            }, 'Minimize button click');
        });

        overlayContainer.querySelector('#vfx-maximize-btn')?.addEventListener('click', () => {
            safeExecute(() => {
                if (windowState.isMaximized) {
                    // Restore from maximized
                    overlayContainer.style.width = windowState.width + 'px';
                    overlayContainer.style.height = windowState.height + 'px';
                    overlayContainer.style.left = windowState.x + 'px';
                    overlayContainer.style.top = windowState.y + 'px';
                    overlayContainer.style.right = 'auto';
                    windowState.isMaximized = false;
                } else {
                    // Maximize
                    overlayContainer.style.width = '100vw';
                    overlayContainer.style.height = '100vh';
                    overlayContainer.style.left = '0px';
                    overlayContainer.style.top = '0px';
                    overlayContainer.style.right = 'auto';
                    windowState.isMaximized = true;
                }
                saveWindowState();
            }, 'Maximize button click');
        });

        // Enhanced drag functionality with bounds checking
        const header = overlayContainer.querySelector('.vfx-window-header');
        if (header) {
            addTrackedEventListener(header, 'mousedown', (e) => {
                safeExecute(() => {
                    isDragging = true;
                    const rect = overlayContainer.getBoundingClientRect();
                    dragOffset.x = e.clientX - rect.left;
                    dragOffset.y = e.clientY - rect.top;
                    header.style.cursor = 'grabbing';
                    e.preventDefault();
                }, 'Header mousedown');
            });
        }

        addTrackedEventListener(document, 'mousemove', (e) => {
            safeExecute(() => {
                if (isDragging) {
                    const x = e.clientX - dragOffset.x;
                    const y = e.clientY - dragOffset.y;
                    const constrained = constrainToBounds(x, y, overlayContainer.offsetWidth, overlayContainer.offsetHeight);
                    overlayContainer.style.left = constrained.x + 'px';
                    overlayContainer.style.top = constrained.y + 'px';
                    overlayContainer.style.right = 'auto';
                    
                    // Update window state
                    windowState.x = constrained.x;
                    windowState.y = constrained.y;
                }
                
                // Handle resizing with bounds checking
                if (isResizing && resizeHandle) {
                    const rect = overlayContainer.getBoundingClientRect();
                    const direction = resizeHandle.dataset.direction;
                    let newWidth = windowState.width;
                    let newHeight = windowState.height;
                    let newX = rect.left;
                    let newY = rect.top;
                    
                    switch (direction) {
                        case 'se': // Southeast corner
                            newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, e.clientX - rect.left));
                            newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, e.clientY - rect.top));
                            break;
                        case 'sw': // Southwest corner
                            newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, rect.right - e.clientX));
                            newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, e.clientY - rect.top));
                            newX = Math.max(0, e.clientX);
                            break;
                        case 'ne': // Northeast corner
                            newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, e.clientX - rect.left));
                            newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, rect.bottom - e.clientY));
                            newY = Math.max(0, e.clientY);
                            break;
                        case 'nw': // Northwest corner
                            newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, rect.right - e.clientX));
                            newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, rect.bottom - e.clientY));
                            newX = Math.max(0, e.clientX);
                            newY = Math.max(0, e.clientY);
                            break;
                        case 'e': // East edge
                            newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, e.clientX - rect.left));
                            break;
                        case 'w': // West edge
                            newWidth = Math.max(windowState.minWidth, Math.min(windowState.maxWidth, rect.right - e.clientX));
                            newX = Math.max(0, e.clientX);
                            break;
                        case 's': // South edge
                            newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, e.clientY - rect.top));
                            break;
                        case 'n': // North edge
                            newHeight = Math.max(windowState.minHeight, Math.min(windowState.maxHeight, rect.bottom - e.clientY));
                            newY = Math.max(0, e.clientY);
                            break;
                    }
                    
                    // Ensure window doesn't go off-screen
                    const constrained = constrainToBounds(newX, newY, newWidth, newHeight);
                    
                    // Apply the new dimensions and position
                    overlayContainer.style.width = newWidth + 'px';
                    overlayContainer.style.height = newHeight + 'px';
                    overlayContainer.style.left = constrained.x + 'px';
                    overlayContainer.style.top = constrained.y + 'px';
                    overlayContainer.style.right = 'auto';
                    
                    // Update window state
                    windowState.width = newWidth;
                    windowState.height = newHeight;
                    windowState.x = constrained.x;
                    windowState.y = constrained.y;
                }
            }, 'Document mousemove');
        });

        // Add resize handle event listeners with error handling
        overlayContainer.querySelectorAll('.resize-handle').forEach(handle => {
            addTrackedEventListener(handle, 'mousedown', (e) => {
                safeExecute(() => {
                    isResizing = true;
                    resizeHandle = e.target;
                    e.preventDefault();
                    e.stopPropagation();
                }, 'Resize handle mousedown');
            });
        });

        addTrackedEventListener(document, 'mouseup', () => {
            safeExecute(() => {
                if (isDragging) {
                    isDragging = false;
                    const header = overlayContainer.querySelector('.vfx-window-header');
                    if (header) header.style.cursor = 'grab';
                }
                if (isResizing) {
                    isResizing = false;
                    resizeHandle = null;
                }
            }, 'Document mouseup');
        }); // Mode Switcher - Updated to match reference
        modeSwitcherContainer.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newMode = e.currentTarget.dataset.mode;
                handleModeChange(newMode);
                modeSwitcherContainer.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('bg-purple-600', 'text-white'));
                modeSwitcherContainer.querySelectorAll('.mode-btn').forEach(b => b.classList.add('text-gray-300'));
                e.currentTarget.classList.add('bg-purple-600', 'text-white');
                e.currentTarget.classList.remove('text-gray-300');

                // Update background colors to match reference
                if (newMode === 'generator') {
                    modeSwitcherContainer.querySelector('.mode-btn[data-mode="generator"]').style.backgroundColor = '#7C3AED';
                    modeSwitcherContainer.querySelector('.mode-btn[data-mode="sceneExtender"]').style.backgroundColor = '#374151';
                } else {
                    modeSwitcherContainer.querySelector('.mode-btn[data-mode="generator"]').style.backgroundColor = '#374151';
                    modeSwitcherContainer.querySelector('.mode-btn[data-mode="sceneExtender"]').style.backgroundColor = '#7C3AED';
                }

                const notice = overlayContainer.querySelector('#vfx-scene-extender-notice');
                if (notice) notice.style.display = newMode === 'sceneExtender' ? 'block' : 'none';
            });
        });
        // Initialize active button for mode switcher - Updated to match reference
        const initialModeBtn = modeSwitcherContainer.querySelector(`.mode-btn[data-mode="${state.activeMode}"]`);
        if (initialModeBtn) {
            initialModeBtn.classList.add('bg-purple-600', 'text-white');
            initialModeBtn.classList.remove('text-gray-300');

            // Ensure the Generator button is styled correctly on initial load
            if (state.activeMode === 'generator') {
                modeSwitcherContainer.querySelector('.mode-btn[data-mode="generator"]').style.backgroundColor = '#7C3AED';
                modeSwitcherContainer.querySelector('.mode-btn[data-mode="sceneExtender"]').style.backgroundColor = '#374151';
            } else {
                modeSwitcherContainer.querySelector('.mode-btn[data-mode="generator"]').style.backgroundColor = '#374151';
                modeSwitcherContainer.querySelector('.mode-btn[data-mode="sceneExtender"]').style.backgroundColor = '#7C3AED';
            }
        }


        // Main prompt textarea
        mainTextarea.addEventListener('input', (e) => handleParamChange({ description: e.target.value }));
        mainTextarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!generateButton.disabled) handleSubmitPrompt();
            }
        });

        // Buttons
        generateButton.addEventListener('click', handleSubmitPrompt);
        clearPromptButton.addEventListener('click', handleClearPrompt);
        uploadImageButton.addEventListener('click', () => fileInputRef.click());
        fileInputRef.addEventListener('change', (e) => { if (e.target.files && e.target.files[0]) handleImageUpload(e.target.files[0]); });

        // Footer select inputs
        footerNumPromptsSelect.addEventListener('change', (e) => handleParamChange({ numberOfPrompts: parseInt(e.target.value, 10) }));
        footerStyleSelect.addEventListener('change', (e) => handleParamChange({ style: e.target.value }));
        
        // Audio toggle with error handling
        if (footerAudioToggle) {
            const audioToggleButton = footerAudioToggle.querySelector('button');
            if (audioToggleButton) {
                audioToggleButton.addEventListener('click', () => {
                    safeExecute(() => {
                        const newState = !state.promptParams.enableAudioPrompting;
                        console.log(`[VideoFX Artisan] Audio prompting toggled: ${newState}`);
                        handleParamChange({ enableAudioPrompting: newState });
                    }, 'Audio toggle click');
                });
            } else {
                console.error('[VideoFX Artisan] Audio toggle button not found');
            }
        } else {
            console.error('[VideoFX Artisan] Audio toggle container not found');
        }

        // Footer action buttons
        footerAdvancedSettingsButton.addEventListener('click', () => openModal('advancedSettings'));
        footerResetAllButton.addEventListener('click', handleResetAllFields);
        footerSurpriseMeButton.addEventListener('click', handleSurpriseMe);
        overlayContainer.querySelector('#vfx-surprise-me-welcome').addEventListener('click', handleSurpriseMe); // Welcome screen surprise me
        footerThemeExplorerButton.addEventListener('click', () => openModal('themeExplorer'));
        footerCharGenButton.addEventListener('click', () => openModal('characterGen'));
        footerStoryboardButton.addEventListener('click', () => openModal('storyboard'));

        // Inspiration cards
        overlayContainer.querySelectorAll('.inspiration-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.dataset.inspirationIndex, 10);
                handleInspirationSelect(INSPIRATION_PROMPTS[index]);
            });
        });

        // Modal self-close on backdrop click
        generalModalContainer.addEventListener('click', (e) => {
            if (e.target === generalModalContainer) { // Check if the click was directly on the backdrop
                closeModal();
            }
        });
        // Prevent modal content click from closing modal
        generalModalContainer.addEventListener('click', (e) => {
             if (e.target !== generalModalContainer) {
                 e.stopPropagation();
             }
        });
    }
    // --- END: Event Listener Attachment ---


 // --- START: Main Initialization Function ---
    function init() {
        console.log(`${OVERLAY_TITLE} Helper Script v${SCRIPT_VERSION} initializing...`);
        
        // Load saved window state
        windowState = loadWindowState();
        
        createOverlayUI();
        createToggleButton(); // Creates the button to show/hide the overlay
        attachCoreEventListeners();
        
        // Add window resize listener for responsive behavior
        addTrackedEventListener(window, 'resize', debouncedWindowResize);
        
        // Add beforeunload listener to save state
        addTrackedEventListener(window, 'beforeunload', saveWindowState);
        
        renderApp(); // Initial render
        // Overlay starts hidden, toggle button will show it.
        if (overlayContainer) overlayContainer.style.display = 'none';
        if (generalModalContainer) generalModalContainer.style.display = 'none';

        // MOVED GM_addStyle CALLS INSIDE THE IIFE, specifically at the end of init()
          // --- CSS Styles (GM_addStyle) ---
        GM_addStyle(`
            #${OVERLAY_ID} {
                font-family: 'Google Sans Text', 'Google Sans', 'Space Grotesk', sans-serif;
                background-color: #121212;
                color: hsl(200, 12%, 95.1%);
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                overflow: hidden;
            }
            #${OVERLAY_ID} .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
            #${OVERLAY_ID} .custom-scrollbar::-webkit-scrollbar-track { background: hsla(0, 0%, 100%, 0.05); border-radius:4px; }
            #${OVERLAY_ID} .custom-scrollbar::-webkit-scrollbar-thumb { background: hsla(0, 0%, 100%, 0.2); border-radius: 4px; }
            #${OVERLAY_ID} .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: hsla(0, 0%, 100%, 0.3); }
            #${OVERLAY_ID} @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            #${OVERLAY_ID} .animate-fadeIn { animation: fadeIn 0.3s ease-out forwards; }
            #${OVERLAY_ID} @keyframes popIn { 0% { opacity: 0; transform: scale(0.95) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
            #${OVERLAY_ID} .animate-popIn { animation: popIn 0.3s ease-out forwards; }
            #${OVERLAY_ID} @keyframes slideDown { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            #${OVERLAY_ID} .animate-slideDown { animation: slideDown 0.3s ease-out forwards; }
            #${OVERLAY_ID} @keyframes bounceIn { 0% { opacity: 0; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1.05); } 100% { transform: scale(1); } }
            #${OVERLAY_ID} .animate-bounceIn { animation: bounceIn 0.4s ease-out forwards; }
            @media (prefers-reduced-motion: reduce) {
                #${OVERLAY_ID} .animate-slideDown,
                #${OVERLAY_ID} .animate-bounceIn,
                #${OVERLAY_ID} .animate-fadeIn,
                #${OVERLAY_ID} .animate-popIn,
                #${OVERLAY_ID} .animate-spin {
                    animation: none !important;
                }
            }

            #${OVERLAY_ID} .vpa-text-main { color: hsl(200, 12%, 95.1%); }
            #${OVERLAY_ID} .vpa-text-subdued { color: hsla(0, 0%, 100%, 0.75); }
            #${OVERLAY_ID} .vpa-text-faint { color: hsla(0, 0%, 100%, 0.55); }
            #${OVERLAY_ID} .hover\\:vpa-text-main:hover { color: hsl(200, 12%, 95.1%); }

            #${OVERLAY_ID} .studio-bg-base { background-color: #0f0f0f; }
            #${OVERLAY_ID} .studio-bg-card-nested { background-color: #1a1a1a; }
            #${OVERLAY_ID} .studio-bg-elevated { background-color: #1a1a1a; }
            #${OVERLAY_ID} .studio-bg-elevated-hover:hover { background-color: #2a2a2a; }
            #${OVERLAY_ID} .studio-border-soft { border-color: #333333; }
            #${OVERLAY_ID} .studio-border-strong { border-color: #444444; }

            #${OVERLAY_ID} .studio-icon-button { background-color: transparent; color: hsla(0, 0%, 100%, 0.75); border-radius: 9999px; padding: 0.625rem; transition: all 0.15s ease-in-out; display: inline-flex; align-items: center; justify-content: center; }
            #${OVERLAY_ID} .studio-icon-button:hover { background-color: hsla(0, 0%, 100%, 0.1); color: hsl(200, 12%, 95.1%); }
            #${OVERLAY_ID} .studio-icon-button:focus-visible { outline: 2px solid #7C3AED; outline-offset: 2px; }
            #${OVERLAY_ID} .studio-icon-button:disabled { opacity: 0.5; cursor: not-allowed; }

            #${OVERLAY_ID} .studio-button-primary { background-color: #7C3AED; color: #FFFFFF; padding: 0.625rem 1.25rem; border-radius: 0.5rem; font-weight: 500; }
            #${OVERLAY_ID} .studio-button-primary:hover { background-color: #6D28D9; }
            #${OVERLAY_ID} .studio-button-primary:disabled { background-color: #553c7b; opacity: 0.6; cursor: not-allowed; }

            #${OVERLAY_ID} .studio-button-secondary { background-color: hsla(0, 0%, 100%, 0.08); color: hsl(200, 12%, 95.1%); border: 1px solid hsla(0, 0%, 100%, 0.15); padding: 0.5rem 1rem; border-radius: 0.375rem; font-weight: 500;}
            #${OVERLAY_ID} .studio-button-secondary:hover { background-color: hsla(0, 0%, 100%, 0.12); border-color: hsla(0, 0%, 100%, 0.25); }
            #${OVERLAY_ID} .studio-button-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

            #${OVERLAY_ID} .studio-input-base { background-color: #111827; border: 1px solid #374151; color: hsl(200, 12%, 95.1%); border-radius: 0.375rem; padding: 0.625rem; width: 100%; }
            #${OVERLAY_ID} .studio-input-base:focus { border-color: #7C3AED; outline: none; box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.3); }

            #${OVERLAY_ID} select.studio-input-base { appearance: none; -webkit-appearance: none; -moz-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%239CA3AF' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 0.5rem center; background-size: 1.25em; padding-right: 2.5rem; }
            #${OVERLAY_ID} select.studio-input-base option { background-color: #2d3748; color: hsl(200, 12%, 95.1%); }

            #${OVERLAY_ID} .material-symbols-rounded.material-symbols-filled,
            #${OVERLAY_ID} .material-symbols-outlined.material-symbols-filled,
            #${OVERLAY_ID} .material-icons.material-symbols-filled {
                font-variation-settings: 'FILL' 1;
            }
            /* Tailwind-like utility classes (subset) - FIXED typos from # OVERLAY_ID} to #${OVERLAY_ID} */
            #${OVERLAY_ID} .fixed { position: fixed; } #${OVERLAY_ID} .inset-0 { top: 0; right: 0; bottom: 0; left: 0; }
            #${OVERLAY_ID} .z-\\[9999\\] { z-index: 9999; } #${OVERLAY_ID} .z-\\[10000\\] { z-index: 10000; }
            #${OVERLAY_ID} .flex { display: flex; } #${OVERLAY_ID} .flex-col { flex-direction: column; }
            #${OVERLAY_ID} .items-center { align-items: center; } #${OVERLAY_ID} .justify-center { justify-content: center; }
            #${OVERLAY_ID} .overflow-hidden { overflow: hidden; } #${OVERLAY_ID} .sticky { position: sticky; }
            #${OVERLAY_ID} .top-0 { top: 0; } #${OVERLAY_ID} .bottom-0 { bottom: 0; }
            #${OVERLAY_ID} .w-full { width: 100%; } #${OVERLAY_ID} .h-12 { height: 3rem; } #${OVERLAY_ID} .h-6 { height: 1.5rem; } #${OVERLAY_ID} .w-6 { width: 1.5rem; }
            #${OVERLAY_ID} .h-5 { height: 1.25rem; } #${OVERLAY_ID} .w-5 { width: 1.25rem; } #${OVERLAY_ID} .h-4 { height: 1rem; } #${OVERLAY_ID} .w-4 { width: 1rem; }
            #${OVERLAY_ID} .p-1 { padding: 0.25rem; } #${OVERLAY_ID} .p-1\\.5 { padding: 0.375rem; } #${OVERLAY_ID} .p-2 { padding: 0.5rem; } #${OVERLAY_ID} .p-3 { padding: 0.75rem; } #${OVERLAY_ID} .p-4 { padding: 1rem; }
            #${OVERLAY_ID} .px-4 { padding-left: 1rem; padding-right: 1rem; } #${OVERLAY_ID} .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
            #${OVERLAY_ID} .sm\\:px-6 { } @media (min-width: 640px) { #${OVERLAY_ID} .sm\\:px-6 { padding-left: 1.5rem; padding-right: 1.5rem; } }
            #${OVERLAY_ID} .md\\:px-8 { } @media (min-width: 768px) { #${OVERLAY_ID} .md\\:px-8 { padding-left: 2rem; padding-right: 2rem; } }
            #${OVERLAY_ID} .pt-4 { padding-top: 1rem; } #${OVERLAY_ID} .sm\\:pt-2 { } @media (min-width: 640px) { #${OVERLAY_ID} .sm\\:pt-2 { padding-top: 0.5rem; } }
            #${OVERLAY_ID} .md\\:pt-4 { } @media (min-width: 768px) { #${OVERLAY_ID} .md\\:pt-4 { padding-top: 1rem; } }
            #${OVERLAY_ID} .max-w-7xl { max-width: 80rem; } #${OVERLAY_ID} .max-w-4xl { max-width: 56rem; } #${OVERLAY_ID} .max-w-3xl { max-width: 48rem; }
            #${OVERLAY_ID} .max-w-2xl { max-width: 42rem; } #${OVERLAY_ID} .max-w-lg { max-width: 32rem; } #${OVERLAY_ID} .max-w-md { max-width: 28rem; }
            #${OVERLAY_ID} .mx-auto { margin-left: auto; margin-right: auto; }
            #${OVERLAY_ID} .space-x-1 > :not([hidden]) ~ :not([hidden]) { margin-left: calc(0.25rem * calc(1 - 0)); margin-right: calc(0.25rem * 0); }
            #${OVERLAY_ID} .space-x-2 > :not([hidden]) ~ :not([hidden]) { margin-left: calc(0.5rem * calc(1 - 0)); margin-right: calc(0.5rem * 0); }
            #${OVERLAY_ID} .sm\\:space-x-2 > :not([hidden]) ~ :not([hidden]) { } @media (min-width: 640px) { #${OVERLAY_ID} .sm\\:space-x-2 > :not([hidden]) ~ :not([hidden]) { margin-left: calc(0.5rem * calc(1 - 0)); margin-right: calc(0.5rem * 0); } }
            #${OVERLAY_ID} .space-x-3 > :not([hidden]) ~ :not([hidden]) { margin-left: calc(0.75rem * calc(1 - 0)); margin-right: calc(0.75rem * 0); }
            #${OVERLAY_ID} .space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: calc(0.75rem * calc(1 - 0)); margin-bottom: calc(0.75rem * 0); }
            #${OVERLAY_ID} .space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: calc(1rem * calc(1 - 0)); margin-bottom: calc(1rem * 0); }
            #${OVERLAY_ID} .space-y-6 > :not([hidden]) ~ :not([hidden]) { margin-top: calc(1.5rem * calc(1 - 0)); margin-bottom: calc(1.5rem * 0); }
            #${OVERLAY_ID} .space-y-12 > :not([hidden]) ~ :not([hidden]) { margin-top: calc(3rem * calc(1 - 0)); margin-bottom: calc(3rem * 0); }
            #${OVERLAY_ID} .border-b { border-bottom-width: 1px; } #${OVERLAY_ID} .border-t { border-top-width: 1px; } #${OVERLAY_ID} .border { border-width: 1px; }
            #${OVERLAY_ID} .rounded-lg { border-radius: 0.5rem; } #${OVERLAY_ID} .rounded-xl { border-radius: 0.75rem; } #${OVERLAY_ID} .rounded-md { border-radius: 0.375rem; } #${OVERLAY_ID} .rounded-full { border-radius: 9999px; } #${OVERLAY_ID} .rounded { border-radius: 0.25rem; }
            #${OVERLAY_ID} .shadow-md { box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); }
            #${OVERLAY_ID} .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); }
            #${OVERLAY_ID} .shadow-xl { box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); }
            #${OVERLAY_ID} .shadow-inner { box-shadow: inset 0 2px 4px 0 rgba(0,0,0,0.06); }
            #${OVERLAY_ID} .text-lg { font-size: 1.125rem; line-height: 1.75rem; } #${OVERLAY_ID} .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
            #${OVERLAY_ID} .text-xs { font-size: 0.75rem; line-height: 1rem; } #${OVERLAY_ID} .text-base { font-size: 1rem; line-height: 1.5rem; }
            #${OVERLAY_ID} .text-3xl { font-size: 1.875rem; line-height: 2.25rem; } #${OVERLAY_ID} .text-xl { font-size: 1.25rem; line-height: 1.75rem; }
            #${OVERLAY_ID} .font-medium { font-weight: 500; } #${OVERLAY_ID} .font-semibold { font-weight: 600; } #${OVERLAY_ID} .font-normal { font-weight: 400; }
            #${OVERLAY_ID} .hidden { display: none; } #${OVERLAY_ID} .sm\\:block { } @media (min-width: 640px) { #${OVERLAY_ID} .sm\\:block { display: block; } }
            #${OVERLAY_ID} .sm\\:inline { } @media (min-width: 640px) { #${OVERLAY_ID} .sm\\:inline { display: inline; } }
            #${OVERLAY_ID} .sm\\:inline-flex { } @media (min-width: 640px) { #${OVERLAY_ID} .sm\\:inline-flex { display: inline-flex; } }
            #${OVERLAY_ID} .opacity-90 { opacity: 0.9; } #${OVERLAY_ID} .opacity-75 { opacity: 0.75; }
            #${OVERLAY_ID} .text-purple-500 { color: #8B5CF6; } #${OVERLAY_ID} .text-purple-400 { color: #A78BFA; } #${OVERLAY_ID} .text-purple-300 { color: #C4B5FD; }
            #${OVERLAY_ID} .text-yellow-400 { color: #FACC15; } #${OVERLAY_ID} .text-green-400 { color: #4ADE80; }
            #${OVERLAY_ID} .text-red-100 { color: #FEE2E2; } #${OVERLAY_ID} .text-red-200 { color: #FECACA; }
            #${OVERLAY_ID} .bg-slate-700 { background-color: #334155; } #${OVERLAY_ID} .hover\\:bg-slate-600:hover { background-color: #475569; }
            #${OVERLAY_ID} .text-slate-300 { color: #CBD5E1; } #${OVERLAY_ID} .hover\\:text-white:hover { color: #FFFFFF; }
            #${OVERLAY_ID} .bg-purple-600 { background-color: #7C3AED; } #${OVERLAY_ID} .hover\\:bg-purple-700:hover { background-color: #6D28D9; }
            #${OVERLAY_ID} .border-purple-600 { border-color: #7C3AED; }
            #${OVERLAY_ID} .text-white { color: #FFFFFF; } #${OVERLAY_ID} .bg-black { background-color: #000000; }
            #${OVERLAY_ID} .bg-opacity-50 { background-color: rgba(0,0,0,0.5); } #${OVERLAY_ID} .bg-opacity-80 { background-color: rgba(0,0,0,0.8); }
            #${OVERLAY_ID} .backdrop-blur-md { backdrop-filter: blur(12px); } #${OVERLAY_ID} .backdrop-blur-sm { backdrop-filter: blur(4px); }
            #${OVERLAY_ID} .flex-1 { flex: 1 1 0%; } #${OVERLAY_ID} .flex-grow { flex-grow: 1; } #${OVERLAY_ID} .shrink-0 { flex-shrink: 0; }
            #${OVERLAY_ID} .focus\\:outline-none:focus { outline: 2px solid transparent; outline-offset: 2px; }
            #${OVERLAY_ID} .focus\\:ring-2:focus { --tw-ring-offset-shadow: var(--tw-ring-inset) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); --tw-ring-shadow: var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color); box-shadow: var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow, 0 0 #0000); }
            #${OVERLAY_ID} .focus\\:ring-purple-500:focus { --tw-ring-color: #8B5CF6; }
            #${OVERLAY_ID} .focus\\:ring-opacity-75:focus { --tw-ring-opacity: 0.75; }
            #${OVERLAY_ID} .focus\\:ring-offset-2:focus { --tw-ring-offset-width: 2px; }
            #${OVERLAY_ID} .focus\\:ring-offset-gray-800:focus { --tw-ring-offset-color: #1F2937; }
            #${OVERLAY_ID} .focus\\:ring-offset-black:focus { --tw-ring-offset-color: #000000; }
            #${OVERLAY_ID} .focus\\:border-purple-500:focus { border-color: #8B5CF6; }
            #${OVERLAY_ID} .transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
            #${OVERLAY_ID} .transition-colors { transition-property: background-color, border-color, color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
            #${OVERLAY_ID} .transition-transform { transition-property: transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
            #${OVERLAY_ID} .duration-150 { transition-duration: 150ms; } #${OVERLAY_ID} .duration-200 { transition-duration: 200ms; }
            #${OVERLAY_ID} .ease-in-out { transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
            #${OVERLAY_ID} .transform { transform: translateX(0) translateY(0) rotate(0) skewX(0) skewY(0) scaleX(1) scaleY(1); }
            #${OVERLAY_ID} .hover\\:scale-105:hover { --tw-scale-x: 1.05; --tw-scale-y: 1.05; transform: translateX(0) translateY(0) rotate(0) skewX(0) skewY(0) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }
            #${OVERLAY_ID} .hover\\:-translate-y-1:hover { --tw-translate-y: -0.25rem; transform: translateX(0) translateY(var(--tw-translate-y)) rotate(0) skewX(0) skewY(0) scaleX(1) scaleY(1); }
            #${OVERLAY_ID} .translate-x-6 { --tw-translate-x: 1.5rem; transform: translateX(var(--tw-translate-x)) translateY(0) rotate(0) skewX(0) skewY(0) scaleX(1) scaleY(1); }
            #${OVERLAY_ID} .translate-x-1 { --tw-translate-x: 0.25rem; transform: translateX(var(--tw-translate-x)) translateY(0) rotate(0) skewX(0) skewY(0) scaleX(1) scaleY(1); }
            #${OVERLAY_ID} .group:hover .group-hover\\:translate-x-1 { --tw-translate-x: 0.25rem; transform: translateX(var(--tw-translate-x)) translateY(0) rotate(0) skewX(0) skewY(0) scaleX(1) scaleY(1); }
            #${OVERLAY_ID} .absolute { position: absolute; } #${OVERLAY_ID} .relative { position: relative; }
            #${OVERLAY_ID} .right-2\\.5 { right: 0.625rem; } #${OVERLAY_ID} .top-1\\/2 { top: 50%; }
            #${OVERLAY_ID} .-translate-y-1\\/2 { --tw-translate-y: -50%; transform: translateX(0) translateY(var(--tw-translate-y)) rotate(0) skewX(0) skewY(0) scaleX(1) scaleY(1); }
            #${OVERLAY_ID} .text-center { text-align: center; } #${OVERLAY_ID} .text-left { text-align: left; }
            #${OVERLAY_ID} .leading-tight { line-height: 1.25; } #${OVERLAY_ID} .leading-relaxed { line-height: 1.625; }
            #${OVERLAY_ID} .resize-none { resize: none; } #${OVERLAY_ID} .resize-y { resize: vertical; }
            #${OVERLAY_ID} .overflow-y-auto { overflow-y: auto; }
            #${OVERLAY_ID} .object-cover { object-fit: cover; } #${OVERLAY_ID} .object-contain { object-fit: contain; }
            #${OVERLAY_ID} .mr-3 { margin-right: 0.75rem; } #${OVERLAY_ID} .ml-2 { margin-left: 0.5rem; } #${OVERLAY_ID} .mr-2 { margin-right: 0.5rem; }
            #${OVERLAY_ID} .mr-2\\.5 { margin-right: 0.625rem; }
            #${OVERLAY_ID} .mb-1 { margin-bottom: 0.25rem; } #${OVERLAY_ID} .mb-2 { margin-bottom: 0.5rem; } #${OVERLAY_ID} .mb-3 { margin-bottom: 0.75rem; }
            #${OVERLAY_ID} .mb-4 { margin-bottom: 1rem; } #${OVERLAY_ID} .mb-5 { margin-bottom: 1.25rem; } #${OVERLAY_ID} .mb-6 { margin-bottom: 1.5rem; } #${OVERLAY_ID} .mb-8 { margin-bottom: 2rem; }
            #${OVERLAY_ID} .mt-2 { margin-top: 0.5rem; } #${OVERLAY_ID} .mt-3 { margin-top: 0.75rem; } #${OVERLAY_ID} .mt-4 { margin-top: 1rem; }
            #${OVERLAY_ID} .md\\:col-span-2 { } @media (min-width: 768px) { #${OVERLAY_ID} .md\\:col-span-2 { grid-column: span 2 / span 2; } }
            #${OVERLAY_ID} .lg\\:col-span-1 { } @media (min-width: 1024px) { #${OVERLAY_ID} .lg\\:col-span-1 { grid-column: span 1 / span 1; } }
            #${OVERLAY_ID} .lg\\:col-span-3 { } @media (min-width: 1024px) { #${OVERLAY_ID} .lg\\:col-span-3 { grid-column: span 3 / span 3; } }
            #${OVERLAY_ID} .md\\:col-start-1 { } @media (min-width: 768px) { #${OVERLAY_ID} .md\\:col-start-1 { grid-column-start: 1; } }
            #${OVERLAY_ID} .lg\\:col-start-1 { } @media (min-width: 1024px) { #${OVERLAY_ID} .lg\\:col-start-1 { grid-column-start: 1; } }
            #${OVERLAY_ID} .grid { display: grid; } #${OVERLAY_ID} .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
            #${OVERLAY_ID} .md\\:grid-cols-2 { } @media (min-width: 768px) { #${OVERLAY_ID} .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
            #${OVERLAY_ID} .lg\\:grid-cols-3 { } @media (min-width: 1024px) { #${OVERLAY_ID} .lg\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
            #${OVERLAY_ID} .gap-4 { gap: 1rem; } #${OVERLAY_ID} .gap-x-4 { column-gap: 1rem; } #${OVERLAY_ID} .gap-y-3 { row-gap: 0.75rem; }
            #${OVERLAY_ID} .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
            #${OVERLAY_ID} .md\\:pt-0 { } @media (min-width: 768px) { #${OVERLAY_ID} .md\\:pt-0 { padding-top: 0px; } }
            #${OVERLAY_ID} .justify-end { justify-content: flex-end; }
            #${OVERLAY_ID} .self-start { align-self: flex-start; }
            #${OVERLAY_ID} .line-clamp-3 { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
            #${OVERLAY_ID} .break-words { overflow-wrap: break-word; } #${OVERLAY_ID} .whitespace-pre-wrap { white-space: pre-wrap; }
            #${OVERLAY_ID} .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            #${OVERLAY_ID} .cursor-pointer { cursor: pointer; } #${OVERLAY_ID} .cursor-help { cursor: help; } #${OVERLAY_ID} .cursor-not-allowed { cursor: not-allowed; }
            #${OVERLAY_ID} .select-none { user-select: none; }
            #${OVERLAY_ID} .max-h-\\[90vh\\] { max-height: 90vh; } #${OVERLAY_ID} .max-h-\\[60vh\\] { max-height: 60vh; } #${OVERLAY_ID} .max-h-\\[50vh\\] { max-height: 50vh; } #${OVERLAY_ID} .max-h-40 { max-height: 10rem; } #${OVERLAY_ID} .max-h-32 { max-height: 8rem; }
            #${OVERLAY_ID} .pr-2 { padding-right: 0.5rem; }
            #${OVERLAY_ID} .list-disc { list-style-type: disc; } #${OVERLAY_ID} .list-inside { list-style-position: inside; } #${OVERLAY_ID} .pl-1 { padding-left: 0.25rem; } #${OVERLAY_ID} .pl-2 { padding-left: 0.5rem; }
            #${OVERLAY_ID} .hover\\:bg-orange-600:hover { background-color: #EA580C; }
            #${OVERLAY_ID} .hover\\:bg-sky-600:hover { background-color: #0284C7; }
            #${OVERLAY_ID} .hover\\:bg-pink-600:hover { background-color: #DB2777; }
            #${OVERLAY_ID} .hover\\:bg-lime-600:hover { background-color: #65A30D; }
            #${OVERLAY_ID} .hover\\:bg-teal-600:hover { background-color: #0D9488; }
            #${OVERLAY_ID} .hover\\:bg-blue-600:hover { background-color: #2563EB; }
            #${OVERLAY_ID} .hover\\:bg-green-500:hover { background-color: #22C55E; }
            #${OVERLAY_ID} .hover\\:bg-red-500:hover { background-color: #EF4444; }
            #${OVERLAY_ID} .hover\\:bg-green-700:hover { background-color: #15803D; }
            #${OVERLAY_ID} .hover\\:border-green-600:hover { border-color: #16A34A; }
            #${OVERLAY_ID} .hover\\:border-purple-600:hover { border-color: #7C3AED; }
            #${OVERLAY_ID} .bg-green-600 { background-color: #16A34A; }
            #${OVERLAY_ID} .bg-red-600 { background-color: #DC2626; }
            #${OVERLAY_ID} .bg-red-700 { background-color: #B91C1C; }
            #${OVERLAY_ID} .bg-opacity-20 { background-color: rgba(var(--tw-bg-opacity-base,0),var(--tw-bg-opacity-base,0),var(--tw-bg-opacity-base,0),0.2); } /* Needs color vars for actual color */
            #${OVERLAY_ID} .bg-red-700.bg-opacity-20 { background-color: rgba(185,28,28,0.2); } /* Specific example */
            #${OVERLAY_ID} .bg-blue-700.bg-opacity-20 { background-color: rgba(29,78,216,0.2); }
            #${OVERLAY_ID} .text-red-200 { color: #FECACA; }
            #${OVERLAY_ID} .text-blue-200 { color: #BFDBFE; }
            #${OVERLAY_ID} .border-red-600 { border-color: #DC2626; }
            #${OVERLAY_ID} .hover\\:bg-purple-500\\/10:hover { background-color: rgba(168, 85, 247, 0.1); }
            #${OVERLAY_ID} .italic { font-style: italic; }
            #${OVERLAY_ID} .animate-spin { animation: spin 1s linear infinite; }
            #${OVERLAY_ID} @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

           /* Info Tooltip Specific styling (can be enhanced) */
            #${OVERLAY_ID} .info-tooltip-trigger { display: inline-flex; }
            #${TOGGLE_BUTTON_ID} {
              position: fixed;
              bottom: 20px;
              right: 20px;
              z-index: 99999; /* Ensure it's above other page content and the overlay */
              padding: 0.75rem;
              background-color: #1F2937; /* studio-bg-elevated or similar dark */
              border: 1px solid #7C3AED; /* studio-border-strong with accent */
              border-radius: 9999px; /* full */
              box-shadow: 0 4px 12px rgba(0,0,0,0.4);
              cursor: pointer;
              transition: background-color 0.2s ease-in-out, transform 0.2s ease-in-out;
            }
            #${TOGGLE_BUTTON_ID}:hover {
              background-color: #374151; /* Slightly lighter dark */
              transform: scale(1.1);
            }
            #${TOGGLE_BUTTON_ID} > svg { /* If icon is SVG */
                width: 1.75rem; height: 1.75rem; fill: #A78BFA; /* text-purple-400 */
            }
            #${TOGGLE_BUTTON_ID} > span { /* If icon is span */
                font-size: 1.75rem; color: #A78BFA;
            }
        `);
        // Font imports
        GM_addStyle("@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Google+Sans+Text:wght@400;500;700&family=Google+Sans:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap');");
        GM_addStyle("@import url('https://fonts.googleapis.com/icon?family=Material+Icons|Material+Icons+Outlined|Material+Icons+Round|Material+Icons+Sharp|Material+Icons+Two+Tone');");
        GM_addStyle("@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');");
        GM_addStyle("@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200');");
        
        // Additional fixes for text color and alignment
        GM_addStyle(`
            /* Fix text color in input fields */
            .vfx-floating-window input,
            .vfx-floating-window textarea,
            .vfx-floating-window select {
                color: #ffffff !important;
                background-color: rgba(255, 255, 255, 0.1) !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
            }
            
            .vfx-floating-window input::placeholder,
            .vfx-floating-window textarea::placeholder {
                color: rgba(255, 255, 255, 0.6) !important;
            }
            
            /* Remove any blur effects */
            .vfx-floating-window {
                backdrop-filter: none !important;
                filter: none !important;
                pointer-events: auto !important;
            }
            
            /* Ensure all interactive elements are clickable */
            .vfx-floating-window button,
            .vfx-floating-window input,
            .vfx-floating-window textarea,
            .vfx-floating-window select,
            .vfx-floating-window a {
                pointer-events: auto !important;
                cursor: pointer !important;
            }
            
            /* Fix icon sizes to match reference */
            .vfx-floating-window .w-12 {
                width: 3rem !important;
                height: 3rem !important;
            }
            
            .vfx-floating-window .h-12 {
                height: 3rem !important;
            }
            
            /* Improve layout alignment */
            .vfx-floating-window .flex {
                display: flex !important;
            }
            
            .vfx-floating-window .items-center {
                align-items: center !important;
            }
            
            .vfx-floating-window .justify-center {
                justify-content: center !important;
            }
            
            /* Fix button text colors */
            .vfx-floating-window button {
                color: inherit !important;
            }
            
            /* Fix select dropdown text */
            .vfx-floating-window select option {
                background-color: #1f2937 !important;
                color: #ffffff !important;
            }
            
            /* Ensure clean, sharp appearance */
            .vfx-floating-window * {
                filter: none !important;
                backdrop-filter: none !important;
                pointer-events: auto !important;
            }
            
            /* Make sure the window content is interactive */
            .vfx-floating-window .vfx-window-content {
                pointer-events: auto !important;
            }
            
            /* Ensure buttons are properly styled and clickable */
            .vfx-floating-window button:hover {
                opacity: 0.8 !important;
            }
            
            /* Prevent any unwanted overlays */
            .vfx-floating-window #vfx-general-modal-container {
                background: none !important;
                backdrop-filter: none !important;
                pointer-events: none !important;
            }
            
            /* Ensure modal content is clickable when shown */
            .vfx-floating-window #vfx-general-modal-container > * {
                pointer-events: auto !important;
            }
            
            /* Fix audio toggle visibility and styling */
            .vfx-floating-window #footer-audio-toggle {
                display: flex !important;
                align-items: center !important;
                visibility: visible !important;
            }
            
            .vfx-floating-window #vfx-enable-audio-toggle {
                display: inline-flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                background-color: #4B5563 !important; /* Default gray background */
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
                width: 44px !important;
                height: 24px !important;
                border-radius: 12px !important;
                position: relative !important;
                transition: background-color 0.2s ease !important;
            }
            
            .vfx-floating-window #vfx-enable-audio-toggle.bg-purple-600 {
                background-color: #9333EA !important; /* Purple when enabled */
            }
            
            .vfx-floating-window #vfx-enable-audio-toggle.bg-gray-600 {
                background-color: #4B5563 !important; /* Gray when disabled */
            }
            
            .vfx-floating-window #vfx-enable-audio-toggle span {
                display: block !important;
                width: 16px !important;
                height: 16px !important;
                background-color: #FFFFFF !important;
                border-radius: 50% !important;
                transition: transform 0.2s ease !important;
                position: absolute !important;
                top: 3px !important;
                left: 4px !important;
            }
            
            .vfx-floating-window #vfx-enable-audio-toggle span.translate-x-6 {
                transform: translateX(20px) !important;
            }
            
            .vfx-floating-window #vfx-enable-audio-toggle span.translate-x-1 {
                transform: translateX(0px) !important;
            }
            
            .vfx-floating-window #footer-audio-toggle label {
                color: rgba(255, 255, 255, 0.8) !important;
                display: inline !important;
                visibility: visible !important;
            }
            
            /* Improved scrolling and content layout */
            .vfx-floating-window main {
                overflow-y: auto !important;
                max-height: calc(100% - 120px) !important; /* Account for header and footer */
                scrollbar-width: thin !important;
                scrollbar-color: rgba(255, 255, 255, 0.2) rgba(0, 0, 0, 0.2) !important;
            }
            
            .vfx-floating-window main::-webkit-scrollbar {
                width: 8px !important;
            }
            
            .vfx-floating-window main::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.2) !important;
                border-radius: 4px !important;
            }
            
            .vfx-floating-window main::-webkit-scrollbar-thumb {
                background-color: rgba(255, 255, 255, 0.2) !important;
                border-radius: 4px !important;
            }
            
            /* Improved inspiration cards */
            .vfx-floating-window .inspiration-card {
                display: flex !important;
                flex-direction: column !important;
                height: auto !important;
                min-height: 140px !important;
                padding: 16px !important;
                transition: all 0.2s ease !important;
            }
            
            .vfx-floating-window .inspiration-card:hover {
                transform: translateY(-4px) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
            }
            
            .vfx-floating-window .inspiration-card p {
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                display: -webkit-box !important;
                -webkit-line-clamp: 4 !important; /* Show 4 lines instead of 3 */
                -webkit-box-orient: vertical !important;
                line-height: 1.4 !important;
            }
            
            /* Resize handles styling */
            .vfx-floating-window .resize-handle {
                background-color: transparent !important;
                transition: background-color 0.2s ease !important;
            }
            
            .vfx-floating-window .resize-handle:hover {
                background-color: rgba(147, 51, 234, 0.3) !important; /* Purple highlight on hover */
            }
            
            /* Corner resize handles - visible dots */
            .vfx-floating-window .resize-handle-ne,
            .vfx-floating-window .resize-handle-nw,
            .vfx-floating-window .resize-handle-se,
            .vfx-floating-window .resize-handle-sw {
                background-color: rgba(255, 255, 255, 0.1) !important;
                border: 1px solid rgba(255, 255, 255, 0.2) !important;
                border-radius: 2px !important;
            }
            
            .vfx-floating-window .resize-handle-ne:hover,
            .vfx-floating-window .resize-handle-nw:hover,
            .vfx-floating-window .resize-handle-se:hover,
            .vfx-floating-window .resize-handle-sw:hover {
                background-color: rgba(147, 51, 234, 0.5) !important;
                border-color: rgba(147, 51, 234, 0.8) !important;
            }
            
            /* Edge resize handles - subtle lines */
            .vfx-floating-window .resize-handle-n,
            .vfx-floating-window .resize-handle-s {
                background-color: rgba(255, 255, 255, 0.05) !important;
                border-radius: 2px !important;
            }
            
            .vfx-floating-window .resize-handle-e,
            .vfx-floating-window .resize-handle-w {
                background-color: rgba(255, 255, 255, 0.05) !important;
                border-radius: 2px !important;
            }
            
            /* Window control buttons improvements */
            .vfx-floating-window .window-control-btn:hover {
                transform: scale(1.1) !important;
            }
        `);
     }
    // --- END: Main Initialization Function ---
    
    // Debug helper for testing audio prompting
    window.vfxAudioDebug = {
        getCurrentState: () => state.promptParams.enableAudioPrompting,
        toggleAudio: () => handleParamChange({ enableAudioPrompting: !state.promptParams.enableAudioPrompting }),
        testNotification: (msg, type = 'info') => showTemporaryNotification(msg, type),
        getState: () => state
    };
    
    // Initialize the script
    init();
})();
// --- END: Userscript ----