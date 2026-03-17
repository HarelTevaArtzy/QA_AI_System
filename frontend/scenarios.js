(function () {
    const form = document.getElementById("scenario-form");
    const formTitle = document.getElementById("scenario-form-title");
    const formFieldsNode = document.getElementById("scenario-form-fields");
    const modeToggleButton = document.getElementById("scenario-mode-toggle");
    const chatModeNode = document.getElementById("scenario-chat-mode");
    const chatLogNode = document.getElementById("scenario-chat-log");
    const chatInput = document.getElementById("scenario-chat-input");
    const chatSendButton = document.getElementById("scenario-chat-send");
    const idInput = document.getElementById("scenario-id");
    const titleInput = document.getElementById("scenario-title");
    const descriptionInput = document.getElementById("scenario-description");
    const stepsInput = document.getElementById("scenario-steps");
    const expectedInput = document.getElementById("scenario-expected");
    const priorityInput = document.getElementById("scenario-priority");
    const submitButton = document.getElementById("scenario-submit");
    const requirementSelector = document.getElementById("scenario-requirement-selector");
    const statusNode = document.getElementById("scenario-status");
    const listNode = document.getElementById("scenario-list");
    const countNode = document.getElementById("scenario-list-count");
    const metricNode = document.getElementById("scenario-count");
    const resetButton = document.getElementById("scenario-reset");
    const exportExcelButton = document.getElementById("export-excel");
    const exportWordButton = document.getElementById("export-word");
    const refreshLibraryButton = document.getElementById("scenario-refresh");
    const panelNode = document.querySelector(".panel-scenarios");
    const panelToggleButton = document.getElementById("scenario-panel-toggle");

    const state = {
        editingId: null,
        scenarios: [],
        requirements: [],
        creationMode: "form",
        chatStepIndex: 0,
        chatDraft: null,
        chatSaving: false,
    };

    const CHAT_STEPS = ["title", "description", "steps", "expected_result", "priority", "requirement_ids"];
    const PRIORITY_VALUES = new Set(["low", "medium", "high", "critical"]);

    function setStatus(message, isError = false) {
        statusNode.textContent = message;
        statusNode.style.color = isError ? "#8e1b12" : "";
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function formatLines(value) {
        const lines = String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
        if (!lines.length) {
            return "<p>-</p>";
        }
        return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
    }

    function formatDate(value) {
        return new Date(value).toLocaleString();
    }

    function setCollapsedState(container, button, isCollapsed) {
        if (!(container instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
            return;
        }
        container.classList.toggle("is-collapsed", isCollapsed);
        container.classList.toggle("is-expanded", !isCollapsed);
        button.setAttribute("aria-expanded", String(!isCollapsed));

        const label = button.querySelector(".collapse-toggle-label");
        const icon = button.querySelector(".collapse-toggle-icon");
        if (label) {
            label.textContent = isCollapsed ? "Expand" : "Collapse";
        }
        if (icon) {
            icon.textContent = isCollapsed ? "+" : "-";
        }
    }

    function canWrite() {
        return window.qaAuth?.canWriteContent?.() || false;
    }

    function getSelectedRequirementIds() {
        return Array.from(requirementSelector.querySelectorAll('input[type="checkbox"]:checked'))
            .map((input) => Number(input.value))
            .filter((value) => !Number.isNaN(value));
    }

    function setSelectedRequirementIds(ids) {
        const selected = new Set(ids.map((value) => Number(value)));
        requirementSelector.querySelectorAll('input[type="checkbox"]').forEach((input) => {
            if (!(input instanceof HTMLInputElement)) {
                return;
            }
            input.checked = selected.has(Number(input.value));
        });
    }

    function normalizeMultilineValue(value) {
        return String(value || "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join("\n");
    }

    function normalizeOptionalValue(value) {
        const compact = String(value || "").trim();
        if (!compact || compact.toLowerCase() === "skip" || compact.toLowerCase() === "none") {
            return "";
        }
        return compact;
    }

    function normalizePriority(value) {
        const normalized = String(value || "").trim().toLowerCase();
        if (PRIORITY_VALUES.has(normalized)) {
            return normalized;
        }
        const alias = {
            p1: "critical",
            p2: "high",
            p3: "medium",
            p4: "low",
        };
        return alias[normalized] || null;
    }

    function getDefaultChatDraft(initialRequirementIds = []) {
        return {
            title: "",
            description: "",
            steps: "",
            expected_result: "",
            priority: "medium",
            requirement_ids: initialRequirementIds,
        };
    }

    function applyDraftToForm(draft) {
        titleInput.value = draft.title;
        descriptionInput.value = draft.description;
        stepsInput.value = draft.steps;
        expectedInput.value = draft.expected_result;
        priorityInput.value = draft.priority;
        setSelectedRequirementIds(draft.requirement_ids);
    }

    function appendChatMessage(role, message) {
        if (!(chatLogNode instanceof HTMLElement)) {
            return;
        }
        const item = document.createElement("article");
        item.className = `scenario-chat-message ${role === "user" ? "is-user" : "is-bot"}`;
        item.innerHTML = `
            <span class="scenario-chat-speaker">${role === "user" ? "You" : "Bot"}</span>
            <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
        `;
        chatLogNode.appendChild(item);
        chatLogNode.scrollTop = chatLogNode.scrollHeight;
    }

    function formatRequirementPromptSegment() {
        if (!state.requirements.length) {
            return "No requirements are available yet, so type skip.";
        }
        const preview = state.requirements.slice(0, 6)
            .map((requirement) => `${requirement.id}: ${requirement.title}`)
            .join(" | ");
        const moreCount = Math.max(0, state.requirements.length - 6);
        const moreSuffix = moreCount > 0 ? ` | +${moreCount} more` : "";
        return `Available IDs: ${preview}${moreSuffix}`;
    }

    function getChatPrompt(stepIndex) {
        const step = CHAT_STEPS[stepIndex];
        if (step === "title") {
            return "What is the scenario title?";
        }
        if (step === "description") {
            return "What is the scenario description? (type skip for empty)";
        }
        if (step === "steps") {
            return "List the test steps. Use one line per step. (type skip for empty)";
        }
        if (step === "expected_result") {
            return "What are the expected results? Use one line per result. (type skip for empty)";
        }
        if (step === "priority") {
            return "What is the priority? Choose: low, medium, high, or critical.";
        }
        if (step === "requirement_ids") {
            const selected = state.chatDraft?.requirement_ids?.length
                ? `Current selection: ${state.chatDraft.requirement_ids.join(", ")}. `
                : "";
            return `Optional: enter linked requirement IDs separated by commas, or type skip. ${selected}${formatRequirementPromptSegment()}`;
        }
        return "";
    }

    function clearScenarioFields(clearRequirements = true) {
        state.editingId = null;
        idInput.value = "";
        titleInput.value = "";
        descriptionInput.value = "";
        stepsInput.value = "";
        expectedInput.value = "";
        priorityInput.value = "medium";
        formTitle.textContent = "Create Scenario";
        if (clearRequirements) {
            setSelectedRequirementIds([]);
        }
    }

    function startChatSession(options = {}) {
        const {
            preserveLog = false,
            showIntro = true,
            initialRequirementIds = [],
        } = options;
        state.chatStepIndex = 0;
        state.chatDraft = getDefaultChatDraft(initialRequirementIds);
        applyDraftToForm(state.chatDraft);
        if (!preserveLog) {
            chatLogNode.innerHTML = "";
        }
        if (showIntro) {
            appendChatMessage("bot", "Chat mode enabled. I will guide scenario creation step by step.");
        }
        appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
        chatInput.value = "";
        chatInput.focus();
    }

    function setCreationMode(mode, options = {}) {
        const {initializeChat = true} = options;
        if (mode !== "form" && mode !== "chat") {
            return;
        }
        state.creationMode = mode;
        const isChat = mode === "chat";
        formFieldsNode.classList.toggle("hidden", isChat);
        chatModeNode.classList.toggle("hidden", !isChat);
        modeToggleButton.textContent = isChat ? "Use Form Mode" : "Use Chat Mode";
        if (isChat && state.editingId) {
            clearScenarioFields(true);
            setStatus("Chat mode starts from a new scenario.");
        }
        if (isChat && initializeChat) {
            startChatSession({initialRequirementIds: getSelectedRequirementIds()});
        }
        updateActionState();
    }

    function resetForm(options = {}) {
        const {
            clearStatus = true,
            clearRequirements = true,
            restartChat = true,
        } = options;
        clearScenarioFields(clearRequirements);
        chatInput.value = "";
        state.chatDraft = getDefaultChatDraft(getSelectedRequirementIds());
        state.chatStepIndex = 0;
        if (state.creationMode === "chat" && restartChat) {
            startChatSession({initialRequirementIds: getSelectedRequirementIds()});
        }
        if (clearStatus) {
            setStatus("");
        }
        updateActionState();
    }

    function updateCounts() {
        const count = state.scenarios.length;
        countNode.textContent = `${count} item${count === 1 ? "" : "s"}`;
        metricNode.textContent = String(count);
    }

    function renderRequirementSelector() {
        if (!window.qaAuth?.isAuthenticated?.()) {
            requirementSelector.innerHTML = '<div class="empty-state">Sign in to link scenarios to requirements.</div>';
            return;
        }

        if (!state.requirements.length) {
            requirementSelector.innerHTML = '<div class="empty-state">No requirements available yet.</div>';
            return;
        }

        requirementSelector.innerHTML = state.requirements.map((requirement) => `
            <label class="linked-option">
                <input type="checkbox" value="${requirement.id}">
                <span>${escapeHtml(requirement.title)}</span>
            </label>
        `).join("");
    }

    function renderScenarios() {
        updateCounts();

        if (!window.qaAuth?.isAuthenticated?.()) {
            listNode.innerHTML = '<div class="empty-state">Sign in to access the scenario library.</div>';
            return;
        }

        if (!state.scenarios.length) {
            listNode.innerHTML = '<div class="empty-state">No scenarios yet. Create one to start building the QA library.</div>';
            return;
        }

        listNode.innerHTML = state.scenarios
            .map((scenario) => `
                <article class="scenario-item">
                    <div class="scenario-head">
                        <div>
                            <h4>${escapeHtml(scenario.title)}</h4>
                            <p class="topic-meta">${formatDate(scenario.created_at)}</p>
                        </div>
                        <span class="priority priority-${escapeHtml(scenario.priority)}">${escapeHtml(scenario.priority)}</span>
                    </div>
                    <div class="scenario-body">
                        <p>${escapeHtml(scenario.description || "No description provided.")}</p>
                        <div>
                            <span class="scenario-section-title">Linked Requirements</span>
                            ${
                                scenario.requirements?.length
                                    ? `<div class="linked-badges">${scenario.requirements.map((requirement) => `<span class="linked-badge">${escapeHtml(requirement.title)}</span>`).join("")}</div>`
                                    : "<p>-</p>"
                            }
                        </div>
                        <div>
                            <span class="scenario-section-title">Test Steps</span>
                            ${formatLines(scenario.steps)}
                        </div>
                        <div>
                            <span class="scenario-section-title">Expected Results</span>
                            ${formatLines(scenario.expected_result)}
                        </div>
                    </div>
                    ${
                        canWrite()
                            ? `
                                <div class="item-actions">
                                    <button type="button" class="ghost-button small" data-action="edit" data-id="${scenario.id}">Edit</button>
                                    <button type="button" class="ghost-button small" data-action="delete" data-id="${scenario.id}">Delete</button>
                                </div>
                            `
                            : ""
                    }
                </article>
            `)
            .join("");
    }

    function populateForm(scenario) {
        if (state.creationMode === "chat") {
            setCreationMode("form", {initializeChat: false});
        }
        state.editingId = scenario.id;
        idInput.value = String(scenario.id);
        titleInput.value = scenario.title;
        descriptionInput.value = scenario.description;
        stepsInput.value = scenario.steps;
        expectedInput.value = scenario.expected_result;
        priorityInput.value = scenario.priority;
        setSelectedRequirementIds((scenario.requirements || []).map((item) => item.id));
        formTitle.textContent = "Edit Scenario";
        setStatus(`Editing scenario #${scenario.id}`);
        window.scrollTo({top: 0, behavior: "smooth"});
    }

    function updateActionState() {
        const writable = canWrite();
        const isChatMode = state.creationMode === "chat";
        formFieldsNode?.querySelectorAll("input, textarea, select, button").forEach((node) => {
            if (!(node instanceof HTMLButtonElement) && !(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement) && !(node instanceof HTMLSelectElement)) {
                return;
            }
            node.disabled = !writable || isChatMode;
        });
        if (chatInput instanceof HTMLTextAreaElement) {
            chatInput.disabled = !writable || !isChatMode || state.chatSaving;
        }
        if (chatSendButton instanceof HTMLButtonElement) {
            chatSendButton.disabled = !writable || !isChatMode || state.chatSaving;
        }
        if (submitButton instanceof HTMLButtonElement) {
            submitButton.disabled = !writable || isChatMode;
        }
        if (modeToggleButton instanceof HTMLButtonElement) {
            modeToggleButton.disabled = !writable;
        }
        if (resetButton instanceof HTMLButtonElement) {
            resetButton.disabled = !writable;
        }
    }

    async function loadScenarios() {
        if (!window.qaAuth?.isAuthenticated?.()) {
            state.scenarios = [];
            renderScenarios();
            updateActionState();
            return;
        }

        try {
            const response = await window.qaApi.fetch("/scenarios");
            if (!response.ok) {
                throw new Error("Unable to load scenarios.");
            }
            state.scenarios = await response.json();
            renderScenarios();
        } catch (error) {
            setStatus(error.message || "Unable to load scenarios.", true);
        }
    }

    async function submitScenarioPayload(payload, isEditing) {
        const url = isEditing ? `/scenarios/${state.editingId}` : "/scenarios";
        const method = isEditing ? "PUT" : "POST";
        try {
            const response = await window.qaApi.fetch(url, {
                method,
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to save scenario.");
            }
            await loadScenarios();
            window.dispatchEvent(new Event("qa:scenarios-changed"));
            return true;
        } catch (error) {
            setStatus(error.message || "Unable to save scenario.", true);
            return false;
        }
    }

    async function saveScenario(event) {
        event.preventDefault();
        if (state.creationMode === "chat") {
            setStatus("Use chat send while chat mode is active.", true);
            return;
        }
        if (!canWrite()) {
            setStatus("Only Admin and QA users can change scenarios.", true);
            return;
        }

        const payload = {
            title: titleInput.value.trim(),
            description: descriptionInput.value.trim(),
            steps: normalizeMultilineValue(stepsInput.value),
            expected_result: normalizeMultilineValue(expectedInput.value),
            priority: priorityInput.value,
            requirement_ids: getSelectedRequirementIds(),
        };
        if (!payload.title) {
            setStatus("Scenario title is required.", true);
            titleInput.focus();
            return;
        }
        if (!normalizePriority(payload.priority)) {
            setStatus("Scenario priority is invalid.", true);
            priorityInput.focus();
            return;
        }

        const isEditing = Boolean(state.editingId);
        setStatus("Saving scenario...");
        const saved = await submitScenarioPayload(payload, isEditing);
        if (!saved) {
            return;
        }
        resetForm();
        setStatus(isEditing ? "Scenario updated." : "Scenario created.");
    }

    function parseRequirementIds(answer) {
        const compact = String(answer || "").trim();
        if (!compact || compact.toLowerCase() === "skip" || compact.toLowerCase() === "none") {
            return {
                ok: true,
                ids: state.chatDraft?.requirement_ids || [],
            };
        }
        const ids = Array.from(new Set(compact.split(",")
            .map((part) => Number(part.trim()))
            .filter((value) => !Number.isNaN(value) && value > 0)));
        if (!ids.length) {
            return {ok: false, error: "Please enter valid numeric requirement IDs separated by commas."};
        }
        const existing = new Set(state.requirements.map((requirement) => requirement.id));
        const invalid = ids.filter((id) => !existing.has(id));
        if (invalid.length) {
            return {ok: false, error: `Unknown requirement ID(s): ${invalid.join(", ")}.`};
        }
        return {ok: true, ids};
    }

    async function finalizeChatScenario() {
        if (!state.chatDraft?.title) {
            appendChatMessage("bot", "Title is required. Please provide a valid title.");
            state.chatStepIndex = 0;
            appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
            return;
        }
        setStatus("Saving scenario...");
        state.chatSaving = true;
        updateActionState();
        const saved = await submitScenarioPayload(state.chatDraft, false);
        state.chatSaving = false;
        updateActionState();
        if (!saved) {
            appendChatMessage("bot", "Saving failed. You can try sending the last answer again.");
            return;
        }
        clearScenarioFields(true);
        appendChatMessage("bot", "Scenario created.");
        startChatSession({preserveLog: true, showIntro: false, initialRequirementIds: []});
        setStatus("Scenario created.");
    }

    async function handleChatSend() {
        if (!canWrite()) {
            setStatus("Only Admin and QA users can change scenarios.", true);
            return;
        }
        if (state.creationMode !== "chat") {
            return;
        }
        const answer = chatInput.value;
        if (!answer.trim()) {
            setStatus("Type an answer before sending.", true);
            return;
        }

        setStatus("");
        appendChatMessage("user", answer.trim());
        chatInput.value = "";

        const step = CHAT_STEPS[state.chatStepIndex];
        if (step === "title") {
            const title = answer.trim();
            if (!title) {
                appendChatMessage("bot", "Title cannot be empty.");
                appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
                return;
            }
            state.chatDraft.title = title;
            titleInput.value = title;
            state.chatStepIndex += 1;
            appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
            return;
        }

        if (step === "description") {
            const description = normalizeOptionalValue(answer);
            state.chatDraft.description = description;
            descriptionInput.value = description;
            state.chatStepIndex += 1;
            appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
            return;
        }

        if (step === "steps") {
            const steps = normalizeOptionalValue(answer)
                ? normalizeMultilineValue(answer)
                : "";
            state.chatDraft.steps = steps;
            stepsInput.value = steps;
            state.chatStepIndex += 1;
            appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
            return;
        }

        if (step === "expected_result") {
            const expectedResult = normalizeOptionalValue(answer)
                ? normalizeMultilineValue(answer)
                : "";
            state.chatDraft.expected_result = expectedResult;
            expectedInput.value = expectedResult;
            state.chatStepIndex += 1;
            appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
            return;
        }

        if (step === "priority") {
            const priority = normalizePriority(answer);
            if (!priority) {
                appendChatMessage("bot", "Please choose one of: low, medium, high, critical.");
                appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
                return;
            }
            state.chatDraft.priority = priority;
            priorityInput.value = priority;
            state.chatStepIndex += 1;
            appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
            return;
        }

        if (step === "requirement_ids") {
            const parsed = parseRequirementIds(answer);
            if (!parsed.ok) {
                appendChatMessage("bot", parsed.error);
                appendChatMessage("bot", getChatPrompt(state.chatStepIndex));
                return;
            }
            state.chatDraft.requirement_ids = parsed.ids;
            setSelectedRequirementIds(parsed.ids);
            state.chatStepIndex += 1;
            await finalizeChatScenario();
        }
    }

    async function deleteScenario(id) {
        if (!window.confirm("Delete this scenario?")) {
            return;
        }

        setStatus("Deleting scenario...");
        try {
            const response = await window.qaApi.fetch(`/scenarios/${id}`, {method: "DELETE"});
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to delete scenario.");
            }
            if (state.editingId === id) {
                resetForm();
            }
            await loadScenarios();
            setStatus("Scenario deleted.");
            window.dispatchEvent(new Event("qa:scenarios-changed"));
        } catch (error) {
            setStatus(error.message || "Unable to delete scenario.", true);
        }
    }

    async function exportFile(url, fallbackName) {
        if (!window.qaAuth?.isAuthenticated?.()) {
            setStatus("Sign in before exporting.", true);
            return;
        }

        setStatus("Preparing export...");
        try {
            const response = await window.qaApi.fetch(url);
            if (!response.ok) {
                throw new Error("Unable to export scenarios.");
            }
            const blob = await response.blob();
            const objectUrl = window.URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            const contentDisposition = response.headers.get("Content-Disposition") || "";
            const match = contentDisposition.match(/filename="([^"]+)"/i);
            anchor.href = objectUrl;
            anchor.download = match?.[1] || fallbackName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(objectUrl);
            setStatus("Export ready.");
        } catch (error) {
            setStatus(error.message || "Unable to export scenarios.", true);
        }
    }

    listNode.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const action = target.dataset.action;
        const id = Number(target.dataset.id);
        if (!action || !id) {
            return;
        }
        const scenario = state.scenarios.find((item) => item.id === id);
        if (!scenario) {
            return;
        }
        if (action === "edit") {
            populateForm(scenario);
        }
        if (action === "delete") {
            await deleteScenario(id);
        }
    });

    exportExcelButton.addEventListener("click", () => exportFile("/export/scenarios/excel", "qa-scenarios.xlsx"));
    exportWordButton.addEventListener("click", () => exportFile("/export/scenarios/word", "qa-scenarios.docx"));

    refreshLibraryButton?.addEventListener("click", async () => {
        setStatus("Refreshing scenarios...");
        await loadScenarios();
        setStatus("Scenario library refreshed.");
    });

    panelToggleButton?.addEventListener("click", () => {
        if (!(panelNode instanceof HTMLElement)) {
            return;
        }
        const isCollapsed = !panelNode.classList.contains("is-collapsed");
        setCollapsedState(panelNode, panelToggleButton, isCollapsed);
    });

    modeToggleButton?.addEventListener("click", () => {
        const nextMode = state.creationMode === "form" ? "chat" : "form";
        setCreationMode(nextMode);
        setStatus(nextMode === "chat" ? "Chat mode active." : "Form mode active.");
    });

    chatSendButton?.addEventListener("click", handleChatSend);
    chatInput?.addEventListener("keydown", async (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            await handleChatSend();
        }
    });

    window.addEventListener("qa:auth-changed", async () => {
        resetForm();
        renderRequirementSelector();
        updateActionState();
        await loadScenarios();
    });

    window.addEventListener("qa:requirements-updated", (event) => {
        const requirements = event.detail?.requirements;
        state.requirements = Array.isArray(requirements) ? requirements : [];
        const selectedIds = getSelectedRequirementIds();
        renderRequirementSelector();
        setSelectedRequirementIds(selectedIds);
        if (state.chatDraft?.requirement_ids?.length) {
            const available = new Set(state.requirements.map((item) => item.id));
            const filtered = state.chatDraft.requirement_ids.filter((id) => available.has(id));
            state.chatDraft.requirement_ids = filtered;
            setSelectedRequirementIds(filtered);
        }
        updateActionState();
    });

    window.addEventListener("qa:prefill-scenario-from-requirement", (event) => {
        const requirement = event.detail?.requirement;
        if (!requirement) {
            return;
        }
        setCollapsedState(panelNode, panelToggleButton, false);
        if (state.creationMode === "chat") {
            clearScenarioFields(false);
            setSelectedRequirementIds([requirement.id]);
            startChatSession({initialRequirementIds: [requirement.id]});
            appendChatMessage("bot", `Requirement #${requirement.id} selected: ${requirement.title}`);
            setStatus(`Scenario chat prepared from requirement #${requirement.id}.`);
            chatInput.focus();
        } else {
            resetForm({clearStatus: false, clearRequirements: false, restartChat: false});
            titleInput.value = `${requirement.title} coverage`;
            descriptionInput.value = requirement.description || `Validate requirement: ${requirement.title}`;
            setSelectedRequirementIds([requirement.id]);
            setStatus(`Scenario form prepared from requirement #${requirement.id}.`);
            titleInput.focus();
        }
        window.scrollTo({top: 0, behavior: "smooth"});
    });

    window.addEventListener("qa:scenarios-changed", loadScenarios);

    form.addEventListener("submit", saveScenario);
    resetButton.addEventListener("click", () => resetForm());
    setCollapsedState(panelNode, panelToggleButton, true);
    renderRequirementSelector();
    renderScenarios();
    setCreationMode("form", {initializeChat: false});
    updateActionState();
})();
