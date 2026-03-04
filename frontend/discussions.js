(function () {
    const topicForm = document.getElementById("topic-form");
    const topicInput = document.getElementById("topic-title");
    const topicStatus = document.getElementById("topic-status");
    const topicList = document.getElementById("topic-list");
    const topicCount = document.getElementById("topic-count");
    const messageForm = document.getElementById("message-form");
    const messageInput = document.getElementById("message-content");
    const messageStatus = document.getElementById("message-status");
    const messageList = document.getElementById("message-list");
    const activeTopicTitle = document.getElementById("active-topic-title");
    const refreshButton = document.getElementById("refresh-messages");
    const generateScenariosButton = document.getElementById("generate-scenarios");
    const scenarioSuggestionsNode = document.getElementById("scenario-suggestions");
    const scenarioSuggestionsStatus = document.getElementById("scenario-suggestions-status");
    const enrichedCount = document.getElementById("enriched-count");
    const scenarioCount = document.getElementById("scenario-count");

    const state = {
        topics: [],
        messages: [],
        activeTopicId: null,
        refreshTimer: null,
        latestScenarioSuggestions: "",
        latestScenarioItems: [],
    };

    function canWrite() {
        return window.qaAuth?.canWriteContent?.() || false;
    }

    function isAuthenticated() {
        return window.qaAuth?.isAuthenticated?.() || false;
    }

    function setTopicStatus(message, isError = false) {
        topicStatus.textContent = message;
        topicStatus.style.color = isError ? "#8e1b12" : "";
    }

    function setMessageStatus(message, isError = false) {
        messageStatus.textContent = message;
        messageStatus.style.color = isError ? "#8e1b12" : "";
    }

    function setScenarioSuggestionsStatus(message, isError = false) {
        scenarioSuggestionsStatus.textContent = message;
        scenarioSuggestionsStatus.style.color = isError ? "#8e1b12" : "";
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatDate(value) {
        return new Date(value).toLocaleString();
    }

    function sanitizeEnrichmentContent(value) {
        let content = String(value || "").trim();
        const summaryMatch = content.match(/^##\s*summary\b/im);
        if (!summaryMatch || typeof summaryMatch.index !== "number") {
            return content;
        }
        content = content.slice(summaryMatch.index).trim();
        content = content.replace(/([^\n])\s*(##\s*[A-Za-z])/g, "$1\n\n$2");
        return normalizeSectionBlocks(content);
    }

    function normalizeHeadingTitle(title) {
        const compact = title.trim().replace(/\s+/g, " ").toLowerCase();
        const canonicalTitles = {
            "summary": "Summary",
            "suggested test types": "Test Type Classification",
            "test type classification": "Test Type Classification",
            "risks": "Risks",
            "risks to probe": "Risks To Probe",
            "test ideas": "Test Ideas",
            "candidate scenario ideas": "Candidate Scenario Ideas",
            "best practices": "Best Practices",
            "related scenarios": "Related Scenarios",
            "qa heuristics": "QA Heuristics",
            "related discussion context": "Related Discussion Context",
        };
        return canonicalTitles[compact] || title.trim();
    }

    function normalizeSectionBlocks(content) {
        const sectionPattern = /^##\s+(.+?)\s*\n([\s\S]*?)(?=^##\s+|\Z)/gim;
        const sections = [];
        const sectionIndexByTitle = new Map();
        let match;

        while ((match = sectionPattern.exec(content)) !== null) {
            const title = normalizeHeadingTitle(match[1]);
            const body = match[2].trim();
            if (sectionIndexByTitle.has(title)) {
                sections[sectionIndexByTitle.get(title)] = {title, body};
                continue;
            }
            sectionIndexByTitle.set(title, sections.length);
            sections.push({title, body});
        }

        if (!sections.length) {
            return content;
        }

        return sections
            .map(({title, body}) => `## ${title}\n\n${body}`.trim())
            .join("\n\n");
    }

    function renderInlineMarkdown(value) {
        return escapeHtml(value)
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    }

    function renderEnrichmentMarkdown(value) {
        const content = sanitizeEnrichmentContent(value);
        if (!content) {
            return "";
        }

        const lines = content.split(/\r?\n/);
        const blocks = [];
        let paragraphLines = [];
        let listItems = [];
        let listTag = "";

        function flushParagraph() {
            if (!paragraphLines.length) {
                return;
            }
            blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
            paragraphLines = [];
        }

        function flushList() {
            if (!listItems.length || !listTag) {
                listItems = [];
                listTag = "";
                return;
            }
            const items = listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("");
            blocks.push(`<${listTag}>${items}</${listTag}>`);
            listItems = [];
            listTag = "";
        }

        for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed) {
                flushParagraph();
                flushList();
                continue;
            }

            const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                flushParagraph();
                flushList();
                const level = Math.min(headingMatch[1].length, 6);
                blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
                continue;
            }

            const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
            if (orderedMatch) {
                flushParagraph();
                if (listTag && listTag !== "ol") {
                    flushList();
                }
                listTag = "ol";
                listItems.push(orderedMatch[1]);
                continue;
            }

            const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
            if (unorderedMatch) {
                flushParagraph();
                if (listTag && listTag !== "ul") {
                    flushList();
                }
                listTag = "ul";
                listItems.push(unorderedMatch[1]);
                continue;
            }

            flushList();
            paragraphLines.push(trimmed);
        }

        flushParagraph();
        flushList();
        return blocks.join("");
    }

    function renderScenarioSuggestions(value, scenarios = []) {
        const content = String(value || "").trim();
        state.latestScenarioSuggestions = content;
        state.latestScenarioItems = Array.isArray(scenarios) ? scenarios : [];
        if (!content) {
            scenarioSuggestionsNode.innerHTML = '<div class="empty-state">Scenario suggestions will appear here for the active topic.</div>';
            return;
        }

        if (!state.latestScenarioItems.length) {
            scenarioSuggestionsNode.innerHTML = `<div class="enrichment">${renderEnrichmentMarkdown(content)}</div>`;
            return;
        }

        scenarioSuggestionsNode.innerHTML = state.latestScenarioItems
            .map((scenario, index) => `
                <article class="scenario-suggestion-item">
                    <div class="scenario-head">
                        <div>
                            <h4>${escapeHtml(scenario.title)}</h4>
                        </div>
                        <span class="priority priority-${escapeHtml(scenario.priority)}">${escapeHtml(scenario.priority)}</span>
                    </div>
                    <div class="scenario-body">
                        <p>${escapeHtml(scenario.description || "No description provided.")}</p>
                        <div>
                            <span class="scenario-section-title">Test Steps</span>
                            ${scenario.steps ? `<ul>${scenario.steps.split("\n").filter(Boolean).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "<p>-</p>"}
                        </div>
                        <div>
                            <span class="scenario-section-title">Expected Result</span>
                            ${scenario.expected_result ? `<ul>${scenario.expected_result.split("\n").filter(Boolean).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "<p>-</p>"}
                        </div>
                    </div>
                    ${
                        canWrite()
                            ? `
                                <div class="item-actions">
                                    <button type="button" class="primary-button small" data-add-scenario="${index}">Add Scenario</button>
                                </div>
                            `
                            : ""
                    }
                </article>
            `)
            .join("");
    }

    async function refreshScenarioCount() {
        if (!(scenarioCount instanceof HTMLElement) || !isAuthenticated()) {
            return;
        }
        try {
            const response = await window.qaApi.fetch("/scenarios");
            if (!response.ok) {
                return;
            }
            const scenarios = await response.json();
            scenarioCount.textContent = String(scenarios.length);
        } catch (_error) {
            // Ignore metric refresh failures in the discussions panel.
        }
    }

    function isNearBottom(container, threshold = 32) {
        return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    }

    function updateMetrics() {
        topicCount.textContent = String(state.topics.length);
        const enrichedMessages = state.topics.reduce(
            (total, topic) => total + (topic.enriched_message_count || 0),
            0
        );
        enrichedCount.textContent = String(enrichedMessages);
    }

    function renderTopics() {
        updateMetrics();
        if (!isAuthenticated()) {
            topicList.innerHTML = '<div class="empty-state">Sign in to browse discussion topics.</div>';
            return;
        }

        if (!state.topics.length) {
            topicList.innerHTML = '<div class="empty-state">No topics yet. Create one to start the discussion workspace.</div>';
            return;
        }

        topicList.innerHTML = state.topics
            .map((topic) => `
                <button type="button" class="topic-item ${state.activeTopicId === topic.id ? "active" : ""}" data-topic-id="${topic.id}">
                    <div class="topic-head">
                        <div>
                            <h4>${escapeHtml(topic.title)}</h4>
                            <p class="topic-meta">${topic.message_count} message${topic.message_count === 1 ? "" : "s"}</p>
                        </div>
                        <span class="topic-meta">${topic.last_message_at ? formatDate(topic.last_message_at) : formatDate(topic.created_at)}</span>
                    </div>
                </button>
            `)
            .join("");
    }

    function renderMessages(options = {}) {
        const {stickToBottom = false} = options;
        updateMetrics();

        if (!isAuthenticated()) {
            messageList.innerHTML = '<div class="empty-state">Sign in to inspect discussion history.</div>';
            return;
        }

        if (!state.activeTopicId) {
            messageList.innerHTML = '<div class="empty-state">Choose a topic to view its conversation history.</div>';
            return;
        }
        if (!state.messages.length) {
            messageList.innerHTML = '<div class="empty-state">No messages in this topic yet. Post one to trigger enrichment.</div>';
            return;
        }

        const distanceFromBottom = messageList.scrollHeight - messageList.scrollTop;
        const shouldStickToBottom = stickToBottom || isNearBottom(messageList);

        messageList.innerHTML = state.messages
            .map((message, index) => `
                <article class="message">
                    <div class="message-head">
                        <h4>Message #${index + 1}</h4>
                        <span class="message-meta">${formatDate(message.created_at)}</span>
                    </div>
                    <div class="message-copy">${escapeHtml(message.content)}</div>
                    <div class="enrichment ${message.enriched_content ? "" : "pending"}">${
                        message.enriched_content
                            ? renderEnrichmentMarkdown(message.enriched_content)
                            : "AI enrichment is queued. Refresh in a few seconds."
                    }</div>
                </article>
            `)
            .join("");

        if (shouldStickToBottom) {
            messageList.scrollTop = messageList.scrollHeight;
            return;
        }

        messageList.scrollTop = Math.max(0, messageList.scrollHeight - distanceFromBottom);
    }

    function updateActionState() {
        const writable = canWrite();
        topicForm.querySelectorAll("input, button").forEach((node) => {
            if (node instanceof HTMLInputElement || node instanceof HTMLButtonElement) {
                node.disabled = !writable;
            }
        });
        messageForm.querySelectorAll("textarea, button").forEach((node) => {
            if (node instanceof HTMLTextAreaElement || node instanceof HTMLButtonElement) {
                node.disabled = !writable;
            }
        });
        generateScenariosButton.disabled = !isAuthenticated() || !state.activeTopicId;
    }

    async function loadTopics() {
        if (!isAuthenticated()) {
            state.topics = [];
            state.messages = [];
            state.activeTopicId = null;
            activeTopicTitle.textContent = "Sign in to access discussions";
            renderTopics();
            renderMessages();
            updateActionState();
            return;
        }

        try {
            const response = await window.qaApi.fetch("/topics");
            if (!response.ok) {
                throw new Error("Unable to load topics.");
            }
            state.topics = await response.json();
            renderTopics();

            if (!state.activeTopicId && state.topics.length) {
                await selectTopic(state.topics[0].id);
            }
        } catch (error) {
            setTopicStatus(error.message || "Unable to load topics.", true);
        }
    }

    async function loadMessages(options = {}) {
        if (!state.activeTopicId || !isAuthenticated()) {
            return;
        }
        try {
            const response = await window.qaApi.fetch(`/topics/${state.activeTopicId}/messages`);
            if (!response.ok) {
                throw new Error("Unable to load messages.");
            }
            state.messages = await response.json();
            renderMessages(options);
        } catch (error) {
            setMessageStatus(error.message || "Unable to load messages.", true);
        }
    }

    async function selectTopic(topicId) {
        state.activeTopicId = topicId;
        const topic = state.topics.find((item) => item.id === topicId);
        activeTopicTitle.textContent = topic ? topic.title : "Select or create a topic";
        renderScenarioSuggestions("", []);
        setScenarioSuggestionsStatus("");
        renderTopics();
        updateActionState();
        await loadMessages({stickToBottom: true});
    }

    async function createTopic(event) {
        event.preventDefault();
        if (!canWrite()) {
            setTopicStatus("Only Admin and QA users can create topics.", true);
            return;
        }

        setTopicStatus("Creating topic...");
        try {
            const response = await window.qaApi.fetch("/topics", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({title: topicInput.value}),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to create topic.");
            }
            const createdTopic = await response.json();
            topicInput.value = "";
            setTopicStatus("Topic created.");
            await loadTopics();
            if (createdTopic?.id) {
                await selectTopic(createdTopic.id);
            }
        } catch (error) {
            setTopicStatus(error.message || "Unable to create topic.", true);
        }
    }

    async function postMessage(event) {
        event.preventDefault();
        if (!state.activeTopicId) {
            setMessageStatus("Create or select a topic first.", true);
            return;
        }
        if (!canWrite()) {
            setMessageStatus("Only Admin and QA users can post messages.", true);
            return;
        }

        setMessageStatus("Posting message...");
        try {
            const response = await window.qaApi.fetch(`/topics/${state.activeTopicId}/messages`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({content: messageInput.value}),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to post message.");
            }
            messageInput.value = "";
            setMessageStatus("Message posted. Enrichment is running.");
            await Promise.all([loadTopics(), loadMessages({stickToBottom: true})]);
        } catch (error) {
            setMessageStatus(error.message || "Unable to post message.", true);
        }
    }

    async function generateScenarioSuggestions() {
        if (!state.activeTopicId) {
            setScenarioSuggestionsStatus("Create or select a topic first.", true);
            return;
        }

        setScenarioSuggestionsStatus("Generating scenarios...");
        try {
            const response = await window.qaApi.fetch(`/topics/${state.activeTopicId}/scenario-suggestions`, {
                method: "POST",
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to generate scenarios.");
            }
            const payload = await response.json();
            renderScenarioSuggestions(payload.content, payload.scenarios || []);
            setScenarioSuggestionsStatus("Scenario suggestions generated.");
        } catch (error) {
            setScenarioSuggestionsStatus(error.message || "Unable to generate scenarios.", true);
        }
    }

    async function addScenarioByIndex(index) {
        if (!canWrite()) {
            setScenarioSuggestionsStatus("Only Admin and QA users can save scenarios.", true);
            return;
        }
        const scenario = state.latestScenarioItems[index];
        if (!scenario) {
            setScenarioSuggestionsStatus("Scenario suggestion is unavailable.", true);
            return;
        }
        setScenarioSuggestionsStatus("Saving scenario...");
        try {
            const response = await window.qaApi.fetch("/scenarios", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(scenario),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to save scenario.");
            }
            state.latestScenarioItems = state.latestScenarioItems.filter((_, itemIndex) => itemIndex !== index);
            renderScenarioSuggestions(state.latestScenarioSuggestions, state.latestScenarioItems);
            await refreshScenarioCount();
            window.dispatchEvent(new Event("qa:scenarios-changed"));
            setScenarioSuggestionsStatus("Scenario saved.");
        } catch (error) {
            setScenarioSuggestionsStatus(error.message || "Unable to save scenario.", true);
        }
    }

    topicList.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const topicButton = target.closest("[data-topic-id]");
        if (!(topicButton instanceof HTMLElement)) {
            return;
        }
        const topicId = Number(topicButton.dataset.topicId);
        if (!topicId) {
            return;
        }
        await selectTopic(topicId);
    });

    scenarioSuggestionsNode?.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest("[data-add-scenario]");
        if (!(button instanceof HTMLElement)) {
            return;
        }
        const index = Number(button.dataset.addScenario);
        if (Number.isNaN(index)) {
            return;
        }
        await addScenarioByIndex(index);
    });

    refreshButton.addEventListener("click", async () => {
        await Promise.all([loadTopics(), loadMessages()]);
    });

    generateScenariosButton?.addEventListener("click", generateScenarioSuggestions);

    topicForm.addEventListener("submit", createTopic);
    messageForm.addEventListener("submit", postMessage);

    state.refreshTimer = window.setInterval(async () => {
        if (!state.activeTopicId || !isAuthenticated()) {
            return;
        }
        await Promise.all([loadTopics(), loadMessages()]);
    }, 4000);

    window.addEventListener("qa:auth-changed", async () => {
        state.latestScenarioSuggestions = "";
        state.latestScenarioItems = [];
        renderScenarioSuggestions("", []);
        await loadTopics();
        updateActionState();
    });

    renderScenarioSuggestions("", []);
    renderTopics();
    renderMessages();
    updateActionState();
})();
