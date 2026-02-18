document.addEventListener("DOMContentLoaded", () => {
    const personaId = document.querySelector('meta[name="persona-id"]').content;
    const chatMessages = document.getElementById("chatMessages");
    const chatForm = document.getElementById("chatForm");
    const chatInput = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendBtn");
    const clearBtn = document.getElementById("clearChat");
    const sidebarToggle = document.getElementById("sidebarToggle");
    const sidebar = document.querySelector(".chat-sidebar");

    let conversationHistory = [];
    let isLoading = false;

    // --- Mobile virtual-keyboard fix ---
    // Updates a CSS variable to the real visible height so the layout
    // stays correct when the on-screen keyboard opens / closes.
    function updateAppHeight() {
        const h = window.visualViewport
            ? window.visualViewport.height
            : window.innerHeight;
        document.documentElement.style.setProperty("--app-height", h + "px");
    }
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", updateAppHeight);
    }
    window.addEventListener("resize", updateAppHeight);
    updateAppHeight();

    // When the textarea receives focus on mobile, make sure it's visible
    chatInput.addEventListener("focus", () => {
        setTimeout(() => {
            chatInput.scrollIntoView({ block: "end", behavior: "smooth" });
        }, 300); // slight delay to let the keyboard finish opening
    });

    // Check API readiness on page load
    checkApiStatus();

    // Sidebar toggle (mobile)
    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener("click", () => {
            sidebar.classList.toggle("open");
        });

        // Close sidebar when clicking outside on mobile
        document.addEventListener("click", (e) => {
            if (sidebar.classList.contains("open") &&
                !sidebar.contains(e.target) &&
                !sidebarToggle.contains(e.target)) {
                sidebar.classList.remove("open");
            }
        });
    }

    // Auto-resize textarea
    chatInput.addEventListener("input", () => {
        chatInput.style.height = "auto";
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + "px";
    });

    // Send message on Enter (Shift+Enter for newline)
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event("submit"));
        }
    });

    // Clear chat
    clearBtn.addEventListener("click", () => {
        conversationHistory = [];
        chatMessages.innerHTML = "";
        addWelcomeMessage();
    });

    // Submit handler
    chatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text || isLoading) return;

        // Remove welcome message
        const welcome = chatMessages.querySelector(".chat-welcome");
        if (welcome) welcome.remove();

        // Add user message
        addMessage("user", text);
        conversationHistory.push({ role: "user", content: text });

        // Clear input
        chatInput.value = "";
        chatInput.style.height = "auto";

        // Show typing indicator
        setLoading(true);

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 180000);

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    persona_id: personaId,
                    messages: conversationHistory
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Handle session expiry
            if (response.status === 401) {
                setLoading(false);
                addMessage("system", "Your session has expired. Redirecting to login...");
                conversationHistory.pop();
                setTimeout(() => { window.location.href = "/login"; }, 2000);
                return;
            }

            // Parse JSON response (both success and error come as JSON now)
            const data = await response.json();

            setLoading(false);

            if (!response.ok || data.error) {
                addMessage("system", data.error || `Server error (${response.status}).`);
                conversationHistory.pop();
                return;
            }

            if (data.reply) {
                addMessage("assistant", data.reply);
                conversationHistory.push({ role: "assistant", content: data.reply });
            } else {
                addMessage("system", "No response received. Please try again.");
                conversationHistory.pop();
            }

        } catch (err) {
            setLoading(false);
            if (err.name === "AbortError") {
                addMessage("system", "Request timed out. The AI service took too long to respond — please try again.");
            } else {
                addMessage("system", "Connection error (" + err.message + "). Please check your network and try again.");
            }
            conversationHistory.pop();
        }
    });

    async function checkApiStatus() {
        try {
            const response = await fetch("/api/status", {
                headers: { "Content-Type": "application/json" },
                credentials: "include"
            });
            if (response.status === 401) return;
            const data = await response.json();
            if (!data.ready) {
                disableChat("ANTHROPIC_API_KEY is not set. Chat will not work until an API key is added in the Render dashboard under Environment Variables.");
            }
        } catch (err) {
            // Silently ignore - errors will surface when user tries to chat
        }
    }

    function disableChat(message) {
        // Replace the welcome screen with a prominent error
        chatMessages.innerHTML = "";
        const banner = document.createElement("div");
        banner.className = "chat-status-banner chat-status-blocked";
        banner.innerHTML = "<strong>Chat unavailable</strong><br>" + message;
        chatMessages.appendChild(banner);

        // Disable the input so it's obvious
        chatInput.disabled = true;
        chatInput.placeholder = "Chat unavailable — see message above";
        sendBtn.disabled = true;
    }

    function addStatusBanner(message) {
        const existing = chatMessages.querySelector(".chat-status-banner");
        if (existing) existing.remove();
        const banner = document.createElement("div");
        banner.className = "chat-status-banner";
        banner.textContent = message;
        chatMessages.insertBefore(banner, chatMessages.firstChild);
    }

    function addMessage(role, content) {
        const messageDiv = document.createElement("div");
        messageDiv.className = `message message-${role}`;

        const avatarDiv = document.createElement("div");
        avatarDiv.className = "message-avatar";

        if (role === "user") {
            avatarDiv.textContent = "You";
        } else if (role === "system") {
            avatarDiv.textContent = "!";
        } else {
            const avatarInitials = document.querySelector(".sidebar-persona .persona-avatar span");
            avatarDiv.textContent = avatarInitials ? avatarInitials.textContent : "AI";
        }

        const bubbleDiv = document.createElement("div");
        bubbleDiv.className = "message-bubble";
        bubbleDiv.innerHTML = content ? formatMessage(content) : "";

        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(bubbleDiv);
        chatMessages.appendChild(messageDiv);

        scrollToBottom();

        return { bubbleEl: bubbleDiv };
    }

    function formatMessage(text) {
        // Basic markdown-like formatting
        let html = escapeHtml(text);

        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        // Italic
        html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

        // Inline code
        html = html.replace(/`(.*?)`/g, "<code>$1</code>");

        // Lists (lines starting with - or *)
        html = html.replace(/^[\-\*]\s(.+)$/gm, "<li>$1</li>");
        html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

        // Numbered lists
        html = html.replace(/^\d+\.\s(.+)$/gm, "<li>$1</li>");

        // Paragraphs (double newline)
        html = html.replace(/\n\n/g, "</p><p>");

        // Single newlines to <br>
        html = html.replace(/\n/g, "<br>");

        // Wrap in paragraph
        html = "<p>" + html + "</p>";

        // Clean up empty paragraphs
        html = html.replace(/<p><\/p>/g, "");

        return html;
    }

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    function setLoading(loading) {
        isLoading = loading;
        sendBtn.disabled = loading;

        if (loading) {
            const typingDiv = document.createElement("div");
            typingDiv.className = "message message-assistant";
            typingDiv.id = "typingIndicator";

            const avatarDiv = document.createElement("div");
            avatarDiv.className = "message-avatar";
            const avatarInitials = document.querySelector(".sidebar-persona .persona-avatar span");
            avatarDiv.textContent = avatarInitials ? avatarInitials.textContent : "AI";

            const indicator = document.createElement("div");
            indicator.className = "typing-indicator";
            indicator.innerHTML = "<span></span><span></span><span></span>";

            typingDiv.appendChild(avatarDiv);
            typingDiv.appendChild(indicator);
            chatMessages.appendChild(typingDiv);
            scrollToBottom();
        } else {
            const typing = document.getElementById("typingIndicator");
            if (typing) typing.remove();
        }
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }

    function addWelcomeMessage() {
        const avatarInitials = document.querySelector(".sidebar-persona .persona-avatar span");
        const personaName = document.querySelector(".sidebar-persona h2");

        chatMessages.innerHTML = `
            <div class="chat-welcome">
                <div class="persona-avatar persona-avatar-lg">
                    <span>${avatarInitials ? avatarInitials.textContent : "?"}</span>
                </div>
                <h3>${personaName ? personaName.textContent : "Persona"}</h3>
                <p>Send a message to begin the simulation. The persona will introduce themselves and ask which interaction mode you prefer.</p>
            </div>
        `;
    }
});
