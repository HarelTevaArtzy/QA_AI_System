(function () {
    const form = document.getElementById("scenario-form");
    const formTitle = document.getElementById("scenario-form-title");
    const idInput = document.getElementById("scenario-id");
    const titleInput = document.getElementById("scenario-title");
    const descriptionInput = document.getElementById("scenario-description");
    const stepsInput = document.getElementById("scenario-steps");
    const expectedInput = document.getElementById("scenario-expected");
    const priorityInput = document.getElementById("scenario-priority");
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
    };

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

    function resetForm() {
        state.editingId = null;
        idInput.value = "";
        form.reset();
        priorityInput.value = "medium";
        formTitle.textContent = "Create Scenario";
        setSelectedRequirementIds([]);
        setStatus("");
    }

    function populateForm(scenario) {
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
        form.querySelectorAll("input, textarea, select, button").forEach((node) => {
            if (!(node instanceof HTMLButtonElement) && !(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement) && !(node instanceof HTMLSelectElement)) {
                return;
            }
            node.disabled = !writable;
        });
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

    async function saveScenario(event) {
        event.preventDefault();
        if (!canWrite()) {
            setStatus("Only Admin and QA users can change scenarios.", true);
            return;
        }

        setStatus("Saving scenario...");

        const payload = {
            title: titleInput.value,
            description: descriptionInput.value,
            steps: stepsInput.value,
            expected_result: expectedInput.value,
            priority: priorityInput.value,
            requirement_ids: getSelectedRequirementIds(),
        };
        const isEditing = Boolean(state.editingId);
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
            resetForm();
            setStatus(isEditing ? "Scenario updated." : "Scenario created.");
            window.dispatchEvent(new Event("qa:scenarios-changed"));
        } catch (error) {
            setStatus(error.message || "Unable to save scenario.", true);
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
    });

    window.addEventListener("qa:prefill-scenario-from-requirement", (event) => {
        const requirement = event.detail?.requirement;
        if (!requirement) {
            return;
        }
        setCollapsedState(panelNode, panelToggleButton, false);
        resetForm();
        titleInput.value = `${requirement.title} coverage`;
        descriptionInput.value = requirement.description || `Validate requirement: ${requirement.title}`;
        setSelectedRequirementIds([requirement.id]);
        setStatus(`Scenario form prepared from requirement #${requirement.id}.`);
        titleInput.focus();
        window.scrollTo({top: 0, behavior: "smooth"});
    });

    window.addEventListener("qa:scenarios-changed", loadScenarios);

    form.addEventListener("submit", saveScenario);
    resetButton.addEventListener("click", resetForm);
    setCollapsedState(panelNode, panelToggleButton, true);
    renderRequirementSelector();
    renderScenarios();
    updateActionState();
})();
