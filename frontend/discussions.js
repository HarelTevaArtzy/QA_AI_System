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
    const enrichedCount = document.getElementById("enriched-count");

    const state = {
        topics: [],
        messages: [],
        activeTopicId: null,
        refreshTimer: null,
    };

    function setTopicStatus(message, isError = false) {
        topicStatus.textContent = message;
        topicStatus.style.color = isError ? "#8e1b12" : "";
    }

    function setMessageStatus(message, isError = false) {
        messageStatus.textContent = message;
        messageStatus.style.color = isError ? "#8e1b12" : "";
    }

    function escapeHtml(value) {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatDate(value) {
        return new Date(value).toLocaleString();
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

    function renderMessages() {
        updateMetrics();
        if (!state.activeTopicId) {
            messageList.innerHTML = '<div class="empty-state">Choose a topic to view its conversation history.</div>';
            return;
        }
        if (!state.messages.length) {
            messageList.innerHTML = '<div class="empty-state">No messages in this topic yet. Post one to trigger enrichment.</div>';
            return;
        }

        messageList.innerHTML = state.messages
            .map((message) => `
                <article class="message">
                    <div class="message-head">
                        <h4>Message #${message.id}</h4>
                        <span class="message-meta">${formatDate(message.created_at)}</span>
                    </div>
                    <div class="message-copy">${escapeHtml(message.content)}</div>
                    <div class="enrichment ${message.enriched_content ? "" : "pending"}">${
                        message.enriched_content
                            ? escapeHtml(message.enriched_content)
                            : "AI enrichment is queued. Refresh in a few seconds."
                    }</div>
                </article>
            `)
            .join("");
        messageList.scrollTop = messageList.scrollHeight;
    }

    async function loadTopics() {
        try {
            const response = await fetch("/topics");
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

    async function loadMessages() {
        if (!state.activeTopicId) {
            return;
        }
        try {
            const response = await fetch(`/topics/${state.activeTopicId}/messages`);
            if (!response.ok) {
                throw new Error("Unable to load messages.");
            }
            state.messages = await response.json();
            renderMessages();
        } catch (error) {
            setMessageStatus(error.message || "Unable to load messages.", true);
        }
    }

    async function selectTopic(topicId) {
        state.activeTopicId = topicId;
        const topic = state.topics.find((item) => item.id === topicId);
        activeTopicTitle.textContent = topic ? topic.title : "Select or create a topic";
        renderTopics();
        await loadMessages();
    }

    async function createTopic(event) {
        event.preventDefault();
        setTopicStatus("Creating topic...");
        try {
            const response = await fetch("/topics", {
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
        setMessageStatus("Posting message...");
        try {
            const response = await fetch(`/topics/${state.activeTopicId}/messages`, {
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
            await Promise.all([loadTopics(), loadMessages()]);
        } catch (error) {
            setMessageStatus(error.message || "Unable to post message.", true);
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

    refreshButton.addEventListener("click", async () => {
        await Promise.all([loadTopics(), loadMessages()]);
    });

    topicForm.addEventListener("submit", createTopic);
    messageForm.addEventListener("submit", postMessage);

    state.refreshTimer = window.setInterval(async () => {
        if (!state.activeTopicId) {
            return;
        }
        await Promise.all([loadTopics(), loadMessages()]);
    }, 4000);

    loadTopics();
})();
