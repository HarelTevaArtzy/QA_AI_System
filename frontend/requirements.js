(function () {
    const form = document.getElementById("requirement-form");
    const formTitle = document.getElementById("requirement-form-title");
    const idInput = document.getElementById("requirement-id");
    const titleInput = document.getElementById("requirement-title");
    const descriptionInput = document.getElementById("requirement-description");
    const parentInput = document.getElementById("requirement-parent");
    const statusNode = document.getElementById("requirement-status");
    const requirementTree = document.getElementById("requirement-tree");
    const requirementListCount = document.getElementById("requirement-list-count");
    const requirementCountMetric = document.getElementById("requirement-count");
    const detailNode = document.getElementById("requirement-detail");
    const suggestionsNode = document.getElementById("requirement-scenario-suggestions");
    const suggestionsStatus = document.getElementById("requirement-suggestions-status");
    const resetButton = document.getElementById("requirement-reset");
    const refreshButton = document.getElementById("requirement-refresh");
    const createScenarioButton = document.getElementById("requirement-create-scenario");
    const generateScenariosButton = document.getElementById("requirement-generate-scenarios");

    const state = {
        requirementsTree: [],
        flatRequirements: [],
        editingId: null,
        activeRequirementId: null,
        activeRequirement: null,
        latestSuggestions: "",
        latestScenarioItems: [],
    };

    function setStatus(message, isError = false) {
        statusNode.textContent = message;
        statusNode.style.color = isError ? "#8e1b12" : "";
    }

    function setSuggestionsStatus(message, isError = false) {
        suggestionsStatus.textContent = message;
        suggestionsStatus.style.color = isError ? "#8e1b12" : "";
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function canWrite() {
        return window.qaAuth?.canWriteContent?.() || false;
    }

    function formatDate(value) {
        return new Date(value).toLocaleString();
    }

    function flattenRequirements(nodes, items = []) {
        for (const node of nodes) {
            items.push(node);
            if (Array.isArray(node.children) && node.children.length) {
                flattenRequirements(node.children, items);
            }
        }
        return items;
    }

    function updateRequirementCounts() {
        const count = state.flatRequirements.length;
        requirementListCount.textContent = `${count} item${count === 1 ? "" : "s"}`;
        requirementCountMetric.textContent = String(count);
    }

    function broadcastRequirements() {
        window.dispatchEvent(new CustomEvent("qa:requirements-updated", {
            detail: {
                requirements: state.flatRequirements,
            },
        }));
    }

    function renderParentOptions() {
        const currentId = state.editingId;
        const options = ['<option value="">No parent requirement</option>'];
        for (const requirement of state.flatRequirements) {
            if (requirement.id === currentId) {
                continue;
            }
            options.push(
                `<option value="${requirement.id}">${escapeHtml(requirement.title)}</option>`
            );
        }
        parentInput.innerHTML = options.join("");
    }

    function resetForm() {
        state.editingId = null;
        idInput.value = "";
        formTitle.textContent = "Create Requirement";
        form.reset();
        parentInput.value = "";
        renderParentOptions();
        setStatus("");
    }

    function populateForm(requirement) {
        state.editingId = requirement.id;
        idInput.value = String(requirement.id);
        titleInput.value = requirement.title;
        descriptionInput.value = requirement.description || "";
        formTitle.textContent = "Edit Requirement";
        renderParentOptions();
        parentInput.value = requirement.parent_id ? String(requirement.parent_id) : "";
        setStatus(`Editing requirement #${requirement.id}`);
        window.scrollTo({top: 0, behavior: "smooth"});
    }

    function renderTreeNode(node) {
        const isActive = node.id === state.activeRequirementId;
        const scenarioCount = node.scenario_count || 0;
        const childCount = Array.isArray(node.children) ? node.children.length : 0;

        return `
            <div class="requirement-node">
                <button type="button" class="topic-item requirement-item ${isActive ? "active" : ""}" data-requirement-id="${node.id}">
                    <div class="topic-head">
                        <div>
                            <h4>${escapeHtml(node.title)}</h4>
                            <p class="topic-meta">${scenarioCount} linked scenario${scenarioCount === 1 ? "" : "s"}</p>
                        </div>
                        <span class="topic-meta">${childCount} child${childCount === 1 ? "" : "ren"}</span>
                    </div>
                </button>
                ${(node.children || []).map((child) => renderTreeNode(child)).join("")}
            </div>
        `;
    }

    function renderRequirementTree() {
        updateRequirementCounts();

        if (!window.qaAuth?.isAuthenticated?.()) {
            requirementTree.innerHTML = '<div class="empty-state">Sign in to browse the requirement hierarchy.</div>';
            return;
        }

        if (!state.requirementsTree.length) {
            requirementTree.innerHTML = '<div class="empty-state">No requirements yet. Add one to begin traceability planning.</div>';
            return;
        }

        requirementTree.innerHTML = state.requirementsTree.map((node) => renderTreeNode(node)).join("");
    }

    function renderInlineMarkdown(value) {
        return escapeHtml(value)
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    }

    function renderMarkdown(value) {
        const content = String(value || "").trim();
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

    function renderDetail() {
        if (!window.qaAuth?.isAuthenticated?.()) {
            detailNode.innerHTML = '<div class="empty-state">Authenticate to inspect requirement details.</div>';
            return;
        }

        if (!state.activeRequirement) {
            detailNode.innerHTML = '<div class="empty-state">Select a requirement to inspect hierarchy, linked scenarios, and derived test ideas.</div>';
            return;
        }

        const requirement = state.activeRequirement;
        const childMarkup = requirement.children.length
            ? `<div class="linked-badges">${requirement.children.map((item) => `<span class="linked-badge">${escapeHtml(item.title)}</span>`).join("")}</div>`
            : '<p class="topic-meta">No child requirements.</p>';
        const scenarioMarkup = requirement.scenarios.length
            ? requirement.scenarios.map((scenario) => `
                <article class="scenario-item compact-card">
                    <div class="scenario-head">
                        <div>
                            <h4>${escapeHtml(scenario.title)}</h4>
                            <p class="topic-meta">${formatDate(scenario.created_at)}</p>
                        </div>
                        <span class="priority priority-${escapeHtml(scenario.priority)}">${escapeHtml(scenario.priority)}</span>
                    </div>
                </article>
            `).join("")
            : '<div class="empty-state">No scenarios linked to this requirement yet.</div>';

        detailNode.innerHTML = `
            <article class="detail-stack">
                <div class="detail-actions">
                    <div>
                        <p class="section-label">Selected Requirement</p>
                        <h3>${escapeHtml(requirement.title)}</h3>
                        <p class="topic-meta">Created ${formatDate(requirement.created_at)}</p>
                    </div>
                    ${canWrite() ? `
                        <div class="item-actions">
                            <button type="button" class="ghost-button small" data-requirement-action="edit">Edit</button>
                            <button type="button" class="ghost-button small" data-requirement-action="delete">Delete</button>
                        </div>
                    ` : ""}
                </div>
                <p>${escapeHtml(requirement.description || "No detailed description provided.")}</p>
                <div>
                    <span class="scenario-section-title">Parent</span>
                    <p>${requirement.parent ? escapeHtml(requirement.parent.title) : "No parent requirement"}</p>
                </div>
                <div>
                    <span class="scenario-section-title">Child Requirements</span>
                    ${childMarkup}
                </div>
                <div>
                    <span class="scenario-section-title">Linked Scenarios</span>
                    <div class="scenario-list mini-list">${scenarioMarkup}</div>
                </div>
            </article>
        `;
    }

    function renderScenarioSuggestions() {
        if (!state.latestSuggestions.trim()) {
            suggestionsNode.innerHTML = '<div class="empty-state">Requirement-based scenario suggestions will appear here.</div>';
            return;
        }

        if (!state.latestScenarioItems.length) {
            suggestionsNode.innerHTML = `<div class="enrichment">${renderMarkdown(state.latestSuggestions)}</div>`;
            return;
        }

        suggestionsNode.innerHTML = state.latestScenarioItems.map((scenario, index) => `
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
                        <ul>${scenario.steps.split("\n").filter(Boolean).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
                    </div>
                    <div>
                        <span class="scenario-section-title">Expected Result</span>
                        <ul>${scenario.expected_result.split("\n").filter(Boolean).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
                    </div>
                </div>
                ${canWrite() ? `
                    <div class="item-actions">
                        <button type="button" class="primary-button small" data-save-requirement-scenario="${index}">Save Scenario</button>
                    </div>
                ` : ""}
            </article>
        `).join("");
    }

    function updateActionState() {
        const writable = canWrite();
        form.querySelectorAll("input, textarea, select, button").forEach((node) => {
            if (node instanceof HTMLButtonElement || node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
                node.disabled = !writable;
            }
        });
        createScenarioButton.disabled = !state.activeRequirement || !writable;
        generateScenariosButton.disabled = !state.activeRequirement || !writable;
    }

    async function loadRequirements(options = {}) {
        if (!window.qaAuth?.isAuthenticated?.()) {
            state.requirementsTree = [];
            state.flatRequirements = [];
            state.activeRequirementId = null;
            state.activeRequirement = null;
            resetForm();
            renderRequirementTree();
            renderDetail();
            renderScenarioSuggestions();
            updateRequirementCounts();
            broadcastRequirements();
            updateActionState();
            return;
        }

        try {
            const response = await window.qaApi.fetch("/requirements");
            if (!response.ok) {
                throw new Error("Unable to load requirements.");
            }
            state.requirementsTree = await response.json();
            state.flatRequirements = flattenRequirements(state.requirementsTree, []);
            renderParentOptions();
            renderRequirementTree();
            broadcastRequirements();
            updateActionState();

            if (state.activeRequirementId) {
                await loadRequirementDetail(state.activeRequirementId);
            } else if (state.flatRequirements.length && !options.skipAutoSelect) {
                await loadRequirementDetail(state.flatRequirements[0].id);
            } else {
                renderDetail();
            }
        } catch (error) {
            setStatus(error.message || "Unable to load requirements.", true);
        }
    }

    async function loadRequirementDetail(id) {
        if (!id) {
            state.activeRequirementId = null;
            state.activeRequirement = null;
            renderRequirementTree();
            renderDetail();
            updateActionState();
            return;
        }

        try {
            const response = await window.qaApi.fetch(`/requirements/${id}`);
            if (!response.ok) {
                throw new Error("Unable to load requirement detail.");
            }
            state.activeRequirementId = id;
            state.activeRequirement = await response.json();
            renderRequirementTree();
            renderDetail();
            updateActionState();
        } catch (error) {
            setStatus(error.message || "Unable to load requirement detail.", true);
        }
    }

    async function saveRequirement(event) {
        event.preventDefault();
        if (!canWrite()) {
            setStatus("Only Admin and QA users can change requirements.", true);
            return;
        }

        const isEditing = Boolean(state.editingId);
        const payload = {
            title: titleInput.value,
            description: descriptionInput.value,
            parent_id: parentInput.value ? Number(parentInput.value) : null,
        };

        setStatus(isEditing ? "Updating requirement..." : "Creating requirement...");
        try {
            const response = await window.qaApi.fetch(isEditing ? `/requirements/${state.editingId}` : "/requirements", {
                method: isEditing ? "PUT" : "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to save requirement.");
            }
            const savedRequirement = await response.json();
            await loadRequirements({skipAutoSelect: true});
            await loadRequirementDetail(savedRequirement.id);
            resetForm();
            setStatus(isEditing ? "Requirement updated." : "Requirement created.");
        } catch (error) {
            setStatus(error.message || "Unable to save requirement.", true);
        }
    }

    async function deleteRequirement() {
        if (!state.activeRequirementId || !canWrite()) {
            return;
        }
        if (!window.confirm("Delete this requirement? Child requirements will be detached.")) {
            return;
        }

        setStatus("Deleting requirement...");
        try {
            const response = await window.qaApi.fetch(`/requirements/${state.activeRequirementId}`, {
                method: "DELETE",
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to delete requirement.");
            }
            state.activeRequirementId = null;
            state.activeRequirement = null;
            state.latestSuggestions = "";
            state.latestScenarioItems = [];
            renderScenarioSuggestions();
            await loadRequirements({skipAutoSelect: true});
            renderDetail();
            setStatus("Requirement deleted.");
        } catch (error) {
            setStatus(error.message || "Unable to delete requirement.", true);
        }
    }

    async function generateSuggestions() {
        if (!state.activeRequirementId) {
            setSuggestionsStatus("Select a requirement first.", true);
            return;
        }
        if (!canWrite()) {
            setSuggestionsStatus("Only Admin and QA users can generate scenarios.", true);
            return;
        }

        setSuggestionsStatus("Generating requirement-based scenarios...");
        try {
            const response = await window.qaApi.fetch(`/requirements/${state.activeRequirementId}/scenario-suggestions`, {
                method: "POST",
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to generate scenarios.");
            }
            const payload = await response.json();
            state.latestSuggestions = payload.content || "";
            state.latestScenarioItems = Array.isArray(payload.scenarios) ? payload.scenarios : [];
            renderScenarioSuggestions();
            updateActionState();
            setSuggestionsStatus("Scenario suggestions generated.");
        } catch (error) {
            setSuggestionsStatus(error.message || "Unable to generate scenarios.", true);
        }
    }

    async function addSuggestedScenario(index) {
        const scenario = state.latestScenarioItems[index];
        if (!scenario || !state.activeRequirementId) {
            setSuggestionsStatus("Scenario suggestion is unavailable.", true);
            return;
        }

        setSuggestionsStatus("Saving scenario...");
        try {
            const response = await window.qaApi.fetch("/scenarios", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    ...scenario,
                    requirement_ids: [state.activeRequirementId],
                }),
            });
            if (!response.ok) {
                const problem = await response.json().catch(() => ({}));
                throw new Error(problem.detail || "Unable to create scenario from requirement.");
            }
            state.latestScenarioItems = state.latestScenarioItems.filter((_, itemIndex) => itemIndex !== index);
            renderScenarioSuggestions();
            updateActionState();
            await Promise.all([
                loadRequirementDetail(state.activeRequirementId),
                loadRequirements({skipAutoSelect: true}),
            ]);
            window.dispatchEvent(new Event("qa:scenarios-changed"));
            setSuggestionsStatus("Scenario created from requirement.");
        } catch (error) {
            setSuggestionsStatus(error.message || "Unable to create scenario from requirement.", true);
        }
    }

    function dispatchPrefillScenarioEvent() {
        if (!state.activeRequirement) {
            return;
        }
        window.dispatchEvent(new CustomEvent("qa:tab-select-request", {
            detail: {panelId: "scenarios-panel"},
        }));
        window.dispatchEvent(new CustomEvent("qa:prefill-scenario-from-requirement", {
            detail: {
                requirement: state.activeRequirement,
            },
        }));
    }

    requirementTree?.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest("[data-requirement-id]");
        if (!(button instanceof HTMLElement)) {
            return;
        }
        const requirementId = Number(button.dataset.requirementId);
        if (!requirementId) {
            return;
        }
        await loadRequirementDetail(requirementId);
    });

    detailNode?.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const action = target.dataset.requirementAction;
        if (!action) {
            return;
        }
        if (action === "edit" && state.activeRequirement) {
            populateForm(state.activeRequirement);
        }
        if (action === "delete") {
            await deleteRequirement();
        }
    });

    suggestionsNode?.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest("[data-save-requirement-scenario]");
        if (!(button instanceof HTMLElement)) {
            return;
        }
        const index = Number(button.dataset.saveRequirementScenario);
        if (Number.isNaN(index)) {
            return;
        }
        await addSuggestedScenario(index);
    });

    refreshButton?.addEventListener("click", async () => {
        setStatus("Refreshing requirements...");
        await loadRequirements({skipAutoSelect: true});
        setStatus("Requirement tree refreshed.");
    });

    createScenarioButton?.addEventListener("click", dispatchPrefillScenarioEvent);
    generateScenariosButton?.addEventListener("click", generateSuggestions);
    resetButton?.addEventListener("click", resetForm);
    form?.addEventListener("submit", saveRequirement);

    window.addEventListener("qa:auth-changed", async () => {
        state.latestSuggestions = "";
        state.latestScenarioItems = [];
        renderScenarioSuggestions();
        await loadRequirements();
    });

    window.addEventListener("qa:scenarios-changed", async () => {
        if (!window.qaAuth?.isAuthenticated?.()) {
            return;
        }
        await Promise.all([
            loadRequirements({skipAutoSelect: true}),
            state.activeRequirementId ? loadRequirementDetail(state.activeRequirementId) : Promise.resolve(),
        ]);
    });

    renderScenarioSuggestions();
    resetForm();
    renderDetail();
    renderRequirementTree();
    updateActionState();

    window.qaRequirements = {
        getAll: () => state.flatRequirements,
        getActive: () => state.activeRequirement,
    };
})();
